/**
 * HyperDeck Timecode Provider
 *
 * Reads timecode from Blackmagic HyperDeck recorders via TCP protocol.
 * Supports both notification-based updates (protocol 1.11+) and polling fallback.
 *
 * Primary use case: Reading RP-188 timecode embedded in SDI from ATEM.
 */

import { EventEmitter } from 'events';
import {
  Hyperdeck,
  Commands,
  TransportStatus,
} from 'hyperdeck-connection';
import type {
  TimecodeProvider,
  TimecodeSnapshot,
  TimecodeSource,
  TimecodeStatus,
  HyperDeckProviderConfig,
  TransportState,
} from './types.js';
import { isValidTimecodeFormat } from './utils.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PORT = 9993;
const DEFAULT_POLL_RATE_HZ = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;
const MAX_POLL_RATE_HZ = 25;
const MIN_POLL_RATE_HZ = 1;

const DEFAULT_RECONNECT_CONFIG = {
  enabled: true,
  maxAttempts: 0, // 0 = infinite
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map HyperDeck TransportStatus to our TransportState.
 */
function mapTransportStatus(status: TransportStatus): TransportState {
  switch (status) {
    case TransportStatus.PREVIEW:
      return 'preview';
    case TransportStatus.STOPPED:
      return 'stopped';
    case TransportStatus.PLAY:
      return 'play';
    case TransportStatus.FORWARD:
      return 'forward';
    case TransportStatus.REWIND:
      return 'rewind';
    case TransportStatus.JOG:
      return 'jog';
    case TransportStatus.SHUTTLE:
      return 'shuttle';
    case TransportStatus.RECORD:
      return 'record';
    default:
      return 'stopped';
  }
}

// ============================================================================
// HyperDeck Timecode Provider
// ============================================================================

export class HyperDeckTimecodeProvider extends EventEmitter implements TimecodeProvider {
  readonly name: string;
  readonly sourceType: TimecodeSource = 'HYPERDECK_SDI';

  private readonly config: Required<HyperDeckProviderConfig>;
  private hyperdeck: Hyperdeck | null = null;
  private currentSnapshot: TimecodeSnapshot;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private notificationsEnabled = false;
  private deviceInfo: { name: string; model?: string; firmwareVersion?: string } | null = null;
  private timecodeSourceIsSdi = false; // Track whether TC source is external SDI

  constructor(config: HyperDeckProviderConfig) {
    super();

    this.name = `HyperDeck@${config.host}`;

    // Apply defaults
    this.config = {
      host: config.host,
      port: config.port ?? DEFAULT_PORT,
      pollRateHz: Math.min(
        Math.max(config.pollRateHz ?? DEFAULT_POLL_RATE_HZ, MIN_POLL_RATE_HZ),
        MAX_POLL_RATE_HZ
      ),
      useNotifications: config.useNotifications ?? true,
      requireSdiSource: config.requireSdiSource ?? true,
      connectionTimeout: config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      reconnect: {
        ...DEFAULT_RECONNECT_CONFIG,
        ...config.reconnect,
      },
    };

    // Initial snapshot
    this.currentSnapshot = this.createDisconnectedSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Public Interface
  // ---------------------------------------------------------------------------

  get isConnected(): boolean {
    return this.hyperdeck?.connected ?? false;
  }

  async connect(): Promise<void> {
    if (this.hyperdeck?.connected) {
      return;
    }

    // Clear any pending reconnect
    this.clearReconnectTimer();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error(`Connection timeout after ${this.config.connectionTimeout}ms`));
      }, this.config.connectionTimeout);

      try {
        this.hyperdeck = new Hyperdeck({ debug: false });

        // Set up event handlers before connecting
        this.setupEventHandlers(resolve, reject, timeout);

        // Initiate connection
        this.hyperdeck.connect(this.config.host, this.config.port);
      } catch (error) {
        clearTimeout(timeout);
        this.cleanup();
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.clearPollTimer();
    this.clearReconnectTimer();

    if (this.hyperdeck) {
      try {
        await this.hyperdeck.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.hyperdeck = null;
    }

    this.notificationsEnabled = false;
    this.currentSnapshot = this.createDisconnectedSnapshot();
    this.emit('disconnected');
  }

  getSnapshot(): TimecodeSnapshot {
    return this.currentSnapshot;
  }

  async readTimecode(): Promise<TimecodeSnapshot> {
    if (!this.hyperdeck?.connected) {
      return this.createDisconnectedSnapshot();
    }

    try {
      const info = await this.hyperdeck.sendCommand(new Commands.TransportInfoCommand());
      return this.processTransportInfo(info);
    } catch (error) {
      return this.createErrorSnapshot(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Connection Setup
  // ---------------------------------------------------------------------------

  private setupEventHandlers(
    resolve: () => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout
  ): void {
    if (!this.hyperdeck) return;

    // Connection established
    this.hyperdeck.once('connected', async (info) => {
      clearTimeout(timeout);

      // Store device info
      this.deviceInfo = {
        name: info.model ?? 'HyperDeck',
        model: info.model ?? undefined,
        firmwareVersion: info.protocolVersion?.toString(),
      };

      try {
        // Check timecode source configuration
        await this.checkTimecodeSource();

        // Try to enable notifications
        if (this.config.useNotifications) {
          await this.enableNotifications();
        }

        // Start polling if notifications not available
        if (!this.notificationsEnabled) {
          this.startPolling();
        }

        // Do initial timecode read
        const snapshot = await this.readTimecode();
        this.updateSnapshot(snapshot);

        this.reconnectAttempts = 0;
        this.emit('connected');
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Setup failed'));
      }
    });

    // Connection error
    this.hyperdeck.once('error', (message, error) => {
      clearTimeout(timeout);
      const err = error instanceof Error ? error : new Error(String(message));
      this.handleDisconnect(err);
      reject(err);
    });

    // Setup persistent handlers
    this.setupPersistentHandlers();
  }

  private setupPersistentHandlers(): void {
    if (!this.hyperdeck) return;

    // Handle disconnection
    this.hyperdeck.on('disconnected', () => {
      this.handleDisconnect();
    });

    // Handle errors
    this.hyperdeck.on('error', (message, error) => {
      const err = error instanceof Error ? error : new Error(String(message));
      this.emit('error', err);
    });

    // Handle transport notifications
    this.hyperdeck.on('notify.transport', (info) => {
      if (!this.notificationsEnabled) return;

      const snapshot = this.processTransportNotification(info);
      this.updateSnapshot(snapshot);
    });

    // Handle display timecode notifications (frame-accurate)
    this.hyperdeck.on('notify.displayTimecode', (info) => {
      if (!this.notificationsEnabled) return;

      // Update just the display timecode field
      const snapshot: TimecodeSnapshot = {
        ...this.currentSnapshot,
        readAt: Date.now(),
        timecode: info.displayTimecode,
        status: this.validateTimecodeStatus(info.displayTimecode),
      };
      this.updateSnapshot(snapshot);
    });
  }

  // ---------------------------------------------------------------------------
  // Timecode Source Detection
  // ---------------------------------------------------------------------------

  /**
   * Check the HyperDeck's timecode source configuration.
   * This determines whether we're reading "real" SDI-embedded TC.
   */
  private async checkTimecodeSource(): Promise<void> {
    if (!this.hyperdeck?.connected) return;

    try {
      // Query configuration to check timecode source
      // Note: The standard protocol doesn't have a direct "timecode source" query
      // We infer from whether there's valid input video
      const info = await this.hyperdeck.sendCommand(new Commands.TransportInfoCommand());

      // If there's an input video format, we likely have SDI input
      // and can potentially read embedded TC
      this.timecodeSourceIsSdi = info.inputVideoFormat !== null;

      // For more accurate detection, we'd need to check device configuration
      // which varies by model. For now, we assume SDI if there's valid input.
    } catch {
      // If query fails, assume we don't have SDI source
      this.timecodeSourceIsSdi = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  private async enableNotifications(): Promise<void> {
    if (!this.hyperdeck?.connected) return;

    try {
      const notifyCmd = new Commands.NotifySetCommand();
      notifyCmd.transport = true;
      notifyCmd.displayTimecode = true;

      await this.hyperdeck.sendCommand(notifyCmd);
      this.notificationsEnabled = true;
    } catch {
      // Notifications not supported (older protocol)
      this.notificationsEnabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private startPolling(): void {
    this.clearPollTimer();

    const intervalMs = Math.floor(1000 / this.config.pollRateHz);

    this.pollTimer = setInterval(async () => {
      if (!this.hyperdeck?.connected) {
        this.clearPollTimer();
        return;
      }

      try {
        const snapshot = await this.readTimecode();
        this.updateSnapshot(snapshot);
      } catch (error) {
        // Log but don't disconnect — let reconnect logic handle persistent failures
        this.emit('error', error instanceof Error ? error : new Error('Poll failed'));
      }
    }, intervalMs);
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------------------

  private handleDisconnect(error?: Error): void {
    this.clearPollTimer();
    this.notificationsEnabled = false;
    this.currentSnapshot = this.createDisconnectedSnapshot(error?.message);
    this.emit('update', this.currentSnapshot);
    this.emit('disconnected', error);

    // Attempt reconnection
    if (this.config.reconnect.enabled) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const { maxAttempts, initialDelayMs, maxDelayMs } = this.config.reconnect;

    // Check if we've exceeded max attempts (0 = infinite)
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.emit('error', new Error(`Max reconnection attempts (${maxAttempts}) exceeded`));
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      initialDelayMs * Math.pow(1.5, this.reconnectAttempts),
      maxDelayMs
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // Will trigger another reconnect via disconnect handler
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot Processing
  // ---------------------------------------------------------------------------

  private processTransportInfo(info: {
    status: TransportStatus;
    speed: number;
    slotId: number | null;
    clipId: number | null;
    displayTimecode: string;
    timecode: string;
    inputVideoFormat?: unknown;
  }): TimecodeSnapshot {
    const hasValidTimecode =
      isValidTimecodeFormat(info.displayTimecode) ||
      isValidTimecodeFormat(info.timecode);

    const source = this.determineSource(hasValidTimecode);
    const status = this.determineStatus(info.displayTimecode, source);

    // Build transport object conditionally to satisfy exactOptionalPropertyTypes
    const transport: TimecodeSnapshot['transport'] = {
      state: mapTransportStatus(info.status),
      speed: info.speed,
      ...(info.slotId !== null && { slotId: info.slotId }),
      ...(info.clipId !== null && { clipId: info.clipId }),
    };

    const snapshot: TimecodeSnapshot = {
      readAt: Date.now(),
      timecode: isValidTimecodeFormat(info.displayTimecode) ? info.displayTimecode : null,
      timelineTimecode: isValidTimecodeFormat(info.timecode) ? info.timecode : null,
      source,
      status,
      frameRate: 25, // TODO: Parse from video format
      dropFrame: false, // TODO: Detect from timecode format
      transport,
    };

    if (this.deviceInfo) {
      return { ...snapshot, device: this.deviceInfo };
    }

    return snapshot;
  }

  private processTransportNotification(info: {
    status?: TransportStatus;
    speed?: number;
    slotId?: number | null;
    clipId?: number | null;
    displayTimecode?: string;
    timecode?: string;
  }): TimecodeSnapshot {
    // Merge with current snapshot, updating only provided fields
    const displayTc = info.displayTimecode ?? this.currentSnapshot.timecode;
    const timelineTc = info.timecode ?? this.currentSnapshot.timelineTimecode;

    const hasValidDisplayTc = displayTc !== null && isValidTimecodeFormat(displayTc);
    const hasValidTimelineTc = timelineTc !== null && isValidTimecodeFormat(timelineTc);
    const hasValidTimecode = hasValidDisplayTc || hasValidTimelineTc;

    const source = this.determineSource(hasValidTimecode);
    const status = this.determineStatus(displayTc, source);

    // Resolve slot/clip IDs, handling null from notification vs undefined from current
    const slotId = info.slotId !== undefined
      ? (info.slotId ?? undefined)
      : this.currentSnapshot.transport?.slotId;
    const clipId = info.clipId !== undefined
      ? (info.clipId ?? undefined)
      : this.currentSnapshot.transport?.clipId;

    // Build transport object conditionally
    const transport: TimecodeSnapshot['transport'] = {
      state: info.status
        ? mapTransportStatus(info.status)
        : this.currentSnapshot.transport?.state ?? 'stopped',
      speed: info.speed ?? this.currentSnapshot.transport?.speed ?? 0,
      ...(slotId !== undefined && { slotId }),
      ...(clipId !== undefined && { clipId }),
    };

    const snapshot: TimecodeSnapshot = {
      readAt: Date.now(),
      timecode: hasValidDisplayTc ? displayTc : null,
      timelineTimecode: hasValidTimelineTc ? timelineTc : null,
      source,
      status,
      frameRate: this.currentSnapshot.frameRate,
      dropFrame: this.currentSnapshot.dropFrame,
      transport,
    };

    if (this.deviceInfo) {
      return { ...snapshot, device: this.deviceInfo };
    }

    return snapshot;
  }

  private determineSource(hasValidTimecode: boolean): TimecodeSource {
    if (!hasValidTimecode) {
      return 'HYPERDECK_UNKNOWN';
    }

    // If we've verified SDI input, report as SDI source
    if (this.timecodeSourceIsSdi) {
      return 'HYPERDECK_SDI';
    }

    // Otherwise, it's internal timecode
    return 'HYPERDECK_INTERNAL';
  }

  private determineStatus(
    timecode: string | null | undefined,
    source: TimecodeSource
  ): TimecodeStatus {
    // No valid timecode
    if (!timecode || !isValidTimecodeFormat(timecode)) {
      return 'NO_SIGNAL';
    }

    // Zero timecode might indicate no signal
    if (timecode === '00:00:00:00' || timecode === '00:00:00;00') {
      // Could be valid start, or could be no signal — report as OK but flag
      // Application can check transport state for more context
    }

    // If we require SDI source but don't have it
    if (this.config.requireSdiSource && source !== 'HYPERDECK_SDI') {
      return 'DEGRADED';
    }

    return 'OK';
  }

  private validateTimecodeStatus(timecode: string | null | undefined): TimecodeStatus {
    if (!timecode || !isValidTimecodeFormat(timecode)) {
      return 'NO_SIGNAL';
    }
    if (this.config.requireSdiSource && !this.timecodeSourceIsSdi) {
      return 'DEGRADED';
    }
    return 'OK';
  }

  private updateSnapshot(snapshot: TimecodeSnapshot): void {
    this.currentSnapshot = snapshot;
    this.emit('update', snapshot);
  }

  // ---------------------------------------------------------------------------
  // Snapshot Factories
  // ---------------------------------------------------------------------------

  private createDisconnectedSnapshot(errorMsg?: string): TimecodeSnapshot {
    const snapshot: TimecodeSnapshot = {
      readAt: Date.now(),
      timecode: null,
      timelineTimecode: null,
      source: 'HYPERDECK_UNKNOWN',
      status: 'DISCONNECTED',
      frameRate: 25,
      dropFrame: false,
    };

    if (this.deviceInfo) {
      (snapshot as { device?: TimecodeSnapshot['device'] }).device = this.deviceInfo;
    }
    if (errorMsg) {
      (snapshot as { error?: string }).error = errorMsg;
    }

    return snapshot;
  }

  private createErrorSnapshot(errorMsg: string): TimecodeSnapshot {
    const snapshot: TimecodeSnapshot = {
      readAt: Date.now(),
      timecode: null,
      timelineTimecode: null,
      source: 'HYPERDECK_UNKNOWN',
      status: 'ERROR',
      frameRate: this.currentSnapshot.frameRate,
      dropFrame: this.currentSnapshot.dropFrame,
      error: errorMsg,
    };

    if (this.deviceInfo) {
      (snapshot as { device?: TimecodeSnapshot['device'] }).device = this.deviceInfo;
    }

    return snapshot;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.clearPollTimer();
    this.clearReconnectTimer();
    this.hyperdeck = null;
    this.notificationsEnabled = false;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a HyperDeck timecode provider.
 */
export function createHyperDeckProvider(
  config: HyperDeckProviderConfig
): HyperDeckTimecodeProvider {
  return new HyperDeckTimecodeProvider(config);
}
