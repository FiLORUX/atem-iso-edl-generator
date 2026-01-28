/**
 * DaVinci Resolve Project (.drp) Generator for ATEM ISO.
 *
 * Generates newline-delimited JSON files compatible with DaVinci Resolve's
 * ATEM ISO import feature. Each line is a valid JSON object:
 *   - Line 1: Header with metadata, sources, and initial state
 *   - Lines 2+: Switching events with timecode and source changes
 *
 * This format allows Resolve to reconstruct the multicam timeline from
 * individual ISO recordings based on the switching events captured from
 * the ATEM's program bus.
 */

import type { Timeline, TimelineEdit } from '../../core/timeline/model.js';
import { formatTimecode } from '../../core/timecode/timecode.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Source definition in the DRP header.
 * Each source corresponds to an ATEM input with an ISO recording.
 */
export interface DrpSource {
  /** Human-readable source name */
  name: string;
  /** Source type (Video for camera inputs, Still for graphics, etc.) */
  type: 'Video' | 'Still' | 'ColorBars' | 'Color';
  /** Volume name where the source file resides */
  volume: string;
  /** Path relative to volume root */
  projectPath: string;
  /** Filename of the ISO recording */
  file: string;
  /** Starting timecode of the recording */
  startTimecode: string;
  /** Zero-based index matching ATEM input order */
  _index_: number;
}

/**
 * Mix/Effect block state in header and events.
 * Tracks which source is active on each M/E bus.
 */
export interface DrpMixEffectBlock {
  /** Active source index (references DrpSource._index_) */
  source: number;
  /** M/E block index (0 for M/E 1, etc.) */
  _index_: number;
}

/**
 * DRP header structure (first line of the file).
 * Contains all metadata needed to reconstruct the project.
 */
export interface DrpHeader {
  /** Format version (always 1) */
  version: number;
  /** Starting master timecode in HH:MM:SS:FF format */
  masterTimecode: string;
  /** Video mode string (e.g., "1080p25", "2160p30") */
  videoMode: string;
  /** Unique recording session identifier */
  recordingId: string;
  /** Array of source definitions */
  sources: DrpSource[];
  /** Initial state of each M/E block */
  mixEffectBlocks: DrpMixEffectBlock[];
}

/**
 * DRP event structure (lines 2+ of the file).
 * Each event represents a program bus change.
 */
export interface DrpEvent {
  /** Timecode when the switch occurred */
  masterTimecode: string;
  /** New state of the M/E blocks */
  mixEffectBlocks: DrpMixEffectBlock[];
}

/**
 * Source mapping configuration.
 * Maps ATEM input IDs to file paths for ISO recordings.
 */
export interface SourceMapping {
  /** ATEM input ID */
  inputId: number;
  /** Human-readable name */
  name: string;
  /** Volume name (e.g., "Macintosh HD", "Recording Drive") */
  volume: string;
  /** Path from volume root to project folder */
  projectPath: string;
  /** ISO recording filename */
  filename: string;
  /** Recording start timecode (defaults to timeline start) */
  startTimecode?: string;
  /** Source type override */
  type?: 'Video' | 'Still' | 'ColorBars' | 'Color';
}

/**
 * Options for DRP generation.
 */
export interface DrpOptions {
  /** Video mode (e.g., "1080p25") or null to auto-detect from frame rate */
  videoMode?: string;
  /** Recording session ID or null to auto-generate */
  recordingId?: string;
  /** Source file mappings */
  sources: SourceMapping[];
  /** Default volume for sources without explicit volume */
  defaultVolume?: string;
  /** Default project path for sources without explicit path */
  defaultProjectPath?: string;
  /** File extension for ISO recordings (default: ".mov") */
  fileExtension?: string;
  /** Video dimensions for auto video mode detection */
  videoDimensions?: { width: number; height: number };
}

/**
 * Complete DRP document ready for serialisation.
 */
export interface DrpDocument {
  header: DrpHeader;
  events: DrpEvent[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default file extension for ISO recordings */
const DEFAULT_FILE_EXTENSION = '.mov';

/** Default volume name when not specified */
const DEFAULT_VOLUME = 'Macintosh HD';

/** Default project path when not specified */
const DEFAULT_PROJECT_PATH = '';

/** Version number for DRP format */
const DRP_VERSION = 1;

// ============================================================================
// Video Mode Handling
// ============================================================================

/**
 * Standard video mode mappings.
 * Maps frame rate and resolution to Resolve video mode strings.
 */
const VIDEO_MODES: Record<string, string> = {
  // 1080p modes
  '1920x1080@23.976': '1080p23.976',
  '1920x1080@24': '1080p24',
  '1920x1080@25': '1080p25',
  '1920x1080@29.97': '1080p29.97',
  '1920x1080@30': '1080p30',
  '1920x1080@50': '1080p50',
  '1920x1080@59.94': '1080p59.94',
  '1920x1080@60': '1080p60',

  // 1080i modes
  '1920x1080@25i': '1080i50',
  '1920x1080@29.97i': '1080i59.94',
  '1920x1080@30i': '1080i60',

  // 2160p (4K UHD) modes
  '3840x2160@23.976': '2160p23.976',
  '3840x2160@24': '2160p24',
  '3840x2160@25': '2160p25',
  '3840x2160@29.97': '2160p29.97',
  '3840x2160@30': '2160p30',
  '3840x2160@50': '2160p50',
  '3840x2160@59.94': '2160p59.94',
  '3840x2160@60': '2160p60',

  // 720p modes
  '1280x720@50': '720p50',
  '1280x720@59.94': '720p59.94',
  '1280x720@60': '720p60',

  // SD modes (for completeness)
  '720x576@25': '576p25',
  '720x576@25i': '576i50',
  '720x480@29.97': '480p29.97',
  '720x480@29.97i': '480i59.94',
};

/**
 * Format video mode string from resolution and frame rate.
 *
 * Falls back to a reasonable default format if the exact combination
 * is not found in the standard modes table.
 *
 * @param width - Horizontal resolution in pixels
 * @param height - Vertical resolution in pixels
 * @param frameRate - Frame rate (e.g., 25, 29.97, 50)
 * @param interlaced - Whether the format is interlaced
 * @returns Video mode string (e.g., "1080p25", "2160p30")
 */
export function formatVideoMode(
  width: number,
  height: number,
  frameRate: number,
  interlaced: boolean = false
): string {
  // Normalise frame rate for lookup
  const frameRateKey = normaliseFrameRate(frameRate);
  const suffix = interlaced ? 'i' : '';
  const lookupKey = `${width}x${height}@${frameRateKey}${suffix}`;

  // Check standard modes first
  if (VIDEO_MODES[lookupKey]) {
    return VIDEO_MODES[lookupKey]!;
  }

  // Fall back to constructed format
  const scanType = interlaced ? 'i' : 'p';
  const heightStr = height.toString();

  return `${heightStr}${scanType}${frameRateKey}`;
}

/**
 * Normalise frame rate to standard notation.
 * Handles floating-point precision issues (e.g., 29.97 vs 29.97002997).
 */
function normaliseFrameRate(frameRate: number): string {
  // Common broadcast frame rates with their normalised representations
  const knownRates: [number, string][] = [
    [23.976, '23.976'],
    [23.98, '23.976'],
    [24, '24'],
    [25, '25'],
    [29.97, '29.97'],
    [30, '30'],
    [50, '50'],
    [59.94, '59.94'],
    [60, '60'],
  ];

  // Find closest match within tolerance
  for (const [rate, label] of knownRates) {
    if (Math.abs(frameRate - rate) < 0.01) {
      return label;
    }
  }

  // Return as-is if no match
  return frameRate.toString();
}

// ============================================================================
// Recording ID Generation
// ============================================================================

/**
 * Generate a unique recording ID.
 *
 * Format: ISO 8601 date-time with random suffix for uniqueness.
 * Example: "2024-01-15T14:30:00Z-a7b3c9"
 */
export function generateRecordingId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

// ============================================================================
// Source Building
// ============================================================================

/**
 * Build source array from timeline and mappings.
 *
 * Creates DrpSource entries for each unique input in the timeline,
 * using the provided mappings for file paths and metadata.
 */
function buildSources(
  timeline: Timeline,
  options: DrpOptions
): { sources: DrpSource[]; sourceIndexMap: Map<number, number> } {
  const sourceIndexMap = new Map<number, number>();
  const sources: DrpSource[] = [];

  // Collect unique source IDs from timeline
  const uniqueSourceIds = new Set<number>();
  for (const edit of timeline.getEdits()) {
    uniqueSourceIds.add(edit.sourceId);
  }

  // Build source entries
  let index = 0;
  for (const sourceId of uniqueSourceIds) {
    const mapping = options.sources.find((s) => s.inputId === sourceId);

    const source: DrpSource = {
      name: mapping?.name ?? `Input ${sourceId}`,
      type: mapping?.type ?? 'Video',
      volume: mapping?.volume ?? options.defaultVolume ?? DEFAULT_VOLUME,
      projectPath: mapping?.projectPath ?? options.defaultProjectPath ?? DEFAULT_PROJECT_PATH,
      file: mapping?.filename ?? buildDefaultFilename(sourceId, options),
      startTimecode: mapping?.startTimecode ?? formatTimecode(timeline.startTimecode, timeline.dropFrame),
      _index_: index,
    };

    sources.push(source);
    sourceIndexMap.set(sourceId, index);
    index++;
  }

  return { sources, sourceIndexMap };
}

/**
 * Build default filename for a source without explicit mapping.
 */
function buildDefaultFilename(sourceId: number, options: DrpOptions): string {
  const ext = options.fileExtension ?? DEFAULT_FILE_EXTENSION;
  return `Input_${sourceId}_ISO${ext}`;
}

// ============================================================================
// Header Building
// ============================================================================

/**
 * Build DRP header from timeline and options.
 */
export function buildHeader(
  timeline: Timeline,
  sources: DrpSource[],
  initialSourceIndex: number,
  options: DrpOptions
): DrpHeader {
  // Determine video mode
  let videoMode: string;
  if (options.videoMode) {
    videoMode = options.videoMode;
  } else if (options.videoDimensions) {
    videoMode = formatVideoMode(
      options.videoDimensions.width,
      options.videoDimensions.height,
      timeline.frameRate
    );
  } else {
    // Default to 1080p at timeline frame rate
    videoMode = formatVideoMode(1920, 1080, timeline.frameRate);
  }

  return {
    version: DRP_VERSION,
    masterTimecode: formatTimecode(timeline.startTimecode, timeline.dropFrame),
    videoMode,
    recordingId: options.recordingId ?? generateRecordingId(),
    sources,
    mixEffectBlocks: [
      {
        source: initialSourceIndex,
        _index_: 0,
      },
    ],
  };
}

// ============================================================================
// Event Building
// ============================================================================

/**
 * Build a single DRP event from a timeline edit.
 */
export function buildEvent(
  edit: TimelineEdit,
  sourceIndexMap: Map<number, number>,
  dropFrame: boolean
): DrpEvent {
  const sourceIndex = sourceIndexMap.get(edit.sourceId);

  if (sourceIndex === undefined) {
    throw new Error(
      `Source index not found for input ID ${edit.sourceId}. ` +
        `This indicates a bug in the DRP generator.`
    );
  }

  return {
    masterTimecode: formatTimecode(edit.recordIn, dropFrame),
    mixEffectBlocks: [
      {
        source: sourceIndex,
        _index_: 0,
      },
    ],
  };
}

// ============================================================================
// Document Building
// ============================================================================

/**
 * Build complete DRP document from timeline.
 */
export function buildDrpDocument(
  timeline: Timeline,
  options: DrpOptions
): DrpDocument {
  const edits = timeline.getEdits();

  if (edits.length === 0) {
    throw new Error('Cannot generate DRP from empty timeline');
  }

  // Build sources and index mapping
  const { sources, sourceIndexMap } = buildSources(timeline, options);

  // Get initial source from first edit
  const firstEdit = edits[0]!;
  const initialSourceIndex = sourceIndexMap.get(firstEdit.sourceId) ?? 0;

  // Build header
  const header = buildHeader(timeline, sources, initialSourceIndex, options);

  // Build events (skip first edit as it's represented in header)
  const events: DrpEvent[] = [];
  for (let i = 1; i < edits.length; i++) {
    const edit = edits[i]!;
    events.push(buildEvent(edit, sourceIndexMap, timeline.dropFrame));
  }

  return { header, events };
}

// ============================================================================
// Serialisation
// ============================================================================

/**
 * Serialise DRP document to newline-delimited JSON string.
 *
 * Each line is a valid JSON object:
 *   - Line 1: Header
 *   - Lines 2+: Events
 *
 * The output is compatible with DaVinci Resolve's ATEM ISO import.
 */
export function serialiseDrp(document: DrpDocument): string {
  const lines: string[] = [];

  // Header line
  lines.push(JSON.stringify(document.header));

  // Event lines
  for (const event of document.events) {
    lines.push(JSON.stringify(event));
  }

  // Ensure trailing newline
  return lines.join('\n') + '\n';
}

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Generate DaVinci Resolve Project file content from timeline.
 *
 * This is the main entry point for DRP generation. It takes a timeline
 * (built from ATEM switching events) and options, and produces a
 * newline-delimited JSON string ready for writing to a .drp file.
 *
 * @example
 * ```typescript
 * const drpContent = generateDrp(timeline, {
 *   videoMode: '1080p25',
 *   sources: [
 *     { inputId: 1, name: 'Camera 1', volume: 'Recording', projectPath: '/ISO', filename: 'Cam1.mov' },
 *     { inputId: 2, name: 'Camera 2', volume: 'Recording', projectPath: '/ISO', filename: 'Cam2.mov' },
 *   ],
 * });
 *
 * await fs.writeFile('project.drp', drpContent);
 * ```
 *
 * @param timeline - Timeline built from switching events
 * @param options - Generation options including source mappings
 * @returns Newline-delimited JSON string for .drp file
 */
export function generateDrp(timeline: Timeline, options: DrpOptions): string {
  const document = buildDrpDocument(timeline, options);
  return serialiseDrp(document);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate DRP document for common issues.
 *
 * @returns Array of error messages (empty if valid)
 */
export function validateDrp(document: DrpDocument): string[] {
  const errors: string[] = [];

  // Validate header
  if (document.header.version !== DRP_VERSION) {
    errors.push(`Invalid version: expected ${DRP_VERSION}, got ${document.header.version}`);
  }

  if (document.header.sources.length === 0) {
    errors.push('No sources defined in header');
  }

  if (document.header.mixEffectBlocks.length === 0) {
    errors.push('No mix/effect blocks defined in header');
  }

  // Validate source indices
  const sourceIndices = new Set(document.header.sources.map((s) => s._index_));
  for (const meBlock of document.header.mixEffectBlocks) {
    if (!sourceIndices.has(meBlock.source)) {
      errors.push(
        `Header M/E block references invalid source index: ${meBlock.source}`
      );
    }
  }

  // Validate events
  for (let i = 0; i < document.events.length; i++) {
    const event = document.events[i]!;

    for (const meBlock of event.mixEffectBlocks) {
      if (!sourceIndices.has(meBlock.source)) {
        errors.push(
          `Event ${i + 1} references invalid source index: ${meBlock.source}`
        );
      }
    }
  }

  // Validate timecode format
  const timecodePattern = /^\d{2}:\d{2}:\d{2}[:;]\d{2}$/;
  if (!timecodePattern.test(document.header.masterTimecode)) {
    errors.push(
      `Invalid master timecode format: ${document.header.masterTimecode}`
    );
  }

  for (let i = 0; i < document.events.length; i++) {
    const event = document.events[i]!;
    if (!timecodePattern.test(event.masterTimecode)) {
      errors.push(
        `Event ${i + 1} has invalid timecode format: ${event.masterTimecode}`
      );
    }
  }

  return errors;
}

// ============================================================================
// Parsing (for testing and round-trip verification)
// ============================================================================

/**
 * Parse DRP file content back into document structure.
 *
 * Useful for testing and verifying generated output.
 */
export function parseDrp(content: string): DrpDocument {
  const trimmed = content.trim();

  if (trimmed === '') {
    throw new Error('Empty DRP file');
  }

  const lines = trimmed.split('\n');

  // Parse header (first line)
  let header: DrpHeader;
  try {
    header = JSON.parse(lines[0]!) as DrpHeader;
  } catch (error) {
    throw new Error(`Failed to parse DRP header: ${error}`);
  }

  // Parse events (remaining lines)
  const events: DrpEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;

    try {
      events.push(JSON.parse(line) as DrpEvent);
    } catch (error) {
      throw new Error(`Failed to parse DRP event at line ${i + 1}: ${error}`);
    }
  }

  return { header, events };
}
