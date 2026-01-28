/**
 * Type definitions for HyperDeck adapter.
 * Based on Blackmagic HyperDeck Ethernet Protocol.
 */

// ============================================================================
// Transport Status
// ============================================================================

/**
 * Transport status states as defined by HyperDeck protocol.
 */
export type TransportStatus =
  | 'preview'
  | 'stopped'
  | 'play'
  | 'forward'
  | 'rewind'
  | 'jog'
  | 'shuttle'
  | 'record';

/**
 * Slot status for storage media.
 */
export type SlotStatus = 'empty' | 'mounting' | 'error' | 'mounted';

/**
 * Video input source.
 */
export type VideoInput = 'SDI' | 'HDMI' | 'component';

/**
 * Audio input source.
 */
export type AudioInput = 'embedded' | 'XLR' | 'RCA';

// ============================================================================
// Transport Information
// ============================================================================

/**
 * Transport information returned by 'transport info' command.
 */
export interface TransportInfo {
  /** Current transport status */
  status: TransportStatus;
  /** Playback speed (100 = normal, negative = reverse) */
  speed: number;
  /** Active slot ID (1 or 2) */
  slotId: number;
  /** Current clip ID (1-based index) */
  clipId: number;
  /** Single clip playback mode */
  singleClip: boolean;
  /** Display timecode (may differ from actual timecode) */
  displayTimecode: string;
  /** Actual timecode position */
  timecode: string;
  /** Current video format (e.g., '1080i50', '2160p25') */
  videoFormat: string;
  /** Loop playback enabled */
  loop: boolean;
}

// ============================================================================
// Clip Information
// ============================================================================

/**
 * Information about a recorded clip.
 */
export interface ClipInfo {
  /** Clip index (1-based) */
  id: number;
  /** Clip filename */
  name: string;
  /** Start timecode of the clip */
  startTimecode: string;
  /** Duration in timecode format */
  duration: string;
}

/**
 * Clip list with total count.
 */
export interface ClipList {
  /** Total number of clips */
  clipCount: number;
  /** Array of clip information */
  clips: ClipInfo[];
}

// ============================================================================
// Slot Information
// ============================================================================

/**
 * Storage slot information returned by 'slot info' command.
 */
export interface SlotInfo {
  /** Slot ID (1 or 2) */
  slotId: number;
  /** Slot status */
  status: SlotStatus;
  /** Volume name */
  volumeName: string;
  /** Recording time remaining in seconds */
  recordingTime: number;
  /** Video format for recording */
  videoFormat: string;
}

// ============================================================================
// Protocol Response
// ============================================================================

/**
 * Response codes from HyperDeck protocol.
 * 1xx = informational
 * 2xx = success
 * 5xx = error
 */
export interface ProtocolResponse {
  /** Response code (e.g., 200, 500) */
  code: number;
  /** Response message (e.g., 'ok', 'syntax error') */
  message: string;
  /** Key-value data from multi-line response */
  data: Record<string, string>;
}

/**
 * Async notification from HyperDeck.
 */
export interface AsyncNotification {
  /** Notification type */
  type: 'transport' | 'slot' | 'configuration' | 'remote';
  /** Notification data */
  data: Record<string, string>;
}

// ============================================================================
// Connection State
// ============================================================================

/**
 * HyperDeck connection state.
 */
export type HyperDeckState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Connection options for HyperDeck adapter.
 */
export interface HyperDeckConnectionOptions {
  /** Hostname or IP address */
  host: string;
  /** TCP port (default: 9993) */
  port?: number;
  /** Connection timeout in milliseconds */
  timeout?: number;
}

// ============================================================================
// Reconnection Configuration
// ============================================================================

/**
 * Reconnection behaviour configuration.
 */
export interface ReconnectConfig {
  /** Enable automatic reconnection */
  enabled: boolean;
  /** Maximum reconnection attempts (0 = infinite) */
  maxAttempts: number;
  /** Initial delay between attempts in milliseconds */
  initialDelayMs: number;
  /** Maximum delay between attempts in milliseconds */
  maxDelayMs: number;
}

// ============================================================================
// Adapter Options
// ============================================================================

/**
 * Configuration options for HyperDeckAdapter.
 */
export interface HyperDeckAdapterOptions {
  /** Unique name for this HyperDeck */
  name: string;
  /** Hostname or IP address */
  host: string;
  /** TCP port (default: 9993) */
  port?: number;
  /** ATEM input number this HyperDeck corresponds to */
  inputMapping: number;
  /** Frame offset for timestamp compensation */
  frameOffset?: number;
  /** Frame rate for offset calculations */
  frameRate?: number;
  /** Reconnection configuration */
  reconnect?: Partial<ReconnectConfig>;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Events emitted by HyperDeckAdapter.
 */
export interface HyperDeckAdapterEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  transportChanged: (info: TransportInfo) => void;
  recordingStarted: (clipName: string, timecode: string) => void;
  recordingStopped: (clipName: string, duration: string) => void;
  clipAdded: (clip: ClipInfo) => void;
}

// ============================================================================
// Command Queue
// ============================================================================

/**
 * Pending command in the queue.
 */
export interface PendingCommand {
  /** Command string sent to HyperDeck */
  command: string;
  /** Promise resolution callback */
  resolve: (response: ProtocolResponse) => void;
  /** Promise rejection callback */
  reject: (error: Error) => void;
  /** Timeout timer */
  timeout: NodeJS.Timeout;
}
