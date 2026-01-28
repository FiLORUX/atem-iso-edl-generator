/**
 * Frame offset utilities for timestamp compensation.
 * Used to correct for processing delays in broadcast equipment.
 *
 * In live broadcast environments, various pieces of equipment introduce
 * latency: ATEM switchers typically add 1-2 frames of processing delay,
 * and different HyperDeck units may have varying recording delays.
 *
 * This module provides frame-accurate timestamp adjustment to ensure
 * EDL cut points align precisely with the actual video content.
 */

import type { Timestamp } from '../events/types.js';

// ============================================================================
// Constants
// ============================================================================

const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const MILLISECONDS_PER_SECOND = 1000;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Apply a frame offset to a timestamp.
 *
 * Adjusts the timestamp by the specified number of frames, accounting for
 * the frame rate. This is essential for compensating for equipment latency
 * in broadcast chains.
 *
 * @param timestamp - The original timestamp to adjust
 * @param offsetFrames - Number of frames to offset (positive = delay, negative = advance)
 * @param frameRate - The frame rate (e.g., 25, 29.97, 50)
 * @returns A new Timestamp with adjusted wallClock and hrTime
 *
 * @example
 * // Compensate for 2 frames of ATEM processing delay at 25fps
 * const adjusted = applyFrameOffset(timestamp, 2, 25);
 *
 * @example
 * // Advance timestamp by 1 frame at 29.97fps (drop-frame)
 * const adjusted = applyFrameOffset(timestamp, -1, 29.97);
 */
export function applyFrameOffset(
  timestamp: Timestamp,
  offsetFrames: number,
  frameRate: number
): Timestamp {
  // No offset needed - return original timestamp
  if (offsetFrames === 0) {
    return timestamp;
  }

  // Calculate offset duration in nanoseconds
  // Frame duration = 1 / frameRate seconds
  // For 25fps: 1 frame = 40ms = 40,000,000ns
  // For 29.97fps: 1 frame ~= 33.37ms = 33,366,700ns
  const frameDurationNs = BigInt(
    Math.round(Number(NANOSECONDS_PER_SECOND) / frameRate)
  );
  const offsetNs = frameDurationNs * BigInt(offsetFrames);

  // Adjust high-resolution time
  // Ensure hrTime doesn't go negative
  const newHrTime = timestamp.hrTime + offsetNs;
  const clampedHrTime = newHrTime < 0n ? 0n : newHrTime;

  // Calculate millisecond offset for wall clock adjustment
  const offsetMs = Number(offsetNs) / 1_000_000;
  const originalWallClock = new Date(timestamp.wallClock);
  const newWallClock = new Date(originalWallClock.getTime() + offsetMs);

  return {
    wallClock: newWallClock.toISOString(),
    hrTime: clampedHrTime,
    // Preserve the original sequence number - ordering is based on when
    // the event was captured, not when it occurred in the video timeline
    sequence: timestamp.sequence,
  };
}

/**
 * Calculate the frame duration in milliseconds for a given frame rate.
 *
 * @param frameRate - The frame rate (e.g., 25, 29.97, 50)
 * @returns Duration of one frame in milliseconds
 */
export function frameDurationMs(frameRate: number): number {
  return MILLISECONDS_PER_SECOND / frameRate;
}

/**
 * Convert a frame count to milliseconds.
 *
 * @param frames - Number of frames
 * @param frameRate - The frame rate
 * @returns Duration in milliseconds
 */
export function framesToMs(frames: number, frameRate: number): number {
  return frames * frameDurationMs(frameRate);
}

/**
 * Convert milliseconds to frame count (rounded to nearest frame).
 *
 * @param ms - Duration in milliseconds
 * @param frameRate - The frame rate
 * @returns Number of frames (rounded)
 */
export function msToFrames(ms: number, frameRate: number): number {
  return Math.round(ms / frameDurationMs(frameRate));
}
