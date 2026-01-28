/**
 * Timecode Provider Types
 *
 * Unified interface for timecode acquisition from various sources:
 * - System clock (fallback)
 * - HyperDeck via TCP or REST (RP-188 embedded in SDI)
 * - Future: LTC hardware readers, NTP sync
 */

import type { EventEmitter } from 'events';

// ============================================================================
// Timecode Source Types
// ============================================================================

/**
 * Origin of the timecode signal.
 * Used to determine trust level and labelling.
 */
export type TimecodeSource =
  | 'SYSTEM'              // Generated from computer clock
  | 'HYPERDECK_SDI'       // RP-188 embedded in SDI input (real external TC)
  | 'HYPERDECK_INTERNAL'  // HyperDeck's internal generator
  | 'HYPERDECK_CLIP'      // Timecode from recorded clip metadata
  | 'HYPERDECK_UNKNOWN'   // HyperDeck connected but source not determined
  | 'LTC_HARDWARE'        // Future: USB/audio LTC reader
  | 'NTP';                // Future: NTP-synchronised clock

/**
 * Status of the timecode reading.
 * Indicates reliability and usability.
 */
export type TimecodeStatus =
  | 'OK'                  // Valid timecode from expected source
  | 'DEGRADED'            // Timecode available but not from preferred source
  | 'NO_SIGNAL'           // No valid timecode signal
  | 'CONNECTING'          // Provider is establishing connection
  | 'DISCONNECTED'        // Provider lost connection
  | 'ERROR';              // Unrecoverable error

/**
 * HyperDeck transport states.
 */
export type TransportState =
  | 'preview'
  | 'stopped'
  | 'play'
  | 'forward'
  | 'rewind'
  | 'jog'
  | 'shuttle'
  | 'record';

// ============================================================================
// Timecode Snapshot
// ============================================================================

/**
 * A single timecode reading with full context.
 * This is the unified output from all providers.
 */
export interface TimecodeSnapshot {
  /**
   * When this snapshot was captured (Date.now()).
   * Use for latency calculations and staleness detection.
   */
  readonly readAt: number;

  /**
   * Display timecode in SMPTE format "HH:MM:SS:FF".
   * This is what the operator sees on the device.
   * Null if no valid timecode.
   */
  readonly timecode: string | null;

  /**
   * Timeline timecode in SMPTE format "HH:MM:SS:FF".
   * May differ from display TC during playback.
   * Primarily for debugging and timeline-mode operations.
   */
  readonly timelineTimecode: string | null;

  /**
   * The source of this timecode.
   */
  readonly source: TimecodeSource;

  /**
   * Current status of the timecode signal.
   */
  readonly status: TimecodeStatus;

  /**
   * Frame rate of the timecode (e.g., 25, 29.97, 50).
   */
  readonly frameRate: number;

  /**
   * Whether drop-frame timecode is in use.
   * Only valid for 29.97 and 59.94 fps.
   */
  readonly dropFrame: boolean;

  /**
   * Optional transport metadata when available.
   */
  readonly transport?: {
    readonly state: TransportState;
    readonly speed: number;
    readonly slotId?: number;
    readonly clipId?: number;
  };

  /**
   * Optional device information.
   */
  readonly device?: {
    readonly name: string;
    readonly model?: string;
    readonly firmwareVersion?: string;
  };

  /**
   * Error message if status is ERROR.
   */
  readonly error?: string;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Events emitted by a TimecodeProvider.
 */
export interface TimecodeProviderEvents {
  update: (snapshot: TimecodeSnapshot) => void;
  connected: () => void;
  disconnected: (error?: Error) => void;
  error: (error: Error) => void;
}

/**
 * Base interface for all timecode providers.
 */
export interface TimecodeProvider extends EventEmitter {
  /**
   * Human-readable name for logging and UI.
   */
  readonly name: string;

  /**
   * Primary source type this provider supplies.
   */
  readonly sourceType: TimecodeSource;

  /**
   * Whether the provider is currently connected and operational.
   */
  readonly isConnected: boolean;

  /**
   * Connect to the timecode source.
   * Resolves when connected and ready.
   * Rejects if connection fails.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the timecode source.
   * Should clean up all resources.
   */
  disconnect(): Promise<void>;

  /**
   * Get the most recent timecode snapshot.
   * Returns immediately with cached value.
   * Use events for real-time updates.
   */
  getSnapshot(): TimecodeSnapshot;

  /**
   * Force an immediate timecode read.
   * Useful for one-shot queries.
   */
  readTimecode(): Promise<TimecodeSnapshot>;

  // Event emitter methods (inherited)
  on<K extends keyof TimecodeProviderEvents>(
    event: K,
    listener: TimecodeProviderEvents[K]
  ): this;
  off<K extends keyof TimecodeProviderEvents>(
    event: K,
    listener: TimecodeProviderEvents[K]
  ): this;
  emit<K extends keyof TimecodeProviderEvents>(
    event: K,
    ...args: Parameters<TimecodeProviderEvents[K]>
  ): boolean;
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Configuration for system clock timecode provider.
 */
export interface SystemClockProviderConfig {
  /**
   * Frame rate to generate timecode at.
   */
  frameRate: number;

  /**
   * Whether to use drop-frame format.
   */
  dropFrame: boolean;

  /**
   * Starting timecode. Defaults to current time of day.
   * Format: "HH:MM:SS:FF" or "auto" for time-of-day.
   */
  startTimecode?: string;

  /**
   * Update rate in Hz. Defaults to frame rate.
   */
  updateRateHz?: number;
}

/**
 * Configuration for HyperDeck timecode provider.
 */
export interface HyperDeckProviderConfig {
  /**
   * IP address or hostname of the HyperDeck.
   */
  host: string;

  /**
   * TCP port. Defaults to 9993.
   */
  port?: number;

  /**
   * Polling rate in Hz when not using notifications.
   * Defaults to 10. Maximum 25.
   */
  pollRateHz?: number;

  /**
   * Use HyperDeck protocol notifications if available (protocol >= 1.11).
   * Falls back to polling if not supported.
   * Defaults to true.
   */
  useNotifications?: boolean;

  /**
   * Only report OK status if timecode source is SDI.
   * If false, any timecode is accepted.
   * Defaults to true for "real TC" use case.
   */
  requireSdiSource?: boolean;

  /**
   * Timeout for initial connection in milliseconds.
   * Defaults to 5000.
   */
  connectionTimeout?: number;

  /**
   * Reconnection settings.
   */
  reconnect?: {
    enabled: boolean;
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
}

/**
 * Union of all provider configurations.
 */
export type ProviderConfig =
  | { type: 'system'; config: SystemClockProviderConfig }
  | { type: 'hyperdeck'; config: HyperDeckProviderConfig };

// ============================================================================
// Timecode Manager Configuration
// ============================================================================

/**
 * Configuration for the timecode manager.
 */
export interface TimecodeManagerConfig {
  /**
   * Primary provider to use.
   */
  primary: ProviderConfig;

  /**
   * Fallback provider if primary fails.
   * Defaults to system clock.
   */
  fallback?: ProviderConfig;

  /**
   * How long to wait before switching to fallback (ms).
   * Defaults to 3000.
   */
  fallbackDelayMs?: number;

  /**
   * Emit rate limit (max updates per second to downstream).
   * Prevents flooding consumers. Defaults to 25.
   */
  maxEmitRateHz?: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Parsed SMPTE timecode components.
 */
export interface TimecodeComponents {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  dropFrame: boolean;
}

/**
 * Result of validating a timecode string.
 */
export interface TimecodeValidation {
  valid: boolean;
  components?: TimecodeComponents;
  error?: string;
}
