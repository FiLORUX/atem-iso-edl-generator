/**
 * ATEM Switcher Adapter.
 * Connects to Blackmagic ATEM switchers and emits switching events.
 */

import { Atem } from 'atem-connection';
import type { AtemState } from 'atem-connection';
import { EventEmitter } from 'node:events';
import type { AtemConfig, InputConfig } from '../../core/config/schema.js';
import type {
  ProgramChangeEvent,
  PreviewChangeEvent,
  TransitionStartEvent,
  TransitionCompleteEvent,
  ConnectionEvent,
  InputSource,
  TransitionType,
} from '../../core/events/types.js';
import { createTimestamp } from '../../core/events/types.js';

// ============================================================================
// Types
// ============================================================================

export interface AtemAdapterOptions {
  config: AtemConfig;
  inputs: Record<number, InputConfig>;
  mixEffect?: number;
}

export interface AtemAdapterEvents {
  programChange: (event: ProgramChangeEvent) => void;
  previewChange: (event: PreviewChangeEvent) => void;
  transitionStart: (event: TransitionStartEvent) => void;
  transitionComplete: (event: TransitionCompleteEvent) => void;
  connection: (event: ConnectionEvent) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Adapter Implementation
// ============================================================================

export class AtemAdapter extends EventEmitter {
  private readonly atem: Atem;
  private readonly config: AtemConfig;
  private readonly inputs: Record<number, InputConfig>;
  private readonly mixEffect: number;

  private connected = false;
  private lastProgramInput: number | null = null;
  private lastPreviewInput: number | null = null;
  private inTransition = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: AtemAdapterOptions) {
    super();
    this.config = options.config;
    this.inputs = options.inputs;
    this.mixEffect = options.mixEffect ?? options.config.mixEffect;
    this.atem = new Atem();

    this.setupEventHandlers();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Connect to the ATEM switcher.
   */
  async connect(): Promise<void> {
    try {
      await this.atem.connect(this.config.host);
    } catch (error) {
      this.handleConnectionError(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from the ATEM switcher.
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    await this.atem.disconnect();
    this.connected = false;
  }

  /**
   * Check if connected to ATEM.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current ATEM state.
   */
  getState(): AtemState | undefined {
    return this.atem.state;
  }

  /**
   * Get current program input.
   */
  getCurrentProgram(): number | null {
    return this.lastProgramInput;
  }

  /**
   * Get current preview input.
   */
  getCurrentPreview(): number | null {
    return this.lastPreviewInput;
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  private setupEventHandlers(): void {
    this.atem.on('connected', () => {
      this.handleConnected();
    });

    this.atem.on('disconnected', () => {
      this.handleDisconnected();
    });

    this.atem.on('error', (error: string) => {
      this.handleError(new Error(error));
    });

    this.atem.on('stateChanged', (state, pathToChange) => {
      this.handleStateChanged(state, pathToChange);
    });
  }

  private handleConnected(): void {
    this.connected = true;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();

    // Capture initial state
    const me = this.atem.state?.video.mixEffects[this.mixEffect];
    if (me) {
      this.lastProgramInput = me.programInput;
      this.lastPreviewInput = me.previewInput;
    }

    const event: ConnectionEvent = {
      type: 'connection',
      timestamp: createTimestamp(),
      device: 'atem',
      deviceName: this.config.host,
      state: 'connected',
    };

    this.emit('connection', event);
  }

  private handleDisconnected(): void {
    this.connected = false;

    const event: ConnectionEvent = {
      type: 'connection',
      timestamp: createTimestamp(),
      device: 'atem',
      deviceName: this.config.host,
      state: 'disconnected',
    };

    this.emit('connection', event);
    this.scheduleReconnect();
  }

  private handleError(error: Error): void {
    this.emit('error', error);
  }

  private handleConnectionError(error: Error): void {
    const event: ConnectionEvent = {
      type: 'connection',
      timestamp: createTimestamp(),
      device: 'atem',
      deviceName: this.config.host,
      state: 'error',
      error: error.message,
    };

    this.emit('connection', event);
    this.scheduleReconnect();
  }

  private handleStateChanged(state: AtemState, pathToChange: string[]): void {
    const path = pathToChange.join('.');

    // Filter for relevant M/E changes
    const mePrefix = `video.mixEffects.${this.mixEffect}`;

    if (path.startsWith(mePrefix)) {
      this.handleMixEffectChange(state, path);
    }
  }

  private handleMixEffectChange(state: AtemState, path: string): void {
    const me = state.video.mixEffects[this.mixEffect];
    if (!me) return;

    // Program input change
    if (path.includes('programInput') && me.programInput !== this.lastProgramInput) {
      this.emitProgramChange(me.programInput, me);
      this.lastProgramInput = me.programInput;
    }

    // Preview input change
    if (path.includes('previewInput') && me.previewInput !== this.lastPreviewInput) {
      this.emitPreviewChange(me.previewInput);
      this.lastPreviewInput = me.previewInput;
    }

    // Transition state
    if (path.includes('transition')) {
      const transitionPos = Number(me.transitionPosition);
      if (transitionPos > 0 && !this.inTransition) {
        this.inTransition = true;
        this.emitTransitionStart(me);
      } else if (transitionPos === 0 && this.inTransition) {
        this.inTransition = false;
        this.emitTransitionComplete(me);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Event Emitters
  // --------------------------------------------------------------------------

  private emitProgramChange(inputId: number, me: AtemState['video']['mixEffects'][number]): void {
    const transitionType = this.mapTransitionStyle(me?.transitionProperties.style);
    const transitionFrames = me?.transitionSettings.mix?.rate ?? 0;

    const event: ProgramChangeEvent = {
      type: 'program_change',
      timestamp: createTimestamp(),
      mixEffect: this.mixEffect,
      input: this.buildInputSource(inputId),
      previousInput: this.lastProgramInput !== null
        ? this.buildInputSource(this.lastProgramInput)
        : null,
      transitionType,
      transitionFrames,
    };

    this.emit('programChange', event);
  }

  private emitPreviewChange(inputId: number): void {
    const event: PreviewChangeEvent = {
      type: 'preview_change',
      timestamp: createTimestamp(),
      mixEffect: this.mixEffect,
      input: this.buildInputSource(inputId),
      previousInput: this.lastPreviewInput !== null
        ? this.buildInputSource(this.lastPreviewInput)
        : null,
    };

    this.emit('previewChange', event);
  }

  private emitTransitionStart(me: AtemState['video']['mixEffects'][number]): void {
    const transitionType = this.mapTransitionStyle(me?.transitionProperties.style);
    const transitionFrames = me?.transitionSettings.mix?.rate ?? 0;

    const event: TransitionStartEvent = {
      type: 'transition_start',
      timestamp: createTimestamp(),
      mixEffect: this.mixEffect,
      transitionType,
      transitionFrames,
      fromInput: this.buildInputSource(me?.programInput ?? 0),
      toInput: this.buildInputSource(me?.previewInput ?? 0),
    };

    this.emit('transitionStart', event);
  }

  private emitTransitionComplete(me: AtemState['video']['mixEffects'][number]): void {
    const transitionType = this.mapTransitionStyle(me?.transitionProperties.style);
    const transitionFrames = me?.transitionSettings.mix?.rate ?? 0;

    const event: TransitionCompleteEvent = {
      type: 'transition_complete',
      timestamp: createTimestamp(),
      mixEffect: this.mixEffect,
      transitionType,
      transitionFrames,
      input: this.buildInputSource(me?.programInput ?? 0),
    };

    this.emit('transitionComplete', event);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildInputSource(inputId: number): InputSource {
    const config = this.inputs[inputId];

    return {
      inputId,
      name: config?.name ?? `Input ${inputId}`,
      reelName: config?.reelName ?? `IN${inputId}`,
    };
  }

  private mapTransitionStyle(style: number | undefined): TransitionType {
    // ATEM transition styles:
    // 0 = Mix, 1 = Dip, 2 = Wipe, 3 = DVE, 4 = Sting
    switch (style) {
      case 0: return 'mix';
      case 1: return 'dip';
      case 2: return 'wipe';
      case 3: return 'dve';
      case 4: return 'sting';
      default: return 'cut';
    }
  }

  private scheduleReconnect(): void {
    if (!this.config.reconnect.enabled) return;

    const { maxAttempts, initialDelayMs, maxDelayMs } = this.config.reconnect;

    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.emit('error', new Error(`Max reconnection attempts (${maxAttempts}) reached`));
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      initialDelayMs * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      maxDelayMs
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch {
        // Error handling is done in connect()
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and connect an ATEM adapter.
 */
export async function createAtemAdapter(options: AtemAdapterOptions): Promise<AtemAdapter> {
  const adapter = new AtemAdapter(options);
  await adapter.connect();
  return adapter;
}
