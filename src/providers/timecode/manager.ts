/**
 * Timecode Manager
 *
 * Orchestrates multiple timecode providers with automatic failover.
 * Provides a unified interface for timecode acquisition regardless of source.
 *
 * Features:
 * - Primary provider with fallback
 * - Automatic failover on provider failure
 * - Rate-limited emissions to downstream consumers
 * - Periodic primary restoration attempts
 */

import { EventEmitter } from 'events';
import type {
  TimecodeProvider,
  TimecodeSnapshot,
  TimecodeSource,
  TimecodeManagerConfig,
  ProviderConfig,
  HyperDeckProviderConfig,
} from './types.js';
import { createHyperDeckProvider } from './hyperdeck.js';
import { createSystemClockProvider } from './system-clock.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FALLBACK_DELAY_MS = 3000;
const DEFAULT_MAX_EMIT_RATE_HZ = 25;
const PRIMARY_RESTORE_INTERVAL_MS = 30000; // Try to restore primary every 30s

// ============================================================================
// Types
// ============================================================================

/**
 * Events emitted by the TimecodeManager.
 */
export interface TimecodeManagerEvents {
  /** Emitted when a new timecode snapshot is available */
  update: (snapshot: TimecodeSnapshot) => void;
  /** Emitted when switching from primary to fallback */
  failover: (info: { from: string; to: string; reason: string }) => void;
  /** Emitted when primary provider is restored */
  restored: (info: { provider: string }) => void;
  /** Emitted when the active provider connects */
  connected: () => void;
  /** Emitted when all providers are disconnected */
  disconnected: (error?: Error) => void;
  /** Emitted on any provider error */
  error: (error: Error) => void;
}

// ============================================================================
// Manager Implementation
// ============================================================================

export class TimecodeManager extends EventEmitter {
  private readonly config: Required<TimecodeManagerConfig>;
  private primaryProvider: TimecodeProvider | null = null;
  private fallbackProvider: TimecodeProvider | null = null;
  private activeProvider: TimecodeProvider | null = null;

  private currentSnapshot: TimecodeSnapshot;
  private lastEmitTime = 0;
  private minEmitIntervalMs: number;

  private primaryDisconnectedAt: number | null = null;
  private failoverTimer: NodeJS.Timeout | null = null;
  private primaryRestoreTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: TimecodeManagerConfig) {
    super();

    // Apply defaults
    this.config = {
      primary: config.primary,
      fallback: config.fallback ?? {
        type: 'system',
        config: {
          frameRate: this.extractFrameRate(config.primary),
          dropFrame: false,
          startTimecode: 'auto',
        },
      },
      fallbackDelayMs: config.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS,
      maxEmitRateHz: config.maxEmitRateHz ?? DEFAULT_MAX_EMIT_RATE_HZ,
    };

    this.minEmitIntervalMs = Math.floor(1000 / this.config.maxEmitRateHz);

    // Initial disconnected snapshot
    this.currentSnapshot = this.createInitialSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Public Interface
  // ---------------------------------------------------------------------------

  /**
   * Whether the manager has at least one connected provider.
   */
  get isConnected(): boolean {
    return this.activeProvider?.isConnected ?? false;
  }

  /**
   * The currently active timecode source.
   */
  get activeSource(): TimecodeSource {
    return this.currentSnapshot.source;
  }

  /**
   * Whether we're currently using the fallback provider.
   */
  get isOnFallback(): boolean {
    return this.activeProvider === this.fallbackProvider && this.fallbackProvider !== null;
  }

  /**
   * Start the timecode manager.
   * Connects to primary provider, with fallback on failure.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Create providers
    this.primaryProvider = this.createProvider(this.config.primary);
    this.fallbackProvider = this.createProvider(this.config.fallback);

    // Set up event handlers
    this.setupProviderHandlers(this.primaryProvider, 'primary');
    this.setupProviderHandlers(this.fallbackProvider, 'fallback');

    // Try to connect primary
    try {
      await this.primaryProvider.connect();
      this.activeProvider = this.primaryProvider;
      this.emit('connected');
    } catch (error) {
      // Primary failed, try fallback immediately
      this.handlePrimaryFailure(error instanceof Error ? error.message : 'Connection failed');
    }
  }

  /**
   * Stop the timecode manager.
   * Disconnects all providers and cleans up.
   */
  async stop(): Promise<void> {
    this.running = false;

    this.clearFailoverTimer();
    this.clearPrimaryRestoreTimer();

    const disconnects: Promise<void>[] = [];

    if (this.primaryProvider) {
      disconnects.push(this.primaryProvider.disconnect());
    }

    if (this.fallbackProvider) {
      disconnects.push(this.fallbackProvider.disconnect());
    }

    await Promise.all(disconnects);

    this.primaryProvider = null;
    this.fallbackProvider = null;
    this.activeProvider = null;

    this.currentSnapshot = this.createInitialSnapshot();
    this.emit('disconnected');
  }

  /**
   * Get the most recent timecode snapshot.
   */
  getSnapshot(): TimecodeSnapshot {
    return this.currentSnapshot;
  }

  /**
   * Force an immediate timecode read from the active provider.
   */
  async readTimecode(): Promise<TimecodeSnapshot> {
    if (!this.activeProvider) {
      return this.currentSnapshot;
    }

    try {
      const snapshot = await this.activeProvider.readTimecode();
      this.updateSnapshot(snapshot);
      return snapshot;
    } catch {
      return this.currentSnapshot;
    }
  }

  /**
   * Manually switch to the fallback provider.
   */
  switchToFallback(): void {
    if (!this.fallbackProvider || this.activeProvider === this.fallbackProvider) {
      return;
    }

    this.performFailover('Manual switch requested');
  }

  /**
   * Attempt to restore the primary provider.
   */
  async restorePrimary(): Promise<boolean> {
    if (!this.primaryProvider || this.activeProvider === this.primaryProvider) {
      return this.activeProvider === this.primaryProvider;
    }

    try {
      if (!this.primaryProvider.isConnected) {
        await this.primaryProvider.connect();
      }

      this.activeProvider = this.primaryProvider;
      this.primaryDisconnectedAt = null;
      this.clearPrimaryRestoreTimer();

      this.emit('restored', { provider: 'primary' });
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Provider Factory
  // ---------------------------------------------------------------------------

  private createProvider(config: ProviderConfig): TimecodeProvider {
    switch (config.type) {
      case 'hyperdeck':
        return createHyperDeckProvider(config.config);

      case 'system':
        return createSystemClockProvider(config.config);

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = config;
        throw new Error(`Unknown provider type: ${(_exhaustive as ProviderConfig).type}`);
    }
  }

  private extractFrameRate(config: ProviderConfig): number {
    switch (config.type) {
      case 'hyperdeck':
        return 25; // Default, will be detected at runtime
      case 'system':
        return config.config.frameRate;
      default:
        return 25;
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  private setupProviderHandlers(provider: TimecodeProvider, role: 'primary' | 'fallback'): void {
    // Handle timecode updates
    provider.on('update', (snapshot: TimecodeSnapshot) => {
      // Only process updates from active provider
      if (provider !== this.activeProvider) {
        return;
      }

      this.updateSnapshot(snapshot);
    });

    // Handle connection
    provider.on('connected', () => {
      if (role === 'primary') {
        // Primary reconnected
        if (this.activeProvider === this.fallbackProvider) {
          this.activeProvider = this.primaryProvider;
          this.primaryDisconnectedAt = null;
          this.clearPrimaryRestoreTimer();
          this.emit('restored', { provider: 'primary' });
        }
      }
    });

    // Handle disconnection
    provider.on('disconnected', (error?: Error) => {
      if (role === 'primary' && provider === this.activeProvider) {
        this.handlePrimaryFailure(error?.message ?? 'Disconnected');
      }
    });

    // Forward errors
    provider.on('error', (error: Error) => {
      this.emit('error', error);

      // If this is the active primary and we get errors, start failover timer
      if (role === 'primary' && provider === this.activeProvider) {
        if (this.primaryDisconnectedAt === null) {
          this.primaryDisconnectedAt = Date.now();
          this.scheduleFailover();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Failover Logic
  // ---------------------------------------------------------------------------

  private handlePrimaryFailure(_reason: string): void {
    if (!this.running) return;

    // Mark disconnection time (reason captured for debugging)
    if (this.primaryDisconnectedAt === null) {
      this.primaryDisconnectedAt = Date.now();
    }

    // If fallback is available and ready, consider switching
    if (this.fallbackProvider) {
      if (!this.fallbackProvider.isConnected) {
        // Try to connect fallback
        this.fallbackProvider.connect().catch(() => {
          // Fallback also failed
          this.emit('error', new Error('Both primary and fallback providers unavailable'));
        });
      }

      // Schedule failover check
      this.scheduleFailover();
    }
  }

  private scheduleFailover(): void {
    if (this.failoverTimer) return;

    this.failoverTimer = setTimeout(() => {
      this.failoverTimer = null;

      // Check if primary is still down
      if (this.primaryDisconnectedAt !== null) {
        const downtime = Date.now() - this.primaryDisconnectedAt;

        if (downtime >= this.config.fallbackDelayMs) {
          this.performFailover(`Primary unavailable for ${downtime}ms`);
        } else {
          // Not yet time, reschedule
          this.scheduleFailover();
        }
      }
    }, Math.min(this.config.fallbackDelayMs, 1000));
  }

  private performFailover(reason: string): void {
    if (!this.fallbackProvider || this.activeProvider === this.fallbackProvider) {
      return;
    }

    const fromProvider = this.activeProvider?.name ?? 'unknown';
    this.activeProvider = this.fallbackProvider;

    // Start periodic primary restoration attempts
    this.startPrimaryRestoreTimer();

    this.emit('failover', {
      from: fromProvider,
      to: this.fallbackProvider.name,
      reason,
    });
  }

  private clearFailoverTimer(): void {
    if (this.failoverTimer) {
      clearTimeout(this.failoverTimer);
      this.failoverTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Primary Restoration
  // ---------------------------------------------------------------------------

  private startPrimaryRestoreTimer(): void {
    if (this.primaryRestoreTimer) return;

    this.primaryRestoreTimer = setInterval(async () => {
      if (!this.running || !this.primaryProvider) {
        this.clearPrimaryRestoreTimer();
        return;
      }

      // Only attempt if we're on fallback
      if (this.activeProvider !== this.fallbackProvider) {
        this.clearPrimaryRestoreTimer();
        return;
      }

      try {
        await this.restorePrimary();
      } catch {
        // Will try again at next interval
      }
    }, PRIMARY_RESTORE_INTERVAL_MS);
  }

  private clearPrimaryRestoreTimer(): void {
    if (this.primaryRestoreTimer) {
      clearInterval(this.primaryRestoreTimer);
      this.primaryRestoreTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot Management
  // ---------------------------------------------------------------------------

  private updateSnapshot(snapshot: TimecodeSnapshot): void {
    this.currentSnapshot = snapshot;

    // Rate limit emissions
    const now = Date.now();
    if (now - this.lastEmitTime >= this.minEmitIntervalMs) {
      this.lastEmitTime = now;
      this.emit('update', snapshot);
    }
  }

  private createInitialSnapshot(): TimecodeSnapshot {
    return {
      readAt: Date.now(),
      timecode: null,
      timelineTimecode: null,
      source: 'SYSTEM',
      status: 'DISCONNECTED',
      frameRate: 25,
      dropFrame: false,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a timecode manager with the given configuration.
 */
export function createTimecodeManager(config: TimecodeManagerConfig): TimecodeManager {
  return new TimecodeManager(config);
}

// ============================================================================
// Convenience Factory
// ============================================================================

/**
 * Create a timecode manager with HyperDeck as primary and system clock as fallback.
 * This is the common configuration for broadcast use.
 */
export function createHyperDeckWithFallback(options: {
  host: string;
  port?: number;
  frameRate?: number;
  dropFrame?: boolean;
  requireSdiSource?: boolean;
  fallbackDelayMs?: number;
}): TimecodeManager {
  const frameRate = options.frameRate ?? 25;

  // Build HyperDeck config, only including port if specified
  const hyperdeckConfig: HyperDeckProviderConfig = {
    host: options.host,
    requireSdiSource: options.requireSdiSource ?? true,
  };
  if (options.port !== undefined) {
    hyperdeckConfig.port = options.port;
  }

  const managerConfig: TimecodeManagerConfig = {
    primary: {
      type: 'hyperdeck',
      config: hyperdeckConfig,
    },
    fallback: {
      type: 'system',
      config: {
        frameRate,
        dropFrame: options.dropFrame ?? false,
        startTimecode: 'auto',
      },
    },
  };

  if (options.fallbackDelayMs !== undefined) {
    managerConfig.fallbackDelayMs = options.fallbackDelayMs;
  }

  return createTimecodeManager(managerConfig);
}
