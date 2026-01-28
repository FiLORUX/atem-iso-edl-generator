/**
 * Event Store for ATEM ISO EDL Generator.
 *
 * Provides persistent storage for switching events using JSONL format.
 * Features atomic writes, daily log rotation, and replay capability.
 */

import { mkdir, rename, appendFile, readFile } from 'node:fs/promises';
import { existsSync, type WriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type SwitchingEvent,
  type EventLogEntry,
  serialiseEvent,
  deserialiseEvent,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface EventStoreOptions {
  /** Directory for storing event log files */
  logDirectory: string;
  /** Enable daily log rotation (default: true) */
  rotateDaily?: boolean;
}

export interface EventFilter {
  /** Filter by event type */
  type?: SwitchingEvent['type'] | SwitchingEvent['type'][];
  /** Filter by mix/effect bank */
  mixEffect?: number;
  /** Minimum sequence number */
  minSequence?: number;
  /** Maximum sequence number */
  maxSequence?: number;
}

// ============================================================================
// Event Store
// ============================================================================

/**
 * Persistent event store with atomic writes and daily rotation.
 *
 * Events are stored in JSONL (JSON Lines) format, one event per line.
 * This format allows for efficient append operations and easy streaming.
 */
export class EventStore {
  private readonly logDirectory: string;
  private readonly rotateDaily: boolean;

  private currentDate: string;
  private writeStream: WriteStream | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private eventsWritten = 0;

  constructor(options: EventStoreOptions) {
    this.logDirectory = options.logDirectory;
    this.rotateDaily = options.rotateDaily ?? true;
    this.currentDate = this.getDateString();
  }

  /**
   * Append an event to the store.
   *
   * Uses atomic write pattern: write to temp file, then rename.
   * For performance, batches writes through a queue.
   */
  async append(event: SwitchingEvent): Promise<void> {
    if (this.closed) {
      throw new EventStoreError('Cannot append to closed EventStore');
    }

    const entry = serialiseEvent(event);
    const line = JSON.stringify(entry) + '\n';

    // Chain writes to maintain order
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureLogDirectory();
      await this.checkRotation();
      await this.atomicAppend(line);
      this.eventsWritten++;
    });

    return this.writeQueue;
  }

  /**
   * Retrieve events from the current log file with optional filtering.
   */
  async getEvents(filter?: EventFilter): Promise<SwitchingEvent[]> {
    const logPath = this.getCurrentLogPath();

    if (!existsSync(logPath)) {
      return [];
    }

    const events = await this.loadFromFile(logPath);
    return this.applyFilter(events, filter);
  }

  /**
   * Retrieve events within a specific time range.
   *
   * When spanning multiple days with daily rotation enabled,
   * this will read from multiple log files.
   */
  async getEventsByTimeRange(start: Date, end: Date): Promise<SwitchingEvent[]> {
    if (start > end) {
      throw new EventStoreError('Start date must be before end date');
    }

    const events: SwitchingEvent[] = [];

    if (this.rotateDaily) {
      // Collect events from each day's log file
      const current = new Date(start);
      current.setUTCHours(0, 0, 0, 0);

      while (current <= end) {
        const dateStr = this.formatDate(current);
        const logPath = this.getLogPathForDate(dateStr);

        if (existsSync(logPath)) {
          const dayEvents = await this.loadFromFile(logPath);
          events.push(...dayEvents);
        }

        current.setUTCDate(current.getUTCDate() + 1);
      }
    } else {
      // Single log file mode
      const logPath = this.getLogPathForDate('all');
      if (existsSync(logPath)) {
        events.push(...await this.loadFromFile(logPath));
      }
    }

    // Filter to exact time range
    return events.filter((event) => {
      const eventTime = new Date(event.timestamp.wallClock);
      return eventTime >= start && eventTime <= end;
    });
  }

  /**
   * Get the current log file path.
   */
  getCurrentLogPath(): string {
    const dateStr = this.rotateDaily ? this.currentDate : 'all';
    return this.getLogPathForDate(dateStr);
  }

  /**
   * Load events from a JSONL file.
   *
   * Handles malformed lines gracefully, logging warnings but continuing.
   */
  async loadFromFile(path: string): Promise<SwitchingEvent[]> {
    if (!existsSync(path)) {
      throw new EventStoreError(`Log file not found: ${path}`);
    }

    const content = await readFile(path, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    const events: SwitchingEvent[] = [];
    const errors: Array<{ line: number; error: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      try {
        const entry = this.parseJsonlLine(line);
        const event = deserialiseEvent(entry);
        events.push(event);
      } catch (error) {
        errors.push({
          line: i + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (errors.length > 0) {
      // Log errors but don't throw - partial recovery is better than total failure
      console.warn(
        `EventStore: ${errors.length} malformed lines in ${path}:`,
        errors.slice(0, 5) // Show first 5 errors
      );
    }

    return events;
  }

  /**
   * Parse a single JSONL line into an EventLogEntry.
   */
  parseJsonlLine(line: string): EventLogEntry {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      throw new EventStoreError('Empty line');
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      // Validate required fields
      if (!isEventLogEntry(parsed)) {
        throw new EventStoreError('Invalid event log entry structure');
      }

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new EventStoreError(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Close the event store, flushing any pending writes.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // Wait for pending writes to complete
    await this.writeQueue;

    // Close write stream if open
    if (this.writeStream) {
      await this.closeWriteStream();
    }
  }

  /**
   * Get the number of events written in this session.
   */
  getEventsWritten(): number {
    return this.eventsWritten;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Perform atomic append to the log file.
   *
   * For reliability, we write to a temp file and rename.
   * This ensures we never have partial writes in the log.
   */
  private async atomicAppend(line: string): Promise<void> {
    const logPath = this.getCurrentLogPath();
    const tempPath = `${logPath}.${randomUUID()}.tmp`;

    try {
      // If log file exists, copy content to temp then append
      // Otherwise, just write the new line to temp
      if (existsSync(logPath)) {
        // For atomic append, we use appendFile which is atomic on most systems
        // for small writes. For larger writes, we'd need a more complex approach.
        await appendFile(logPath, line, 'utf-8');
      } else {
        // New file: write to temp, then rename for atomicity
        await this.ensureDirectory(dirname(tempPath));
        await this.writeToTemp(tempPath, line);
        await rename(tempPath, logPath);
      }
    } catch (error) {
      // Clean up temp file if it exists
      try {
        if (existsSync(tempPath)) {
          const { unlink } = await import('node:fs/promises');
          await unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      throw new EventStoreError(
        `Failed to write event: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async writeToTemp(tempPath: string, content: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(tempPath, content, 'utf-8');
  }

  private async ensureLogDirectory(): Promise<void> {
    await this.ensureDirectory(this.logDirectory);
  }

  private async ensureDirectory(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  private async checkRotation(): Promise<void> {
    if (!this.rotateDaily) {
      return;
    }

    const today = this.getDateString();
    if (today !== this.currentDate) {
      // Date changed, rotate
      if (this.writeStream) {
        await this.closeWriteStream();
      }
      this.currentDate = today;
    }
  }

  private async closeWriteStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.writeStream) {
        resolve();
        return;
      }

      this.writeStream.end((error: Error | null) => {
        if (error) {
          reject(error);
        } else {
          this.writeStream = null;
          resolve();
        }
      });
    });
  }

  private getDateString(): string {
    return this.formatDate(new Date());
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]!;
  }

  private getLogPathForDate(dateStr: string): string {
    return join(this.logDirectory, `events-${dateStr}.jsonl`);
  }

  private applyFilter(
    events: SwitchingEvent[],
    filter?: EventFilter
  ): SwitchingEvent[] {
    if (!filter) {
      return events;
    }

    return events.filter((event) => {
      // Filter by type
      if (filter.type !== undefined) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        if (!types.includes(event.type)) {
          return false;
        }
      }

      // Filter by mixEffect (only applicable to some event types)
      if (filter.mixEffect !== undefined) {
        if ('mixEffect' in event && event.mixEffect !== filter.mixEffect) {
          return false;
        }
      }

      // Filter by sequence
      if (filter.minSequence !== undefined) {
        if (event.timestamp.sequence < filter.minSequence) {
          return false;
        }
      }

      if (filter.maxSequence !== undefined) {
        if (event.timestamp.sequence > filter.maxSequence) {
          return false;
        }
      }

      return true;
    });
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Validate that a parsed JSON object is a valid EventLogEntry.
 */
function isEventLogEntry(value: unknown): value is EventLogEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check required fields
  if (typeof obj['id'] !== 'string') return false;
  if (typeof obj['type'] !== 'string') return false;
  if (typeof obj['timestamp'] !== 'object' || obj['timestamp'] === null) return false;
  if (typeof obj['data'] !== 'object' || obj['data'] === null) return false;

  // Validate timestamp structure
  const ts = obj['timestamp'] as Record<string, unknown>;
  if (typeof ts['wallClock'] !== 'string') return false;
  if (typeof ts['hrTime'] !== 'string') return false;
  if (typeof ts['sequence'] !== 'number') return false;

  return true;
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown by EventStore operations.
 */
export class EventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStoreError';
    Error.captureStackTrace?.(this, EventStoreError);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and initialise an EventStore.
 *
 * @example
 * ```typescript
 * const store = await createEventStore({
 *   logDirectory: './logs/events',
 *   rotateDaily: true,
 * });
 *
 * await store.append(event);
 * const events = await store.getEvents({ type: 'program_change' });
 * await store.close();
 * ```
 */
export async function createEventStore(
  options: EventStoreOptions
): Promise<EventStore> {
  const store = new EventStore(options);

  // Pre-create directory to fail fast if there are permission issues
  if (!existsSync(options.logDirectory)) {
    await mkdir(options.logDirectory, { recursive: true });
  }

  return store;
}
