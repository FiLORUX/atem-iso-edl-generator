/**
 * Timecode Utilities
 *
 * Parsing, formatting, and validation for SMPTE timecode strings.
 * Supports both drop-frame and non-drop-frame formats.
 */

import type { TimecodeComponents, TimecodeValidation } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Frame rates that support drop-frame timecode.
 */
const DROP_FRAME_RATES = [29.97, 59.94];

/**
 * Regex for parsing SMPTE timecode strings.
 * Supports both : (non-drop) and ; (drop-frame) separators.
 */
const TIMECODE_REGEX = /^(\d{2}):(\d{2}):(\d{2})([;:])(\d{2})$/;

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a SMPTE timecode string into components.
 *
 * @param timecode - Timecode string in format "HH:MM:SS:FF" or "HH:MM:SS;FF"
 * @returns Parsed components or null if invalid
 */
export function parseTimecode(timecode: string): TimecodeComponents | null {
  const match = timecode.match(TIMECODE_REGEX);
  if (!match) {
    return null;
  }

  const [, hoursStr, minutesStr, secondsStr, separator, framesStr] = match;

  const hours = parseInt(hoursStr!, 10);
  const minutes = parseInt(minutesStr!, 10);
  const seconds = parseInt(secondsStr!, 10);
  const frames = parseInt(framesStr!, 10);
  const dropFrame = separator === ';';

  // Basic range validation
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }

  return { hours, minutes, seconds, frames, dropFrame };
}

/**
 * Validate a timecode string against a frame rate.
 *
 * @param timecode - Timecode string to validate
 * @param frameRate - Frame rate for validation
 * @returns Validation result with components or error
 */
export function validateTimecode(
  timecode: string,
  frameRate: number
): TimecodeValidation {
  const components = parseTimecode(timecode);

  if (!components) {
    return {
      valid: false,
      error: `Invalid timecode format: ${timecode}. Expected HH:MM:SS:FF or HH:MM:SS;FF`,
    };
  }

  // Validate frame count against frame rate
  const maxFrames = Math.ceil(frameRate) - 1;
  if (components.frames > maxFrames) {
    return {
      valid: false,
      error: `Frame count ${components.frames} exceeds maximum ${maxFrames} for ${frameRate} fps`,
    };
  }

  // Validate drop-frame usage
  if (components.dropFrame && !DROP_FRAME_RATES.includes(frameRate)) {
    return {
      valid: false,
      error: `Drop-frame timecode not valid for ${frameRate} fps. Only 29.97 and 59.94 support drop-frame`,
    };
  }

  // Drop-frame skips frames 0 and 1 at the start of each minute (except every 10th minute)
  if (components.dropFrame) {
    const isMinuteStart = components.seconds === 0;
    const isNotTenthMinute = components.minutes % 10 !== 0;
    const isSkippedFrame = components.frames < 2;

    if (isMinuteStart && isNotTenthMinute && isSkippedFrame) {
      return {
        valid: false,
        error: `Invalid drop-frame timecode: frames 0-1 are skipped at minute ${components.minutes}`,
      };
    }
  }

  return { valid: true, components };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format timecode components into a SMPTE string.
 *
 * @param components - Timecode components
 * @returns Formatted timecode string
 */
export function formatTimecodeFromComponents(components: TimecodeComponents): string {
  const { hours, minutes, seconds, frames, dropFrame } = components;
  const separator = dropFrame ? ';' : ':';

  return (
    `${hours.toString().padStart(2, '0')}:` +
    `${minutes.toString().padStart(2, '0')}:` +
    `${seconds.toString().padStart(2, '0')}` +
    `${separator}` +
    `${frames.toString().padStart(2, '0')}`
  );
}

/**
 * Format a frame count as SMPTE timecode.
 *
 * @param totalFrames - Total frame count from zero
 * @param frameRate - Frame rate
 * @param dropFrame - Use drop-frame format
 * @returns Formatted timecode string
 */
export function formatTimecodeFromFrames(
  totalFrames: number,
  frameRate: number,
  dropFrame: boolean
): string {
  // Handle negative frames
  if (totalFrames < 0) {
    return '00:00:00' + (dropFrame ? ';' : ':') + '00';
  }

  let frames = totalFrames;

  if (dropFrame) {
    // Drop-frame calculation for 29.97/59.94
    // At 29.97, we drop 2 frames per minute, except every 10th minute
    // At 59.94, we drop 4 frames per minute, except every 10th minute
    const dropFramesPerMinute = frameRate > 30 ? 4 : 2;
    const framesPerSecond = Math.round(frameRate);
    const framesPerMinute = framesPerSecond * 60 - dropFramesPerMinute;
    const framesPerTenMinutes = framesPerMinute * 10 + dropFramesPerMinute;

    const tenMinuteBlocks = Math.floor(frames / framesPerTenMinutes);
    let remainingFrames = frames % framesPerTenMinutes;

    // Add back dropped frames for complete ten-minute blocks
    frames = tenMinuteBlocks * framesPerSecond * 60 * 10;

    // Handle remaining frames within the ten-minute block
    if (remainingFrames >= dropFramesPerMinute) {
      // Not in the first minute of the ten-minute block
      remainingFrames -= dropFramesPerMinute;
      const completeMinutes = Math.floor(remainingFrames / framesPerMinute);
      const framesInMinute = remainingFrames % framesPerMinute;

      frames += framesPerSecond * 60; // First minute (no drops)
      frames += completeMinutes * framesPerSecond * 60;
      frames += framesInMinute + dropFramesPerMinute; // Add back drops
    } else {
      // In the first minute of the ten-minute block
      frames += remainingFrames;
    }
  }

  const framesPerSecond = Math.round(frameRate);
  const framesPerMinute = framesPerSecond * 60;
  const framesPerHour = framesPerMinute * 60;

  const hours = Math.floor(frames / framesPerHour) % 24;
  frames %= framesPerHour;

  const minutes = Math.floor(frames / framesPerMinute);
  frames %= framesPerMinute;

  const seconds = Math.floor(frames / framesPerSecond);
  const frameNumber = frames % framesPerSecond;

  return formatTimecodeFromComponents({
    hours,
    minutes,
    seconds,
    frames: frameNumber,
    dropFrame,
  });
}

// ============================================================================
// Conversion
// ============================================================================

/**
 * Convert timecode components to total frame count.
 *
 * @param components - Timecode components
 * @param frameRate - Frame rate
 * @returns Total frame count
 */
export function timecodeToFrames(
  components: TimecodeComponents,
  frameRate: number
): number {
  const { hours, minutes, seconds, frames, dropFrame } = components;
  const framesPerSecond = Math.round(frameRate);

  // Basic frame count without drop-frame adjustment
  let totalFrames =
    hours * 3600 * framesPerSecond +
    minutes * 60 * framesPerSecond +
    seconds * framesPerSecond +
    frames;

  if (dropFrame) {
    // Subtract dropped frames
    // 2 frames per minute (4 for 59.94), except every 10th minute
    const dropFramesPerMinute = frameRate > 30 ? 4 : 2;
    const totalMinutes = hours * 60 + minutes;
    const tenMinuteBlocks = Math.floor(totalMinutes / 10);

    // Dropped frames = (total minutes - ten minute blocks) * drop rate
    const droppedFrames = (totalMinutes - tenMinuteBlocks) * dropFramesPerMinute;
    totalFrames -= droppedFrames;
  }

  return totalFrames;
}

/**
 * Convert milliseconds to timecode.
 *
 * @param milliseconds - Time in milliseconds
 * @param frameRate - Frame rate
 * @param dropFrame - Use drop-frame format
 * @returns Formatted timecode string
 */
export function millisecondsToTimecode(
  milliseconds: number,
  frameRate: number,
  dropFrame: boolean
): string {
  const totalFrames = Math.floor((milliseconds / 1000) * frameRate);
  return formatTimecodeFromFrames(totalFrames, frameRate, dropFrame);
}

/**
 * Convert Date to time-of-day timecode.
 *
 * @param date - Date object
 * @param frameRate - Frame rate
 * @param dropFrame - Use drop-frame format
 * @returns Formatted timecode string
 */
export function dateToTimecode(
  date: Date,
  frameRate: number,
  dropFrame: boolean
): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();

  // Calculate frame from milliseconds
  const framesPerSecond = Math.round(frameRate);
  const frame = Math.floor((milliseconds / 1000) * framesPerSecond);

  return formatTimecodeFromComponents({
    hours,
    minutes,
    seconds,
    frames: frame,
    dropFrame,
  });
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Compare two timecode strings.
 *
 * @param tc1 - First timecode
 * @param tc2 - Second timecode
 * @param frameRate - Frame rate for conversion
 * @returns -1 if tc1 < tc2, 0 if equal, 1 if tc1 > tc2
 */
export function compareTimecodes(
  tc1: string,
  tc2: string,
  frameRate: number
): -1 | 0 | 1 {
  const components1 = parseTimecode(tc1);
  const components2 = parseTimecode(tc2);

  if (!components1 || !components2) {
    throw new Error('Invalid timecode for comparison');
  }

  const frames1 = timecodeToFrames(components1, frameRate);
  const frames2 = timecodeToFrames(components2, frameRate);

  if (frames1 < frames2) return -1;
  if (frames1 > frames2) return 1;
  return 0;
}

/**
 * Calculate the difference between two timecodes in frames.
 *
 * @param tc1 - First timecode
 * @param tc2 - Second timecode
 * @param frameRate - Frame rate
 * @returns Difference in frames (tc2 - tc1)
 */
export function timecodesDifferenceFrames(
  tc1: string,
  tc2: string,
  frameRate: number
): number {
  const components1 = parseTimecode(tc1);
  const components2 = parseTimecode(tc2);

  if (!components1 || !components2) {
    throw new Error('Invalid timecode for difference calculation');
  }

  return timecodeToFrames(components2, frameRate) - timecodeToFrames(components1, frameRate);
}

// ============================================================================
// Arithmetic
// ============================================================================

/**
 * Add frames to a timecode.
 *
 * @param timecode - Starting timecode
 * @param framesToAdd - Frames to add (can be negative)
 * @param frameRate - Frame rate
 * @returns New timecode string
 */
export function addFramesToTimecode(
  timecode: string,
  framesToAdd: number,
  frameRate: number
): string {
  const components = parseTimecode(timecode);
  if (!components) {
    throw new Error(`Invalid timecode: ${timecode}`);
  }

  const currentFrames = timecodeToFrames(components, frameRate);
  const newFrames = currentFrames + framesToAdd;

  return formatTimecodeFromFrames(newFrames, frameRate, components.dropFrame);
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a frame rate supports drop-frame.
 */
export function supportsDropFrame(frameRate: number): boolean {
  return DROP_FRAME_RATES.includes(frameRate);
}

/**
 * Check if a timecode string appears valid (basic format check).
 */
export function isValidTimecodeFormat(timecode: string): boolean {
  return TIMECODE_REGEX.test(timecode);
}

/**
 * Normalise a timecode string to consistent format.
 * Ensures two digits for all components.
 */
export function normaliseTimecode(timecode: string): string | null {
  const components = parseTimecode(timecode);
  if (!components) return null;
  return formatTimecodeFromComponents(components);
}
