/**
 * Timeline model for ATEM ISO EDL Generator.
 * Core data model representing a sequence of edits for EDL generation.
 *
 * The Timeline class provides an abstraction layer between raw switching events
 * and the final EDL output, allowing for validation, manipulation, and
 * serialisation of edit decisions.
 */

import type { ProgramChangeEvent, TransitionType } from '../events/types.js';
import type { Timecode, TimecodeOptions } from '../timecode/timecode.js';
import {
  framesToTimecode,
  timecodeToFrames,
  formatTimecode,
  validateTimecode,
} from '../timecode/timecode.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Transition types supported in EDL output.
 * Maps ATEM transition types to EDL-compatible types.
 */
export type EdlTransitionType = 'cut' | 'dissolve' | 'wipe';

/**
 * Represents a single edit point in the timeline.
 * Each edit corresponds to one line in the final EDL.
 */
export interface TimelineEdit {
  /** Unique identifier for this edit */
  readonly id: string;

  /** ATEM input source identifier */
  readonly sourceId: number;

  /** Human-readable source name */
  readonly sourceName: string;

  /**
   * 8-character reel name for EDL.
   * CMX 3600 limits reel names to 8 characters.
   */
  readonly reelName: string;

  /** Source in point (where the clip starts in the source media) */
  readonly sourceIn: Timecode;

  /** Source out point (where the clip ends in the source media) */
  readonly sourceOut: Timecode;

  /** Record in point (where the clip starts in the timeline) */
  readonly recordIn: Timecode;

  /** Record out point (where the clip ends in the timeline) */
  readonly recordOut: Timecode;

  /** Type of transition into this edit */
  readonly transitionType: EdlTransitionType;

  /** Transition duration in frames (0 for cuts) */
  readonly transitionDuration: number;

  /** Additional metadata for extensions and comments */
  readonly metadata: Record<string, unknown>;
}

/**
 * Options for creating a new Timeline.
 */
export interface TimelineOptions {
  /** Frame rate (e.g., 25, 29.97, 50) */
  frameRate: number;

  /** Whether to use drop-frame timecode (only valid for 29.97 and 59.94) */
  dropFrame: boolean;

  /** Timeline title (appears in EDL header) */
  title: string;

  /** Optional starting timecode (defaults to 01:00:00:00) */
  startTimecode?: Timecode;
}

/**
 * Serialisable representation of the timeline.
 */
export interface TimelineJSON {
  title: string;
  frameRate: number;
  dropFrame: boolean;
  startTimecode: string;
  edits: Array<{
    id: string;
    sourceId: number;
    sourceName: string;
    reelName: string;
    sourceIn: string;
    sourceOut: string;
    recordIn: string;
    recordOut: string;
    transitionType: EdlTransitionType;
    transitionDuration: number;
    metadata: Record<string, unknown>;
  }>;
  createdAt: string;
  version: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default starting timecode (1 hour) following broadcast convention */
const DEFAULT_START_TIMECODE: Timecode = {
  hours: 1,
  minutes: 0,
  seconds: 0,
  frames: 0,
};

/** Maximum number of events in a CMX 3600 EDL */
const MAX_EDL_EVENTS = 999;

/** Maximum reel name length in CMX 3600 */
const MAX_REEL_NAME_LENGTH = 8;

/** Valid characters for reel names */
const REEL_NAME_PATTERN = /^[A-Z0-9_-]+$/i;

/** Timeline model version for serialisation compatibility */
const MODEL_VERSION = '1.0.0';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique edit ID.
 * Uses timestamp and random suffix for uniqueness.
 */
function generateEditId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `edit-${timestamp}-${random}`;
}

/**
 * Map ATEM transition type to EDL transition type.
 * ATEM supports more transition types than CMX 3600.
 */
function mapTransitionType(atemType: TransitionType): EdlTransitionType {
  switch (atemType) {
    case 'cut':
      return 'cut';
    case 'mix':
    case 'dip':
      // Mix and dip both become dissolves in EDL
      return 'dissolve';
    case 'wipe':
    case 'dve':
    case 'sting':
      // DVE and sting effects become wipes in EDL
      return 'wipe';
    default:
      // TypeScript exhaustiveness check
      return 'cut';
  }
}

/**
 * Sanitise reel name for CMX 3600 compatibility.
 * Truncates to 8 characters and converts to uppercase.
 */
function sanitiseReelName(name: string): string {
  // Remove invalid characters and convert to uppercase
  const cleaned = name.replace(/[^A-Z0-9_-]/gi, '_').toUpperCase();
  // Truncate to 8 characters
  return cleaned.substring(0, MAX_REEL_NAME_LENGTH);
}

// ============================================================================
// Timeline Class
// ============================================================================

/**
 * Represents a complete editing timeline.
 *
 * The Timeline class is the core data structure for representing a sequence
 * of edits. It provides methods for adding, querying, and validating edits,
 * as well as serialisation for persistence.
 *
 * @example
 * ```typescript
 * const timeline = new Timeline({
 *   frameRate: 25,
 *   dropFrame: false,
 *   title: 'MY_SHOW_001',
 * });
 *
 * timeline.addEdit({
 *   id: generateEditId(),
 *   sourceId: 1,
 *   sourceName: 'Camera 1',
 *   reelName: 'CAM1',
 *   sourceIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
 *   sourceOut: { hours: 1, minutes: 0, seconds: 10, frames: 0 },
 *   recordIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
 *   recordOut: { hours: 1, minutes: 0, seconds: 10, frames: 0 },
 *   transitionType: 'cut',
 *   transitionDuration: 0,
 *   metadata: {},
 * });
 *
 * const errors = timeline.validate();
 * if (errors.length === 0) {
 *   const json = timeline.toJSON();
 * }
 * ```
 */
export class Timeline {
  private readonly edits: TimelineEdit[] = [];
  private readonly options: Required<TimelineOptions>;
  private readonly tcOptions: TimecodeOptions;
  private readonly createdAt: Date;

  /**
   * Create a new Timeline.
   *
   * @param options - Timeline configuration
   */
  constructor(options: TimelineOptions) {
    this.options = {
      ...options,
      startTimecode: options.startTimecode ?? DEFAULT_START_TIMECODE,
    };

    this.tcOptions = {
      frameRate: options.frameRate,
      dropFrame: options.dropFrame,
    };

    this.createdAt = new Date();

    // Validate drop-frame setting
    if (options.dropFrame && ![29.97, 59.94].includes(options.frameRate)) {
      throw new Error(
        `Drop-frame timecode is only valid for 29.97 and 59.94 fps. ` +
          `Got ${options.frameRate} fps.`
      );
    }
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  /** Get the timeline title */
  get title(): string {
    return this.options.title;
  }

  /** Get the frame rate */
  get frameRate(): number {
    return this.options.frameRate;
  }

  /** Get drop-frame setting */
  get dropFrame(): boolean {
    return this.options.dropFrame;
  }

  /** Get the starting timecode */
  get startTimecode(): Timecode {
    return { ...this.options.startTimecode };
  }

  /** Get timecode options for calculations */
  get timecodeOptions(): TimecodeOptions {
    return { ...this.tcOptions };
  }

  // --------------------------------------------------------------------------
  // Edit Management
  // --------------------------------------------------------------------------

  /**
   * Add an edit to the timeline.
   *
   * Edits are stored in insertion order. The caller is responsible for
   * ensuring correct temporal ordering if required.
   *
   * @param edit - The edit to add
   * @throws Error if edit ID already exists or maximum events exceeded
   */
  addEdit(edit: TimelineEdit): void {
    // Check for duplicate ID
    if (this.edits.some((e) => e.id === edit.id)) {
      throw new Error(`Edit with ID "${edit.id}" already exists in timeline`);
    }

    // Check CMX 3600 event limit
    if (this.edits.length >= MAX_EDL_EVENTS) {
      throw new Error(
        `Cannot add edit: timeline already has ${MAX_EDL_EVENTS} events (CMX 3600 limit)`
      );
    }

    this.edits.push(edit);
  }

  /**
   * Get all edits in the timeline.
   *
   * Returns a shallow copy to prevent external modification.
   */
  getEdits(): TimelineEdit[] {
    return [...this.edits];
  }

  /**
   * Get the number of edits in the timeline.
   */
  get editCount(): number {
    return this.edits.length;
  }

  /**
   * Get an edit by its ID.
   *
   * @param id - The edit ID to find
   * @returns The edit, or undefined if not found
   */
  getEditById(id: string): TimelineEdit | undefined {
    return this.edits.find((e) => e.id === id);
  }

  /**
   * Get the edit active at a given timecode.
   *
   * Finds the edit whose record in/out range contains the specified timecode.
   *
   * @param timecode - The timecode to query
   * @returns The active edit, or undefined if no edit at that time
   */
  getEditAt(timecode: Timecode): TimelineEdit | undefined {
    const targetFrames = timecodeToFrames(timecode, this.tcOptions);

    return this.edits.find((edit) => {
      const inFrames = timecodeToFrames(edit.recordIn, this.tcOptions);
      const outFrames = timecodeToFrames(edit.recordOut, this.tcOptions);
      return targetFrames >= inFrames && targetFrames < outFrames;
    });
  }

  /**
   * Get the total duration of the timeline in frames.
   *
   * Duration is calculated from the start timecode to the last edit's
   * record out point.
   */
  getDuration(): number {
    if (this.edits.length === 0) {
      return 0;
    }

    const startFrames = timecodeToFrames(this.options.startTimecode, this.tcOptions);

    // Find the latest record out point
    let maxOutFrames = startFrames;
    for (const edit of this.edits) {
      const outFrames = timecodeToFrames(edit.recordOut, this.tcOptions);
      if (outFrames > maxOutFrames) {
        maxOutFrames = outFrames;
      }
    }

    return maxOutFrames - startFrames;
  }

  /**
   * Get the duration as a Timecode.
   */
  getDurationAsTimecode(): Timecode {
    return framesToTimecode(this.getDuration(), this.tcOptions);
  }

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  /**
   * Validate the timeline for common issues.
   *
   * Checks for:
   * - Empty timeline
   * - Invalid timecodes
   * - Reel name format issues
   * - Overlapping edits
   * - Negative durations
   * - CMX 3600 compliance
   *
   * @returns Array of validation error messages (empty if valid)
   */
  validate(): string[] {
    const errors: string[] = [];

    // Check for empty timeline
    if (this.edits.length === 0) {
      errors.push('Timeline has no edits');
      return errors;
    }

    // Check event count
    if (this.edits.length > MAX_EDL_EVENTS) {
      errors.push(
        `Timeline has ${this.edits.length} edits, maximum for CMX 3600 is ${MAX_EDL_EVENTS}`
      );
    }

    // Validate each edit
    for (let i = 0; i < this.edits.length; i++) {
      const edit = this.edits[i]!;
      const prefix = `Edit ${i + 1} (${edit.id})`;

      // Validate timecodes
      const sourceInErrors = validateTimecode(edit.sourceIn, this.tcOptions);
      const sourceOutErrors = validateTimecode(edit.sourceOut, this.tcOptions);
      const recordInErrors = validateTimecode(edit.recordIn, this.tcOptions);
      const recordOutErrors = validateTimecode(edit.recordOut, this.tcOptions);

      for (const err of sourceInErrors) {
        errors.push(`${prefix}: sourceIn - ${err}`);
      }
      for (const err of sourceOutErrors) {
        errors.push(`${prefix}: sourceOut - ${err}`);
      }
      for (const err of recordInErrors) {
        errors.push(`${prefix}: recordIn - ${err}`);
      }
      for (const err of recordOutErrors) {
        errors.push(`${prefix}: recordOut - ${err}`);
      }

      // Check for negative source duration
      const sourceInFrames = timecodeToFrames(edit.sourceIn, this.tcOptions);
      const sourceOutFrames = timecodeToFrames(edit.sourceOut, this.tcOptions);
      if (sourceOutFrames < sourceInFrames) {
        errors.push(
          `${prefix}: Source out (${formatTimecode(edit.sourceOut, this.dropFrame)}) ` +
            `is before source in (${formatTimecode(edit.sourceIn, this.dropFrame)})`
        );
      }

      // Check for negative record duration
      const recordInFrames = timecodeToFrames(edit.recordIn, this.tcOptions);
      const recordOutFrames = timecodeToFrames(edit.recordOut, this.tcOptions);
      if (recordOutFrames < recordInFrames) {
        errors.push(
          `${prefix}: Record out (${formatTimecode(edit.recordOut, this.dropFrame)}) ` +
            `is before record in (${formatTimecode(edit.recordIn, this.dropFrame)})`
        );
      }

      // Check source and record durations match
      const sourceDuration = sourceOutFrames - sourceInFrames;
      const recordDuration = recordOutFrames - recordInFrames;
      if (sourceDuration !== recordDuration) {
        errors.push(
          `${prefix}: Source duration (${sourceDuration} frames) does not match ` +
            `record duration (${recordDuration} frames)`
        );
      }

      // Validate reel name
      if (edit.reelName.length > MAX_REEL_NAME_LENGTH) {
        errors.push(
          `${prefix}: Reel name "${edit.reelName}" exceeds ${MAX_REEL_NAME_LENGTH} characters`
        );
      }

      if (!REEL_NAME_PATTERN.test(edit.reelName)) {
        errors.push(
          `${prefix}: Reel name "${edit.reelName}" contains invalid characters ` +
            `(only A-Z, 0-9, underscore, and hyphen allowed)`
        );
      }

      // Validate transition duration
      if (edit.transitionType === 'cut' && edit.transitionDuration !== 0) {
        errors.push(
          `${prefix}: Cut transitions must have 0 duration, got ${edit.transitionDuration} frames`
        );
      }

      if (edit.transitionType !== 'cut' && edit.transitionDuration <= 0) {
        errors.push(
          `${prefix}: ${edit.transitionType} transitions must have positive duration, ` +
            `got ${edit.transitionDuration} frames`
        );
      }
    }

    // Check for overlapping edits on the record timeline
    const sortedEdits = [...this.edits].sort((a, b) => {
      const aIn = timecodeToFrames(a.recordIn, this.tcOptions);
      const bIn = timecodeToFrames(b.recordIn, this.tcOptions);
      return aIn - bIn;
    });

    for (let i = 0; i < sortedEdits.length - 1; i++) {
      const current = sortedEdits[i]!;
      const next = sortedEdits[i + 1]!;

      const currentOut = timecodeToFrames(current.recordOut, this.tcOptions);
      const nextIn = timecodeToFrames(next.recordIn, this.tcOptions);

      if (currentOut > nextIn) {
        errors.push(
          `Overlap detected: Edit "${current.id}" ends at ` +
            `${formatTimecode(current.recordOut, this.dropFrame)} but ` +
            `Edit "${next.id}" starts at ` +
            `${formatTimecode(next.recordIn, this.dropFrame)}`
        );
      }
    }

    return errors;
  }

  // --------------------------------------------------------------------------
  // Serialisation
  // --------------------------------------------------------------------------

  /**
   * Convert timeline to a JSON-serialisable representation.
   *
   * All timecodes are converted to strings for JSON compatibility.
   */
  toJSON(): TimelineJSON {
    return {
      title: this.options.title,
      frameRate: this.options.frameRate,
      dropFrame: this.options.dropFrame,
      startTimecode: formatTimecode(this.options.startTimecode, this.options.dropFrame),
      edits: this.edits.map((edit) => ({
        id: edit.id,
        sourceId: edit.sourceId,
        sourceName: edit.sourceName,
        reelName: edit.reelName,
        sourceIn: formatTimecode(edit.sourceIn, this.options.dropFrame),
        sourceOut: formatTimecode(edit.sourceOut, this.options.dropFrame),
        recordIn: formatTimecode(edit.recordIn, this.options.dropFrame),
        recordOut: formatTimecode(edit.recordOut, this.options.dropFrame),
        transitionType: edit.transitionType,
        transitionDuration: edit.transitionDuration,
        metadata: { ...edit.metadata },
      })),
      createdAt: this.createdAt.toISOString(),
      version: MODEL_VERSION,
    };
  }
}

// ============================================================================
// TimelineBuilder Class
// ============================================================================

/**
 * Options for building a timeline from events.
 */
export interface TimelineBuilderOptions extends TimelineOptions {
  /**
   * Default duration in frames for the last edit.
   * Since we don't know when the last source ends, we use this default.
   * Defaults to 1 second at the timeline's frame rate.
   */
  defaultLastEditDuration?: number;
}

/**
 * Builder for constructing Timeline instances from raw events.
 *
 * The TimelineBuilder handles the conversion from ATEM switching events
 * to a structured Timeline, including:
 * - Timecode calculations from wall clock times
 * - Duration computation from event intervals
 * - Transition type mapping
 * - Metadata extraction
 *
 * @example
 * ```typescript
 * const builder = new TimelineBuilder();
 *
 * const timeline = builder.fromProgramChanges(events, {
 *   frameRate: 25,
 *   dropFrame: false,
 *   title: 'MY_SHOW_001',
 * });
 *
 * const edl = generateEdl(timeline);
 * ```
 */
export class TimelineBuilder {
  /**
   * Build a Timeline from program change events.
   *
   * Each program change becomes an edit in the timeline. The duration of
   * each edit is determined by the time between consecutive events.
   *
   * @param events - Array of program change events
   * @param options - Timeline options
   * @returns A new Timeline instance
   */
  fromProgramChanges(
    events: ProgramChangeEvent[],
    options: TimelineBuilderOptions
  ): Timeline {
    const timeline = new Timeline(options);

    if (events.length === 0) {
      return timeline;
    }

    const tcOptions: TimecodeOptions = {
      frameRate: options.frameRate,
      dropFrame: options.dropFrame,
    };

    // Default last edit duration (1 second)
    const defaultLastDuration =
      options.defaultLastEditDuration ?? Math.round(options.frameRate);

    // Sort events by sequence number for correct temporal ordering
    const sortedEvents = [...events].sort(
      (a, b) => a.timestamp.sequence - b.timestamp.sequence
    );

    // Calculate starting frame position
    const startTimecode = options.startTimecode ?? DEFAULT_START_TIMECODE;
    let recordTimelineFrames = timecodeToFrames(startTimecode, tcOptions);

    for (let i = 0; i < sortedEvents.length; i++) {
      const event = sortedEvents[i]!;
      const nextEvent = sortedEvents[i + 1];

      // Calculate duration from wall clock times
      let durationFrames: number;

      if (nextEvent) {
        const currentTime = new Date(event.timestamp.wallClock).getTime();
        const nextTime = new Date(nextEvent.timestamp.wallClock).getTime();
        const durationMs = nextTime - currentTime;

        // Convert milliseconds to frames, ensuring at least 1 frame
        durationFrames = Math.max(
          1,
          Math.round((durationMs / 1000) * options.frameRate)
        );
      } else {
        // Last event uses default duration
        durationFrames = defaultLastDuration;
      }

      // Build timecodes for this edit
      // Source timecode mirrors record timecode for ISO recordings
      const recordIn = framesToTimecode(recordTimelineFrames, tcOptions);
      const recordOut = framesToTimecode(recordTimelineFrames + durationFrames, tcOptions);

      // Create the edit
      const edit: TimelineEdit = {
        id: generateEditId(),
        sourceId: event.input.inputId,
        sourceName: event.input.name,
        reelName: sanitiseReelName(event.input.reelName),
        sourceIn: recordIn,
        sourceOut: recordOut,
        recordIn: recordIn,
        recordOut: recordOut,
        transitionType: mapTransitionType(event.transitionType),
        transitionDuration: event.transitionType === 'cut' ? 0 : event.transitionFrames,
        metadata: {
          mixEffect: event.mixEffect,
          atemTransitionType: event.transitionType,
          wallClock: event.timestamp.wallClock,
          sequence: event.timestamp.sequence,
          previousInput: event.previousInput
            ? {
                inputId: event.previousInput.inputId,
                name: event.previousInput.name,
              }
            : null,
        },
      };

      timeline.addEdit(edit);

      // Advance timeline position
      recordTimelineFrames += durationFrames;
    }

    return timeline;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new Timeline with the given options.
 */
export function createTimeline(options: TimelineOptions): Timeline {
  return new Timeline(options);
}

/**
 * Create a new TimelineBuilder.
 */
export function createTimelineBuilder(): TimelineBuilder {
  return new TimelineBuilder();
}

/**
 * Build a Timeline directly from program change events.
 * Convenience function combining builder creation and build.
 */
export function buildTimelineFromEvents(
  events: ProgramChangeEvent[],
  options: TimelineBuilderOptions
): Timeline {
  const builder = new TimelineBuilder();
  return builder.fromProgramChanges(events, options);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid EdlTransitionType.
 */
export function isEdlTransitionType(value: unknown): value is EdlTransitionType {
  return value === 'cut' || value === 'dissolve' || value === 'wipe';
}

/**
 * Check if an object is a valid TimelineEdit.
 */
export function isTimelineEdit(value: unknown): value is TimelineEdit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const edit = value as Record<string, unknown>;

  return (
    typeof edit.id === 'string' &&
    typeof edit.sourceId === 'number' &&
    typeof edit.sourceName === 'string' &&
    typeof edit.reelName === 'string' &&
    typeof edit.sourceIn === 'object' &&
    typeof edit.sourceOut === 'object' &&
    typeof edit.recordIn === 'object' &&
    typeof edit.recordOut === 'object' &&
    isEdlTransitionType(edit.transitionType) &&
    typeof edit.transitionDuration === 'number' &&
    typeof edit.metadata === 'object'
  );
}
