/**
 * CMX 3600 EDL Generator.
 * Generates industry-standard Edit Decision Lists from switching events.
 */

import type { ProgramChangeEvent, InputSource } from '../../core/events/types.js';
import type { Timecode, TimecodeOptions } from '../../core/timecode/timecode.js';
import { formatTimecode, framesToTimecode, timecodeToFrames } from '../../core/timecode/timecode.js';

// ============================================================================
// Types
// ============================================================================

export interface EdlEvent {
  /** Event number (001-999) */
  eventNumber: number;
  /** Source reel name (max 8 chars) */
  reelName: string;
  /** Track type */
  track: 'V' | 'A' | 'A2' | 'A3' | 'A4' | 'VA';
  /** Transition type */
  transition: 'C' | 'D' | 'W';
  /** Transition duration in frames (0 for cuts) */
  transitionFrames: number;
  /** SMPTE wipe code (for wipes only) */
  wipeCode?: number;
  /** Source in point */
  sourceIn: Timecode;
  /** Source out point */
  sourceOut: Timecode;
  /** Record in point */
  recordIn: Timecode;
  /** Record out point */
  recordOut: Timecode;
  /** Extended comments */
  comments: EdlComment[];
}

export interface EdlComment {
  key: string;
  value: string;
}

export interface EdlDocument {
  title: string;
  frameRate: number;
  dropFrame: boolean;
  events: EdlEvent[];
}

export interface GeneratorOptions {
  title: string;
  frameRate: number;
  dropFrame: boolean;
  includeComments: boolean;
  sourceFilePath?: string;
}

// ============================================================================
// EDL Event Builder
// ============================================================================

/**
 * Build EDL events from program change events.
 */
export function buildEdlEvents(
  programChanges: ProgramChangeEvent[],
  options: GeneratorOptions
): EdlEvent[] {
  const events: EdlEvent[] = [];
  const tcOptions: TimecodeOptions = {
    frameRate: options.frameRate,
    dropFrame: options.dropFrame,
  };

  // Sort by timestamp sequence
  const sorted = [...programChanges].sort(
    (a, b) => a.timestamp.sequence - b.timestamp.sequence
  );

  let recordTimelineFrames = 0;
  let eventNumber = 1;

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1];

    // Calculate duration (until next event or use default)
    let durationFrames: number;
    if (next) {
      // Calculate duration from wall clock difference
      const currentTime = new Date(current.timestamp.wallClock).getTime();
      const nextTime = new Date(next.timestamp.wallClock).getTime();
      const durationMs = nextTime - currentTime;
      durationFrames = Math.max(1, Math.round((durationMs / 1000) * options.frameRate));
    } else {
      // Last event — use 1 second as default duration
      durationFrames = Math.round(options.frameRate);
    }

    // Build EDL event
    const sourceIn = framesToTimecode(recordTimelineFrames, tcOptions);
    const sourceOut = framesToTimecode(recordTimelineFrames + durationFrames, tcOptions);
    const recordIn = framesToTimecode(recordTimelineFrames, tcOptions);
    const recordOut = framesToTimecode(recordTimelineFrames + durationFrames, tcOptions);

    // Determine transition type
    let transition: 'C' | 'D' | 'W' = 'C';
    let transitionFrames = 0;

    if (current.transitionType === 'mix' || current.transitionType === 'dip') {
      transition = 'D';
      transitionFrames = current.transitionFrames;
    } else if (current.transitionType === 'wipe' || current.transitionType === 'dve') {
      transition = 'W';
      transitionFrames = current.transitionFrames;
    }

    // Build comments
    const comments: EdlComment[] = [];
    if (options.includeComments) {
      comments.push({ key: 'FROM CLIP NAME', value: `${current.input.reelName}_ISO.MOV` });

      if (options.sourceFilePath) {
        comments.push({
          key: 'SOURCE FILE',
          value: `${options.sourceFilePath}/${current.input.reelName}_ISO.MOV`,
        });
      }

      comments.push({
        key: 'ATEM INPUT',
        value: `${current.input.inputId} (${current.input.name})`,
      });

      if (current.transitionType !== 'cut' && current.transitionFrames > 0) {
        comments.push({
          key: 'TRANSITION',
          value: `${current.transitionType.toUpperCase()} ${current.transitionFrames} frames`,
        });
      }
    }

    const event: EdlEvent = {
      eventNumber,
      reelName: current.input.reelName.substring(0, 8).toUpperCase(),
      track: 'V',
      transition,
      transitionFrames,
      sourceIn,
      sourceOut,
      recordIn,
      recordOut,
      comments,
    };

    events.push(event);

    recordTimelineFrames += durationFrames;
    eventNumber++;

    // CMX 3600 limit
    if (eventNumber > 999) {
      break;
    }
  }

  return events;
}

// ============================================================================
// EDL Formatting
// ============================================================================

/**
 * Format a single EDL event line.
 */
function formatEventLine(event: EdlEvent, dropFrame: boolean): string {
  const eventNum = event.eventNumber.toString().padStart(3, '0');
  const reel = event.reelName.padEnd(8, ' ');
  const track = event.track.padEnd(2, ' ');

  let transition: string;
  if (event.transition === 'C') {
    transition = 'C   ';
  } else if (event.transition === 'D') {
    transition = `D    ${event.transitionFrames.toString().padStart(3, '0')}`;
  } else {
    const wipeCode = event.wipeCode ?? 1;
    transition = `W${wipeCode.toString().padStart(3, '0')} ${event.transitionFrames.toString().padStart(3, '0')}`;
  }

  const sourceIn = formatTimecode(event.sourceIn, dropFrame);
  const sourceOut = formatTimecode(event.sourceOut, dropFrame);
  const recordIn = formatTimecode(event.recordIn, dropFrame);
  const recordOut = formatTimecode(event.recordOut, dropFrame);

  return `${eventNum}  ${reel} ${track}    ${transition} ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`;
}

/**
 * Generate complete EDL document as string.
 */
export function generateEdl(document: EdlDocument): string {
  const lines: string[] = [];

  // Title line
  lines.push(`TITLE: ${document.title}`);
  lines.push('');

  // FCM line (Frame Code Mode)
  if (document.dropFrame) {
    lines.push('FCM: DROP FRAME');
  } else {
    lines.push('FCM: NON-DROP FRAME');
  }
  lines.push('');

  // Events
  for (const event of document.events) {
    // Main event line
    lines.push(formatEventLine(event, document.dropFrame));

    // For dissolves and wipes, duplicate the line (CMX 3600 convention)
    if (event.transition !== 'C') {
      lines.push(formatEventLine(event, document.dropFrame));
    }

    // Comment lines
    for (const comment of event.comments) {
      lines.push(`* ${comment.key}: ${comment.value}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convenience function to generate EDL from program change events.
 */
export function generateEdlFromEvents(
  programChanges: ProgramChangeEvent[],
  options: GeneratorOptions
): string {
  const events = buildEdlEvents(programChanges, options);

  const document: EdlDocument = {
    title: options.title,
    frameRate: options.frameRate,
    dropFrame: options.dropFrame,
    events,
  };

  return generateEdl(document);
}

/**
 * Validate EDL document for common issues.
 */
export function validateEdl(document: EdlDocument): string[] {
  const errors: string[] = [];

  if (document.events.length === 0) {
    errors.push('EDL has no events');
  }

  if (document.events.length > 999) {
    errors.push(`EDL has ${document.events.length} events, maximum is 999`);
  }

  for (const event of document.events) {
    if (event.reelName.length > 8) {
      errors.push(
        `Event ${event.eventNumber}: Reel name "${event.reelName}" exceeds 8 characters`
      );
    }

    if (!/^[A-Z0-9_-]+$/i.test(event.reelName)) {
      errors.push(
        `Event ${event.eventNumber}: Reel name "${event.reelName}" contains invalid characters`
      );
    }
  }

  return errors;
}
