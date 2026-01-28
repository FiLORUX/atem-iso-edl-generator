/**
 * HyperDeck Adapter.
 * Connects to Blackmagic HyperDeck recorders over TCP and monitors recording state.
 *
 * The HyperDeck Ethernet Protocol is a text-based protocol over TCP port 9993.
 * This adapter handles connection management, command/response flow, async
 * notifications, and automatic reconnection with exponential backoff.
 */

import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import type {
  TransportInfo,
  ClipInfo,
  ProtocolResponse,
  HyperDeckState,
  HyperDeckAdapterOptions,
  HyperDeckAdapterEvents,
  PendingCommand,
  ReconnectConfig,
} from './types.js';
import {
  parseResponse,
  parseTransportInfo,
  parseClipList,
  parseAsyncNotification,
  isSuccessCode,
  isNotificationCode,
  Commands,
  TERMINATOR,
  END_OF_RESPONSE,
} from './protocol.js';
import type { ConnectionEvent, Timestamp } from '../../core/events/types.js';
import { createTimestamp } from '../../core/events/types.js';
import { applyFrameOffset } from '../../core/timecode/offset.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PORT = 9993;
const DEFAULT_TIMEOUT = 5000;
const COMMAND_TIMEOUT = 10000;

const DEFAULT_RECONNECT: ReconnectConfig = {
  enabled: true,
  maxAttempts: 0, // Infinite
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

// ============================================================================
// Typed EventEmitter
// ============================================================================

type HyperDeckEventKey = keyof HyperDeckAdapterEvents;

/**
 * Typed EventEmitter for HyperDeck events.
 * Avoids unsafe declaration merging between interface and class.
 */
class TypedEventEmitter extends EventEmitter {
  override on<K extends HyperDeckEventKey>(
    event: K,
    listener: HyperDeckAdapterEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override off<K extends HyperDeckEventKey>(
    event: K,
    listener: HyperDeckAdapterEvents[K]
  ): this {
    return super.off(event, listener);
  }

  override emit<K extends HyperDeckEventKey>(
    event: K,
    ...args: Parameters<HyperDeckAdapterEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Adapter Implementation
// ============================================================================

/**
 * HyperDeck adapter for monitoring recording state and timecode.
 *
 * Emits events:
 * - 'connected' - Successfully connected to HyperDeck
 * - 'disconnected' - Connection lost
 * - 'error' - Error occurred
 * - 'transportChanged' - Transport state changed
 * - 'recordingStarted' - Recording began
 * - 'recordingStopped' - Recording ended
 * - 'clipAdded' - New clip detected
 *
 * @example
 * const hyperdeck = new HyperDeckAdapter({
 *   name: 'HyperDeck 1',
 *   host: '192.168.1.100',
 *   inputMapping: 1,
 * });
 *
 * hyperdeck.on('recordingStarted', (clipName, timecode) => {
 *   console.log(`Recording ${clipName} at ${timecode}`);
 * });
 *
 * await hyperdeck.connect();
 */
export class HyperDeckAdapter extends TypedEventEmitter {
  private readonly deckName: string;
  private readonly host: string;
  private readonly port: number;
  private readonly inputMapping: number;
  private readonly frameOffset: number;
  private readonly frameRate: number;
  private readonly reconnectConfig: ReconnectConfig;

  private socket: Socket | null = null;
  private state: HyperDeckState = 'disconnected';
  private buffer = '';

  // Command queue for request/response matching
  private commandQueue: PendingCommand[] = [];

  // State tracking
  private lastTransportInfo: TransportInfo | null = null;
  private wasRecording = false;
  private currentRecordingStart: string | null = null;
  private lastClipCount = 0;

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;

  constructor(options: HyperDeckAdapterOptions) {
    super();
    this.deckName = options.name;
    this.host = options.host;
    this.port = options.port ?? DEFAULT_PORT;
    this.inputMapping = options.inputMapping;
    this.frameOffset = options.frameOffset ?? 0;
    this.frameRate = options.frameRate ?? 25;
    this.reconnectConfig = {
      ...DEFAULT_RECONNECT,
      ...options.reconnect,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Connect to the HyperDeck.
   *
   * @param host - Optional host override
   * @param port - Optional port override
   * @throws Error if connection fails
   */
  async connect(host?: string, port?: number): Promise<void> {
    const targetHost = host ?? this.host;
    const targetPort = port ?? this.port;

    if (this.state === 'connected') {
      return;
    }

    this.manualDisconnect = false;
    this.state = 'connecting';

    return new Promise((resolve, reject) => {
      this.socket = new Socket();

      const connectTimeout = setTimeout(() => {
        this.socket?.destroy();
        const error = new Error(
          `Connection timeout to ${targetHost}:${String(targetPort)}`
        );
        this.handleConnectionError(error);
        reject(error);
      }, DEFAULT_TIMEOUT);

      this.socket.on('connect', () => {
        clearTimeout(connectTimeout);
        this.handleConnect();
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        clearTimeout(connectTimeout);
        this.handleClose();
      });

      this.socket.on('error', (error) => {
        clearTimeout(connectTimeout);
        this.handleSocketError(error);
        if (this.state === 'connecting') {
          reject(error);
        }
      });

      this.socket.connect(targetPort, targetHost);
    });
  }

  /**
   * Disconnect from the HyperDeck.
   */
  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.rejectPendingCommands(new Error('Disconnecting'));

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.state = 'disconnected';
  }

  /**
   * Check if connected to HyperDeck.
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * Get current connection state.
   */
  getState(): HyperDeckState {
    return this.state;
  }

  /**
   * Get the HyperDeck name.
   */
  getName(): string {
    return this.deckName;
  }

  /**
   * Get the ATEM input mapping.
   */
  getInputMapping(): number {
    return this.inputMapping;
  }

  /**
   * Send a raw command to the HyperDeck.
   *
   * @param command - Command string (without terminator)
   * @returns Promise resolving to the response
   */
  async sendCommand(command: string): Promise<ProtocolResponse> {
    const currentSocket = this.socket;
    if (!currentSocket || this.state !== 'connected') {
      throw new Error('Not connected to HyperDeck');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeFromQueue(pending);
        reject(new Error(`Command timeout: ${command}`));
      }, COMMAND_TIMEOUT);

      const pending: PendingCommand = {
        command,
        resolve,
        reject,
        timeout,
      };

      this.commandQueue.push(pending);

      // Ensure command has terminator
      const fullCommand = command.endsWith(TERMINATOR)
        ? command
        : command + TERMINATOR;

      currentSocket.write(fullCommand);
    });
  }

  /**
   * Subscribe to transport change notifications.
   * Must be called after connect() to receive async updates.
   */
  async subscribeToTransport(): Promise<void> {
    const response = await this.sendCommand(Commands.NOTIFY_TRANSPORT.trim());
    if (!isSuccessCode(response.code)) {
      throw new Error(`Failed to subscribe to transport: ${response.message}`);
    }
  }

  /**
   * Query current transport information.
   */
  async queryTransportInfo(): Promise<TransportInfo> {
    const response = await this.sendCommand(Commands.TRANSPORT_INFO.trim());
    if (!isSuccessCode(response.code)) {
      throw new Error(`Failed to query transport info: ${response.message}`);
    }
    return parseTransportInfo(response.data);
  }

  /**
   * Query clips on the current slot.
   */
  async queryClips(): Promise<ClipInfo[]> {
    const response = await this.sendCommand(Commands.CLIPS_GET.trim());
    if (!isSuccessCode(response.code)) {
      throw new Error(`Failed to query clips: ${response.message}`);
    }
    const clipList = parseClipList(response.data);
    return clipList.clips;
  }

  /**
   * Get current timecode from transport.
   */
  async getCurrentTimecode(): Promise<string> {
    const transport = await this.queryTransportInfo();
    return transport.timecode;
  }

  /**
   * Get current clip name from transport.
   * Returns the name of the clip at the current position.
   */
  async getCurrentClipName(): Promise<string> {
    const transport = await this.queryTransportInfo();
    if (transport.clipId === 0) {
      return '';
    }

    const clips = await this.queryClips();
    const currentClip = clips.find(c => c.id === transport.clipId);
    return currentClip?.name ?? '';
  }

  /**
   * Get the last known transport info without querying.
   */
  getLastTransportInfo(): TransportInfo | null {
    return this.lastTransportInfo;
  }

  /**
   * Check if currently recording.
   */
  isRecording(): boolean {
    return this.lastTransportInfo?.status === 'record';
  }

  // --------------------------------------------------------------------------
  // Connection Handlers
  // --------------------------------------------------------------------------

  private handleConnect(): void {
    this.state = 'connected';
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();

    // Initial setup: subscribe to notifications and query state
    void this.initialise();

    this.emit('connected');
  }

  private async initialise(): Promise<void> {
    try {
      // Subscribe to transport notifications for real-time updates
      await this.subscribeToTransport();

      // Query initial transport state
      const transport = await this.queryTransportInfo();
      this.lastTransportInfo = transport;
      this.wasRecording = transport.status === 'record';

      // Query initial clip count
      const clips = await this.queryClips();
      this.lastClipCount = clips.length;

      // If already recording, emit event
      if (this.wasRecording) {
        this.currentRecordingStart = transport.timecode;
      }
    } catch (error: unknown) {
      // Log but don't fail - connection is still valid
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
    }
  }

  private handleClose(): void {
    const wasConnected = this.state === 'connected';
    this.state = 'disconnected';
    this.socket = null;
    this.rejectPendingCommands(new Error('Connection closed'));

    if (wasConnected) {
      this.emit('disconnected');
    }

    if (!this.manualDisconnect) {
      this.scheduleReconnect();
    }
  }

  private handleSocketError(error: Error): void {
    this.state = 'error';
    this.emit('error', error);
  }

  private handleConnectionError(error: Error): void {
    this.state = 'error';
    this.emit('error', error);

    if (!this.manualDisconnect) {
      this.scheduleReconnect();
    }
  }

  // --------------------------------------------------------------------------
  // Data Handling
  // --------------------------------------------------------------------------

  private handleData(data: Buffer): void {
    // Accumulate data in buffer
    this.buffer += data.toString();

    // Process complete responses (end with \r\n\r\n or single \r\n for simple responses)
    this.processBuffer();
  }

  private processBuffer(): void {
    // Try to extract complete responses from buffer
    // Responses end with either \r\n (simple) or \r\n\r\n (multi-line)

    while (this.buffer.length > 0) {
      // Check for multi-line response (ends with \r\n\r\n)
      const multiLineEnd = this.buffer.indexOf(END_OF_RESPONSE);
      if (multiLineEnd !== -1) {
        const response = this.buffer.substring(0, multiLineEnd);
        this.buffer = this.buffer.substring(multiLineEnd + END_OF_RESPONSE.length);
        this.handleResponse(response);
        continue;
      }

      // Check for simple response (single line ending with \r\n)
      const simpleEnd = this.buffer.indexOf(TERMINATOR);
      if (simpleEnd !== -1) {
        // Peek ahead to see if this might be the start of a multi-line response
        const line = this.buffer.substring(0, simpleEnd);
        const nextLineStart = simpleEnd + TERMINATOR.length;

        // If the line ends with ':' and there's more data, it's multi-line
        if (line.endsWith(':') && nextLineStart < this.buffer.length) {
          // Wait for more data to complete the multi-line response
          break;
        }

        // Simple single-line response
        this.buffer = this.buffer.substring(nextLineStart);
        this.handleResponse(line);
        continue;
      }

      // No complete response yet, wait for more data
      break;
    }
  }

  private handleResponse(rawResponse: string): void {
    const response = parseResponse(rawResponse);

    // Check if this is an async notification
    if (isNotificationCode(response.code)) {
      this.handleNotification(response);
      return;
    }

    // Match response to pending command
    const pending = this.commandQueue.shift();
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(response);
    }
  }

  private handleNotification(response: ProtocolResponse): void {
    const notification = parseAsyncNotification(response);
    if (!notification) return;

    switch (notification.type) {
      case 'transport':
        this.handleTransportNotification(response.data);
        break;
      case 'slot':
        // Slot changes (media inserted/removed) could be handled here
        break;
    }
  }

  private handleTransportNotification(data: Record<string, string>): void {
    const transport = parseTransportInfo(data);
    const previousTransport = this.lastTransportInfo;
    this.lastTransportInfo = transport;

    // Emit general transport change
    this.emit('transportChanged', transport);

    // Detect recording state changes
    const isNowRecording = transport.status === 'record';

    if (isNowRecording && !this.wasRecording) {
      // Recording started
      this.currentRecordingStart = transport.timecode;
      this.emit('recordingStarted', '', transport.timecode);

      // Query for new clip name after a brief delay (clip may not be created yet)
      setTimeout(() => {
        void this.detectNewClip();
      }, 500);
    } else if (!isNowRecording && this.wasRecording) {
      // Recording stopped
      const duration = this.calculateDuration(
        this.currentRecordingStart ?? '00:00:00:00',
        previousTransport?.timecode ?? transport.timecode
      );
      this.emit('recordingStopped', '', duration);
      this.currentRecordingStart = null;
    }

    this.wasRecording = isNowRecording;
  }

  private async detectNewClip(): Promise<void> {
    try {
      const clips = await this.queryClips();
      if (clips.length > this.lastClipCount) {
        // New clip(s) added
        const newClips = clips.slice(this.lastClipCount);
        for (const clip of newClips) {
          this.emit('clipAdded', clip);

          // Re-emit recording started with actual clip name
          if (this.isRecording()) {
            this.emit('recordingStarted', clip.name, clip.startTimecode);
          }
        }
      }
      this.lastClipCount = clips.length;
    } catch {
      // Ignore errors during clip detection
    }
  }

  /**
   * Calculate duration between two timecodes.
   * This is a simplified calculation - proper implementation would parse timecodes.
   */
  private calculateDuration(_start: string, end: string): string {
    // For now, return the end timecode as a placeholder
    // A proper implementation would parse and subtract timecodes
    return end;
  }

  // --------------------------------------------------------------------------
  // Command Queue Management
  // --------------------------------------------------------------------------

  private removeFromQueue(command: PendingCommand): void {
    const index = this.commandQueue.indexOf(command);
    if (index !== -1) {
      this.commandQueue.splice(index, 1);
    }
  }

  private rejectPendingCommands(error: Error): void {
    for (const pending of this.commandQueue) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.commandQueue = [];
  }

  // --------------------------------------------------------------------------
  // Reconnection
  // --------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (!this.reconnectConfig.enabled) return;
    if (this.manualDisconnect) return;

    const { maxAttempts, initialDelayMs, maxDelayMs } = this.reconnectConfig;

    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.emit('error', new Error(`Max reconnection attempts (${String(maxAttempts)}) reached`));
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      initialDelayMs * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      maxDelayMs
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      void this.connect().catch(() => {
        // Error handling done in connect()
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Timestamp Helpers
  // --------------------------------------------------------------------------

  /**
   * Create a timestamp with frame offset compensation applied.
   */
  createOffsetTimestamp(): Timestamp {
    const baseTimestamp = createTimestamp();

    if (this.frameOffset === 0) {
      return baseTimestamp;
    }

    return applyFrameOffset(baseTimestamp, this.frameOffset, this.frameRate);
  }

  /**
   * Create a connection event for this HyperDeck.
   */
  createConnectionEvent(state: 'connected' | 'disconnected' | 'error', error?: string): ConnectionEvent {
    const event: ConnectionEvent = {
      type: 'connection',
      timestamp: this.createOffsetTimestamp(),
      device: 'hyperdeck',
      deviceName: this.deckName,
      state,
    };

    if (error !== undefined) {
      event.error = error;
    }

    return event;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and connect a HyperDeck adapter.
 *
 * @param options - Adapter configuration options
 * @returns Connected HyperDeck adapter
 *
 * @example
 * const hyperdeck = await createHyperDeckAdapter({
 *   name: 'HyperDeck 1',
 *   host: '192.168.1.100',
 *   inputMapping: 1,
 * });
 */
export async function createHyperDeckAdapter(
  options: HyperDeckAdapterOptions
): Promise<HyperDeckAdapter> {
  const adapter = new HyperDeckAdapter(options);
  await adapter.connect();
  return adapter;
}

/**
 * Create multiple HyperDeck adapters from configuration.
 *
 * @param configs - Array of HyperDeck configurations
 * @returns Array of connected adapters
 */
export async function createHyperDeckAdapters(
  configs: HyperDeckAdapterOptions[]
): Promise<HyperDeckAdapter[]> {
  return Promise.all(
    configs.map(config => createHyperDeckAdapter(config))
  );
}
