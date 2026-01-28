/**
 * System Clock Timecode Provider
 *
 * Generates SMPTE timecode from system time.
 * Used as fallback when external timecode sources are unavailable.
 *
 * Supports:
 * - Time-of-day timecode (real wall clock)
 * - Fixed start timecode with elapsed time
 * - Configurable frame rate and drop-frame
 */

import { EventEmitter } from 'events';
import type {
  TimecodeProvider,
  TimecodeSnapshot,
  TimecodeSource,
  SystemClockProviderConfig,
} from './types.js';
import {
  dateToTimecode,
  formatTimecodeFromFrames,
  parseTimecode,
  timecodeToFrames,
} from './utils.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FRAME_RATE = 25;
const DEFAULT_UPDATE_RATE_HZ = 25;

// ============================================================================
// System Clock Provider
// ============================================================================

export class SystemClockTimecodeProvider extends EventEmitter implements TimecodeProvider {
  readonly name = 'SystemClock';
  readonly sourceType: TimecodeSource = 'SYSTEM';

  private readonly config: Required<SystemClockProviderConfig>;
  private currentSnapshot: TimecodeSnapshot;
  private updateTimer: NodeJS.Timeout | null = null;
  private startTime: number; // performance.now() at start
  private startFrameOffset: number; // Starting frame count
  private running = false;

  // Drift monitoring
  private lastWallClockMs = 0;
  private lastPerformanceMs = 0;
  private cumulativeDriftMs = 0;
  private readonly maxDriftWarningMs = 100;

  constructor(config: SystemClockProviderConfig) {
    super();

    this.config = {
      frameRate: config.frameRate ?? DEFAULT_FRAME_RATE,
      dropFrame: config.dropFrame ?? false,
      startTimecode: config.startTimecode ?? 'auto',
      updateRateHz: config.updateRateHz ?? Math.min(config.frameRate ?? DEFAULT_FRAME_RATE, DEFAULT_UPDATE_RATE_HZ),
    };

    // Calculate starting frame offset
    this.startFrameOffset = this.calculateStartFrameOffset();
    this.startTime = performance.now();

    // Initial snapshot
    this.currentSnapshot = this.createSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Public Interface
  // ---------------------------------------------------------------------------

  get isConnected(): boolean {
    return this.running;
  }

  async connect(): Promise<void> {
    if (this.running) {
      return;
    }

    // Reset timing
    this.startTime = performance.now();
    this.startFrameOffset = this.calculateStartFrameOffset();
    this.lastWallClockMs = Date.now();
    this.lastPerformanceMs = performance.now();
    this.cumulativeDriftMs = 0;

    // Start update loop
    this.startUpdateLoop();
    this.running = true;

    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.stopUpdateLoop();
    this.running = false;
    this.emit('disconnected');
  }

  getSnapshot(): TimecodeSnapshot {
    return this.currentSnapshot;
  }

  async readTimecode(): Promise<TimecodeSnapshot> {
    return this.createSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Timecode Generation
  // ---------------------------------------------------------------------------

  private calculateStartFrameOffset(): number {
    const { startTimecode, frameRate } = this.config;

    if (startTimecode === 'auto') {
      // Use time-of-day — calculate frame offset from midnight
      const now = new Date();
      const midnightMs =
        now.getTime() -
        now.getHours() * 3600000 -
        now.getMinutes() * 60000 -
        now.getSeconds() * 1000 -
        now.getMilliseconds();

      const elapsedSinceMidnightMs = now.getTime() - midnightMs;
      return Math.floor((elapsedSinceMidnightMs / 1000) * frameRate);
    }

    // Parse fixed start timecode
    const components = parseTimecode(startTimecode);
    if (!components) {
      // Invalid start TC, use 01:00:00:00
      return Math.floor(3600 * frameRate); // 1 hour
    }

    return timecodeToFrames(components, frameRate);
  }

  private createSnapshot(): TimecodeSnapshot {
    const { frameRate, dropFrame, startTimecode } = this.config;
    const now = Date.now();

    let timecode: string;

    if (startTimecode === 'auto') {
      // Time-of-day mode — generate from current date
      timecode = dateToTimecode(new Date(), frameRate, dropFrame);
    } else {
      // Elapsed time mode — calculate frames since start
      const elapsedMs = performance.now() - this.startTime;
      const elapsedFrames = Math.floor((elapsedMs / 1000) * frameRate);
      const totalFrames = this.startFrameOffset + elapsedFrames;
      timecode = formatTimecodeFromFrames(totalFrames, frameRate, dropFrame);
    }

    return {
      readAt: now,
      timecode,
      timelineTimecode: timecode, // Same for system clock
      source: 'SYSTEM',
      status: 'OK',
      frameRate,
      dropFrame,
      device: {
        name: 'System Clock',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Update Loop
  // ---------------------------------------------------------------------------

  private startUpdateLoop(): void {
    this.stopUpdateLoop();

    const intervalMs = Math.floor(1000 / this.config.updateRateHz);

    this.updateTimer = setInterval(() => {
      // Monitor drift
      this.checkDrift();

      // Generate and emit snapshot
      const snapshot = this.createSnapshot();
      this.currentSnapshot = snapshot;
      this.emit('update', snapshot);
    }, intervalMs);
  }

  private stopUpdateLoop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Drift Monitoring
  // ---------------------------------------------------------------------------

  /**
   * Monitor drift between wall clock and performance timer.
   * Logs warning if drift exceeds threshold.
   */
  private checkDrift(): void {
    const wallClockNow = Date.now();
    const performanceNow = performance.now();

    if (this.lastWallClockMs > 0) {
      const wallClockDelta = wallClockNow - this.lastWallClockMs;
      const performanceDelta = performanceNow - this.lastPerformanceMs;
      const drift = wallClockDelta - performanceDelta;

      this.cumulativeDriftMs += drift;

      if (Math.abs(this.cumulativeDriftMs) > this.maxDriftWarningMs) {
        this.emit('error', new Error(
          `System clock drift detected: ${this.cumulativeDriftMs.toFixed(1)}ms cumulative`
        ));
        // Reset to prevent spam
        this.cumulativeDriftMs = 0;
      }
    }

    this.lastWallClockMs = wallClockNow;
    this.lastPerformanceMs = performanceNow;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a system clock timecode provider.
 */
export function createSystemClockProvider(
  config: SystemClockProviderConfig
): SystemClockTimecodeProvider {
  return new SystemClockTimecodeProvider(config);
}
