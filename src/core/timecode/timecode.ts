/**
 * Timecode utilities for broadcast-grade EDL generation.
 * Handles SMPTE timecode with drop-frame support.
 */

// ============================================================================
// Types
// ============================================================================

export interface Timecode {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
}

export interface TimecodeOptions {
  frameRate: number;
  dropFrame: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DROP_FRAME_RATES = [29.97, 59.94];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse timecode string to Timecode object.
 * Supports both drop-frame (;) and non-drop-frame (:) separators.
 */
export function parseTimecode(tc: string): Timecode {
  // Match HH:MM:SS:FF or HH:MM:SS;FF
  const match = tc.match(/^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})$/);

  if (!match) {
    throw new Error(`Invalid timecode format: ${tc}. Expected HH:MM:SS:FF or HH:MM:SS;FF`);
  }

  const [, hours, minutes, seconds, frames] = match;

  return {
    hours: parseInt(hours!, 10),
    minutes: parseInt(minutes!, 10),
    seconds: parseInt(seconds!, 10),
    frames: parseInt(frames!, 10),
  };
}

/**
 * Format Timecode object to string.
 */
export function formatTimecode(tc: Timecode, dropFrame: boolean = false): string {
  const separator = dropFrame ? ';' : ':';
  const pad = (n: number) => n.toString().padStart(2, '0');

  return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}${separator}${pad(tc.frames)}`;
}

/**
 * Convert timecode to total frame count.
 * Accounts for drop-frame timecode where applicable.
 */
export function timecodeToFrames(tc: Timecode, options: TimecodeOptions): number {
  const { frameRate, dropFrame } = options;
  const nominalFrameRate = Math.round(frameRate);

  // Calculate total frames assuming non-drop-frame
  let totalFrames =
    tc.hours * 3600 * nominalFrameRate +
    tc.minutes * 60 * nominalFrameRate +
    tc.seconds * nominalFrameRate +
    tc.frames;

  // Apply drop-frame correction
  if (dropFrame && DROP_FRAME_RATES.includes(frameRate)) {
    // Drop-frame skips frame numbers 0 and 1 at the start of each minute,
    // except for minutes divisible by 10.
    const totalMinutes = tc.hours * 60 + tc.minutes;
    const droppedFrames = 2 * (totalMinutes - Math.floor(totalMinutes / 10));
    totalFrames -= droppedFrames;
  }

  return totalFrames;
}

/**
 * Convert total frame count to timecode.
 * Accounts for drop-frame timecode where applicable.
 */
export function framesToTimecode(totalFrames: number, options: TimecodeOptions): Timecode {
  const { frameRate, dropFrame } = options;
  const nominalFrameRate = Math.round(frameRate);

  let frames = totalFrames;

  if (dropFrame && DROP_FRAME_RATES.includes(frameRate)) {
    // Reverse the drop-frame calculation
    // This is more complex than forward conversion
    const framesPerMinute = nominalFrameRate * 60 - 2;
    const framesPer10Minutes = framesPerMinute * 10 + 2;

    const tenMinuteBlocks = Math.floor(frames / framesPer10Minutes);
    let remainingFrames = frames % framesPer10Minutes;

    // Add back dropped frames for complete 10-minute blocks
    frames = tenMinuteBlocks * nominalFrameRate * 60 * 10;

    // Handle the first minute of the 10-minute block (no drops)
    if (remainingFrames < nominalFrameRate * 60) {
      frames += remainingFrames;
    } else {
      remainingFrames -= nominalFrameRate * 60;
      frames += nominalFrameRate * 60;

      // Handle remaining minutes (each has 2 dropped frames)
      const additionalMinutes = Math.floor(remainingFrames / framesPerMinute);
      const finalRemainder = remainingFrames % framesPerMinute;

      frames += additionalMinutes * nominalFrameRate * 60 + finalRemainder + 2;
    }
  }

  // Convert to HH:MM:SS:FF
  const framesPerHour = nominalFrameRate * 3600;
  const framesPerMinute = nominalFrameRate * 60;
  const framesPerSecond = nominalFrameRate;

  const hours = Math.floor(frames / framesPerHour);
  frames %= framesPerHour;

  const minutes = Math.floor(frames / framesPerMinute);
  frames %= framesPerMinute;

  const seconds = Math.floor(frames / framesPerSecond);
  frames %= framesPerSecond;

  return {
    hours,
    minutes,
    seconds,
    frames,
  };
}

/**
 * Add two timecodes together.
 */
export function addTimecodes(a: Timecode, b: Timecode, options: TimecodeOptions): Timecode {
  const framesA = timecodeToFrames(a, options);
  const framesB = timecodeToFrames(b, options);
  return framesToTimecode(framesA + framesB, options);
}

/**
 * Subtract timecode b from a.
 */
export function subtractTimecodes(a: Timecode, b: Timecode, options: TimecodeOptions): Timecode {
  const framesA = timecodeToFrames(a, options);
  const framesB = timecodeToFrames(b, options);

  if (framesB > framesA) {
    throw new Error('Cannot subtract: result would be negative timecode');
  }

  return framesToTimecode(framesA - framesB, options);
}

/**
 * Calculate duration between two timecodes in frames.
 */
export function durationInFrames(start: Timecode, end: Timecode, options: TimecodeOptions): number {
  const startFrames = timecodeToFrames(start, options);
  const endFrames = timecodeToFrames(end, options);
  return endFrames - startFrames;
}

/**
 * Convert wall clock time to timecode.
 * Uses time of day as timecode value.
 */
export function wallClockToTimecode(date: Date, options: TimecodeOptions): Timecode {
  const { frameRate } = options;
  const nominalFrameRate = Math.round(frameRate);

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();

  // Convert milliseconds to frames
  const frames = Math.floor((milliseconds / 1000) * nominalFrameRate);

  return { hours, minutes, seconds, frames };
}

/**
 * Get current time as timecode.
 */
export function nowAsTimecode(options: TimecodeOptions): Timecode {
  return wallClockToTimecode(new Date(), options);
}

/**
 * Validate that a timecode is within valid ranges.
 */
export function validateTimecode(tc: Timecode, options: TimecodeOptions): string[] {
  const errors: string[] = [];
  const nominalFrameRate = Math.round(options.frameRate);

  if (tc.hours < 0 || tc.hours > 23) {
    errors.push(`Hours must be 0-23, got ${tc.hours}`);
  }

  if (tc.minutes < 0 || tc.minutes > 59) {
    errors.push(`Minutes must be 0-59, got ${tc.minutes}`);
  }

  if (tc.seconds < 0 || tc.seconds > 59) {
    errors.push(`Seconds must be 0-59, got ${tc.seconds}`);
  }

  if (tc.frames < 0 || tc.frames >= nominalFrameRate) {
    errors.push(`Frames must be 0-${nominalFrameRate - 1}, got ${tc.frames}`);
  }

  // Check for invalid drop-frame values
  if (options.dropFrame && DROP_FRAME_RATES.includes(options.frameRate)) {
    // Frames 0 and 1 are skipped at the start of each minute (except every 10th)
    if (tc.frames < 2 && tc.seconds === 0 && tc.minutes % 10 !== 0) {
      errors.push(
        `Drop-frame timecode ${formatTimecode(tc, true)} is invalid: ` +
        `frames 0-1 are skipped at minute ${tc.minutes}`
      );
    }
  }

  return errors;
}
