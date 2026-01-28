/**
 * Event type definitions for ATEM ISO EDL Generator.
 * All switching events are immutable records with high-resolution timestamps.
 */

// ============================================================================
// Core Event Types
// ============================================================================

/**
 * High-resolution timestamp in nanoseconds since process start.
 * Combined with wall clock for absolute time reconstruction.
 */
export interface Timestamp {
  /** Wall clock time (ISO 8601) */
  wallClock: string;
  /** High-resolution nanoseconds since process start */
  hrTime: bigint;
  /** Monotonic sequence number for ordering */
  sequence: number;
}

/**
 * Transition types supported by ATEM switchers.
 */
export type TransitionType = 'cut' | 'mix' | 'dip' | 'wipe' | 'sting' | 'dve';

/**
 * ATEM input source identifier.
 */
export interface InputSource {
  /** ATEM input number */
  inputId: number;
  /** Human-readable name from config */
  name: string;
  /** 8-character reel name for EDL */
  reelName: string;
}

/**
 * Program change event — emitted when the program bus changes.
 */
export interface ProgramChangeEvent {
  type: 'program_change';
  timestamp: Timestamp;
  /** Mix/Effect bank index (0-based) */
  mixEffect: number;
  /** New program input */
  input: InputSource;
  /** Previous program input (null on first event) */
  previousInput: InputSource | null;
  /** Transition type used */
  transitionType: TransitionType;
  /** Transition duration in frames (0 for cuts) */
  transitionFrames: number;
}

/**
 * Preview change event — emitted when the preview bus changes.
 * Useful for anticipating upcoming cuts.
 */
export interface PreviewChangeEvent {
  type: 'preview_change';
  timestamp: Timestamp;
  mixEffect: number;
  input: InputSource;
  previousInput: InputSource | null;
}

/**
 * Transition start event — emitted when a transition begins.
 */
export interface TransitionStartEvent {
  type: 'transition_start';
  timestamp: Timestamp;
  mixEffect: number;
  transitionType: TransitionType;
  transitionFrames: number;
  fromInput: InputSource;
  toInput: InputSource;
}

/**
 * Transition complete event — emitted when a transition finishes.
 */
export interface TransitionCompleteEvent {
  type: 'transition_complete';
  timestamp: Timestamp;
  mixEffect: number;
  transitionType: TransitionType;
  transitionFrames: number;
  input: InputSource;
}

/**
 * Connection state change event.
 */
export interface ConnectionEvent {
  type: 'connection';
  timestamp: Timestamp;
  device: 'atem' | 'hyperdeck';
  deviceName: string;
  state: 'connected' | 'disconnected' | 'error';
  error?: string;
}

/**
 * Session lifecycle event.
 */
export interface SessionEvent {
  type: 'session';
  timestamp: Timestamp;
  action: 'start' | 'stop' | 'pause' | 'resume';
  sessionId: string;
  sessionName?: string;
}

/**
 * Union of all event types.
 */
export type SwitchingEvent =
  | ProgramChangeEvent
  | PreviewChangeEvent
  | TransitionStartEvent
  | TransitionCompleteEvent
  | ConnectionEvent
  | SessionEvent;

// ============================================================================
// Event Log Entry
// ============================================================================

/**
 * Serialised event for JSONL storage.
 * Converts bigint to string for JSON compatibility.
 */
export interface EventLogEntry {
  id: string;
  type: SwitchingEvent['type'];
  timestamp: {
    wallClock: string;
    hrTime: string; // bigint serialised as string
    sequence: number;
  };
  data: Omit<SwitchingEvent, 'type' | 'timestamp'>;
}

// ============================================================================
// Factory Functions
// ============================================================================

let sequenceCounter = 0;
const processStartTime = process.hrtime.bigint();
const processStartWallClock = new Date();

/**
 * Create a new high-resolution timestamp.
 */
export function createTimestamp(): Timestamp {
  const hrTime = process.hrtime.bigint() - processStartTime;

  // Calculate wall clock from process start + elapsed time
  const elapsedMs = Number(hrTime / 1_000_000n);
  const wallClock = new Date(processStartWallClock.getTime() + elapsedMs).toISOString();

  return {
    wallClock,
    hrTime,
    sequence: sequenceCounter++,
  };
}

/**
 * Reset sequence counter (for testing).
 */
export function resetSequence(): void {
  sequenceCounter = 0;
}

/**
 * Generate unique event ID.
 */
export function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Serialise event for JSONL storage.
 */
export function serialiseEvent(event: SwitchingEvent): EventLogEntry {
  const { type, timestamp, ...data } = event;
  return {
    id: generateEventId(),
    type,
    timestamp: {
      wallClock: timestamp.wallClock,
      hrTime: timestamp.hrTime.toString(),
      sequence: timestamp.sequence,
    },
    data,
  };
}

/**
 * Deserialise event from JSONL storage.
 */
export function deserialiseEvent(entry: EventLogEntry): SwitchingEvent {
  const timestamp: Timestamp = {
    wallClock: entry.timestamp.wallClock,
    hrTime: BigInt(entry.timestamp.hrTime),
    sequence: entry.timestamp.sequence,
  };

  return {
    type: entry.type,
    timestamp,
    ...entry.data,
  } as SwitchingEvent;
}
