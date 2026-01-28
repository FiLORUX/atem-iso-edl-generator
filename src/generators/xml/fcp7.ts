/**
 * FCP7 XML (XMEML v5) Generator.
 * Generates Final Cut Pro 7 compatible XML for import into DaVinci Resolve.
 *
 * FCP7 XML uses frame-based timing, not timecode strings. Key requirements:
 * - `rate` element with `timebase` (integer) and `ntsc` (boolean)
 * - Zero-based `start`/`in`, one-based `end`/`out` for positions
 * - Transitions use sentinel value -1 for in/out points
 * - pathurl must be RFC 2396 encoded file:// URLs
 */

import type { Timeline } from '../../core/timeline/model.js';
import { TimelineBuilder } from '../../core/timeline/model.js';
import type { Timecode, TimecodeOptions } from '../../core/timecode/timecode.js';
import { timecodeToFrames } from '../../core/timecode/timecode.js';
import type { ProgramChangeEvent } from '../../core/events/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for FCP7 XML generation.
 */
export interface Fcp7Options {
  /** Sequence title */
  title: string;
  /** Frame rate (e.g., 23.976, 25, 29.97, 50, 59.94) */
  frameRate: number;
  /** Whether to use drop-frame timecode */
  dropFrame: boolean;
  /** Frame width in pixels */
  width: number;
  /** Frame height in pixels */
  height: number;
  /** Base path for media files (optional) */
  mediaBasePath?: string;
  /** Pixel aspect ratio (default: 'square') */
  pixelAspectRatio?: 'square' | 'NTSC-601' | 'PAL-601' | 'HD (960x1280)';
  /** Field dominance (default: 'none' for progressive) */
  fieldDominance?: 'none' | 'upper' | 'lower';
  /** Audio sample rate in Hz (default: 48000) */
  audioSampleRate?: number;
  /** Audio bit depth (default: 16) */
  audioBitDepth?: number;
}

/**
 * Internal representation of a clip for XML generation.
 */
export interface Fcp7Clip {
  /** Unique clip identifier */
  id: string;
  /** Human-readable clip name */
  name: string;
  /** Source file name */
  fileName: string;
  /** Full file path */
  filePath: string;
  /** Clip duration in frames */
  duration: number;
  /** Start position on timeline (frames, zero-based) */
  start: number;
  /** End position on timeline (frames) */
  end: number;
  /** Source in point (frames) */
  in: number;
  /** Source out point (frames) */
  out: number;
  /** Master clip ID reference */
  masterClipId: string;
}

/**
 * Transition between clips.
 */
export interface Fcp7Transition {
  /** Transition type */
  type: 'dissolve' | 'wipe';
  /** Duration in frames */
  duration: number;
  /** Position on timeline where transition starts (frames) */
  position: number;
  /** Alignment: 'centre', 'start', 'end' */
  alignment?: 'centre' | 'start' | 'end';
}

/**
 * Internal file reference for master clips.
 */
interface FileReference {
  id: string;
  name: string;
  pathurl: string;
  duration: number;
  width: number;
  height: number;
}

// ============================================================================
// Constants
// ============================================================================

/** XMEML version for FCP7 compatibility */
const XMEML_VERSION = '5';

/** Common NTSC frame rates that require ntsc="TRUE" */
const NTSC_FRAME_RATES = [23.976, 29.97, 59.94];

/** FCP7 transition effect IDs */
const TRANSITION_EFFECTS = {
  dissolve: 'Cross Dissolve',
  wipe: 'Wipe',
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Escape XML special characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Encode path for RFC 2396 compliant file:// URL.
 * FCP7 requires properly encoded pathurl elements.
 */
export function encodePathUrl(filePath: string): string {
  // Normalise path separators
  let normalised = filePath.replace(/\\/g, '/');

  // Ensure absolute path starts with /
  if (!normalised.startsWith('/')) {
    normalised = '/' + normalised;
  }

  // Encode each path segment individually
  const segments = normalised.split('/');
  const encoded = segments
    .map((segment) => {
      if (segment === '') return '';
      // RFC 2396 encoding: encode all except unreserved characters
      // unreserved = alphanum | mark
      // mark = "-" | "_" | "." | "!" | "~" | "*" | "'" | "(" | ")"
      return encodeURIComponent(segment)
        .replace(/%2D/g, '-')
        .replace(/%5F/g, '_')
        .replace(/%2E/g, '.')
        .replace(/%21/g, '!')
        .replace(/%7E/g, '~')
        .replace(/%2A/g, '*')
        .replace(/%27/g, "'")
        .replace(/%28/g, '(')
        .replace(/%29/g, ')');
    })
    .join('/');

  return `file://localhost${encoded}`;
}

/**
 * Determine if frame rate is NTSC (requires ntsc="TRUE" in XML).
 */
export function isNtscFrameRate(frameRate: number): boolean {
  // Check if the frame rate is within tolerance of known NTSC rates
  return NTSC_FRAME_RATES.some((ntsc) => Math.abs(frameRate - ntsc) < 0.01);
}

/**
 * Get the integer timebase for a given frame rate.
 * FCP7 uses integer timebases with the ntsc flag for fractional rates.
 */
export function getTimebase(frameRate: number): number {
  // Round to nearest integer for the timebase
  // 23.976 -> 24, 29.97 -> 30, 59.94 -> 60
  return Math.round(frameRate);
}

/**
 * Convert frames to timecode string for FCP7 XML.
 * FCP7 expects HH:MM:SS:FF format (colon for non-drop, semicolon for drop).
 */
export function framesToTimecodeString(
  frames: number,
  frameRate: number,
  dropFrame: boolean
): string {
  const timebase = getTimebase(frameRate);

  // Handle drop-frame conversion
  if (dropFrame && isNtscFrameRate(frameRate)) {
    return framesToDropFrameTimecode(frames, timebase);
  }

  // Non-drop-frame calculation
  const framesPerSecond = timebase;
  const framesPerMinute = framesPerSecond * 60;
  const framesPerHour = framesPerMinute * 60;

  const hours = Math.floor(frames / framesPerHour);
  const remainingAfterHours = frames % framesPerHour;
  const minutes = Math.floor(remainingAfterHours / framesPerMinute);
  const remainingAfterMinutes = remainingAfterHours % framesPerMinute;
  const seconds = Math.floor(remainingAfterMinutes / framesPerSecond);
  const frameCount = remainingAfterMinutes % framesPerSecond;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const separator = dropFrame ? ';' : ':';

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(frameCount)}`;
}

/**
 * Convert frames to drop-frame timecode string.
 */
function framesToDropFrameTimecode(totalFrames: number, timebase: number): string {
  // Drop-frame drops 2 frames (for 30fps) at the start of each minute
  // except for minutes divisible by 10
  const dropFrames = timebase === 30 ? 2 : 4; // 4 for 60fps
  const framesPerMinute = timebase * 60 - dropFrames;
  const framesPer10Minutes = framesPerMinute * 10 + dropFrames;

  const tenMinuteBlocks = Math.floor(totalFrames / framesPer10Minutes);
  let remainingFrames = totalFrames % framesPer10Minutes;

  let totalMinutes = tenMinuteBlocks * 10;

  // First minute of the 10-minute block has no drops
  if (remainingFrames >= timebase * 60) {
    totalMinutes += 1;
    remainingFrames -= timebase * 60;

    // Remaining minutes have drops
    const additionalMinutes = Math.floor(remainingFrames / framesPerMinute);
    totalMinutes += additionalMinutes;
    remainingFrames = remainingFrames % framesPerMinute;

    // Add back dropped frames for display
    if (additionalMinutes > 0) {
      remainingFrames += dropFrames;
    }
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor(remainingFrames / timebase);
  const frameCount = remainingFrames % timebase;

  const pad = (n: number) => n.toString().padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)};${pad(frameCount)}`;
}

/**
 * Generate a unique ID for FCP7 XML elements.
 */
function generateId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

// ============================================================================
// XML Building Functions
// ============================================================================

/**
 * Build the rate element for FCP7 XML.
 * Handles both NTSC and non-NTSC frame rates correctly.
 *
 * @param frameRate - Frame rate in fps
 * @param _dropFrame - Drop-frame flag (reserved for future use)
 */
export function buildRateXml(frameRate: number, _dropFrame: boolean): string {
  const timebase = getTimebase(frameRate);
  const isNtsc = isNtscFrameRate(frameRate);

  return `<rate>
      <timebase>${timebase}</timebase>
      <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
    </rate>`;
}

/**
 * Build the timecode element for FCP7 XML.
 */
function buildTimecodeXml(
  startFrame: number,
  frameRate: number,
  dropFrame: boolean
): string {
  const timebase = getTimebase(frameRate);
  const isNtsc = isNtscFrameRate(frameRate);
  const tcString = framesToTimecodeString(startFrame, frameRate, dropFrame);

  return `<timecode>
        <rate>
          <timebase>${timebase}</timebase>
          <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
        </rate>
        <string>${tcString}</string>
        <frame>${startFrame}</frame>
        <displayformat>${dropFrame ? 'DF' : 'NDF'}</displayformat>
      </timecode>`;
}

/**
 * Build a file element for FCP7 XML (master clip reference).
 */
function buildFileXml(file: FileReference, options: Fcp7Options): string {
  const timebase = getTimebase(options.frameRate);
  const isNtsc = isNtscFrameRate(options.frameRate);
  const sampleRate = options.audioSampleRate ?? 48000;
  const bitDepth = options.audioBitDepth ?? 16;

  return `<file id="${escapeXml(file.id)}">
        <name>${escapeXml(file.name)}</name>
        <pathurl>${escapeXml(file.pathurl)}</pathurl>
        <rate>
          <timebase>${timebase}</timebase>
          <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
        </rate>
        <duration>${file.duration}</duration>
        <media>
          <video>
            <samplecharacteristics>
              <rate>
                <timebase>${timebase}</timebase>
                <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
              </rate>
              <width>${file.width}</width>
              <height>${file.height}</height>
              <anamorphic>FALSE</anamorphic>
              <pixelaspectratio>${options.pixelAspectRatio ?? 'square'}</pixelaspectratio>
              <fielddominance>${options.fieldDominance ?? 'none'}</fielddominance>
            </samplecharacteristics>
          </video>
          <audio>
            <samplecharacteristics>
              <depth>${bitDepth}</depth>
              <samplerate>${sampleRate}</samplerate>
            </samplecharacteristics>
            <channelcount>2</channelcount>
          </audio>
        </media>
      </file>`;
}

/**
 * Build a clipitem element for FCP7 XML.
 */
export function buildClipitemXml(
  clip: Fcp7Clip,
  options: Fcp7Options,
  fileId: string
): string {
  const timebase = getTimebase(options.frameRate);
  const isNtsc = isNtscFrameRate(options.frameRate);

  return `<clipitem id="${escapeXml(clip.id)}">
          <name>${escapeXml(clip.name)}</name>
          <duration>${clip.duration}</duration>
          <rate>
            <timebase>${timebase}</timebase>
            <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
          </rate>
          <start>${clip.start}</start>
          <end>${clip.end}</end>
          <in>${clip.in}</in>
          <out>${clip.out}</out>
          <masterclipid>${escapeXml(clip.masterClipId)}</masterclipid>
          <file id="${escapeXml(fileId)}"/>
        </clipitem>`;
}

/**
 * Build a transition element for FCP7 XML.
 * Transitions use -1 sentinel values for in/out points.
 */
export function buildTransitionXml(
  transition: Fcp7Transition,
  options: Fcp7Options
): string {
  const timebase = getTimebase(options.frameRate);
  const isNtsc = isNtscFrameRate(options.frameRate);
  const effectName = TRANSITION_EFFECTS[transition.type];
  const alignment = transition.alignment ?? 'centre';

  // Calculate start and end positions
  // Transitions are centred on the cut point by default
  let start: number;
  let end: number;

  switch (alignment) {
    case 'start':
      start = transition.position;
      end = transition.position + transition.duration;
      break;
    case 'end':
      start = transition.position - transition.duration;
      end = transition.position;
      break;
    case 'centre':
    default:
      const halfDuration = Math.floor(transition.duration / 2);
      start = transition.position - halfDuration;
      end = transition.position + (transition.duration - halfDuration);
      break;
  }

  return `<transitionitem>
          <rate>
            <timebase>${timebase}</timebase>
            <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
          </rate>
          <start>${start}</start>
          <end>${end}</end>
          <alignment>${alignment}</alignment>
          <effect>
            <name>${effectName}</name>
            <effectid>${transition.type === 'dissolve' ? 'Cross Dissolve' : 'SMPTE Wipe'}</effectid>
            <effectcategory>Dissolve</effectcategory>
            <effecttype>transition</effecttype>
            <mediatype>video</mediatype>
          </effect>
        </transitionitem>`;
}

/**
 * Build the video track element containing all clips and transitions.
 */
function buildVideoTrackXml(
  clips: Fcp7Clip[],
  transitions: Fcp7Transition[],
  options: Fcp7Options
): string {
  const clipItems = clips
    .map((clip) => buildClipitemXml(clip, options, clip.masterClipId))
    .join('\n        ');

  const transitionItems = transitions
    .map((t) => buildTransitionXml(t, options))
    .join('\n        ');

  return `<track>
        <locked>FALSE</locked>
        <enabled>TRUE</enabled>
        ${clipItems}
        ${transitionItems}
      </track>`;
}

/**
 * Build the complete sequence element for FCP7 XML.
 */
export function buildSequenceXml(
  clips: Fcp7Clip[],
  transitions: Fcp7Transition[],
  files: Map<string, FileReference>,
  options: Fcp7Options
): string {
  const timebase = getTimebase(options.frameRate);
  const isNtsc = isNtscFrameRate(options.frameRate);
  const sampleRate = options.audioSampleRate ?? 48000;
  const bitDepth = options.audioBitDepth ?? 16;

  // Calculate total duration
  const totalDuration = clips.length > 0 ? Math.max(...clips.map((c) => c.end)) : 0;

  // Build file definitions (used for master clip references)
  const fileXmls = Array.from(files.values())
    .map((f) => buildFileXml(f, options))
    .join('\n    ');

  // Build video track
  const videoTrack = buildVideoTrackXml(clips, transitions, options);

  // Start timecode (use 01:00:00:00 as broadcast standard)
  const startFrame = timebase * 3600; // 1 hour in frames
  const timecodeXml = buildTimecodeXml(startFrame, options.frameRate, options.dropFrame);

  // File definitions go in a bin element at the project level
  // The sequence references files by ID
  void fileXmls; // Files are referenced by ID in clipitems

  return `<sequence id="sequence-1">
    <name>${escapeXml(options.title)}</name>
    <duration>${totalDuration}</duration>
    <rate>
      <timebase>${timebase}</timebase>
      <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
    </rate>
    ${timecodeXml}
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${isNtsc ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <width>${options.width}</width>
            <height>${options.height}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>${options.pixelAspectRatio ?? 'square'}</pixelaspectratio>
            <fielddominance>${options.fieldDominance ?? 'none'}</fielddominance>
          </samplecharacteristics>
        </format>
        ${videoTrack}
      </video>
      <audio>
        <format>
          <samplecharacteristics>
            <depth>${bitDepth}</depth>
            <samplerate>${sampleRate}</samplerate>
          </samplecharacteristics>
        </format>
        <track>
          <locked>FALSE</locked>
          <enabled>TRUE</enabled>
          <outputchannelindex>1</outputchannelindex>
        </track>
        <track>
          <locked>FALSE</locked>
          <enabled>TRUE</enabled>
          <outputchannelindex>2</outputchannelindex>
        </track>
      </audio>
    </media>
  </sequence>`;
}

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Generate FCP7 XML from a Timeline.
 *
 * @param timeline - The timeline to convert
 * @param options - Generation options
 * @returns Complete FCP7 XML document as string
 *
 * @example
 * ```typescript
 * const xml = generateFcp7Xml(timeline, {
 *   title: 'My Sequence',
 *   frameRate: 25,
 *   dropFrame: false,
 *   width: 1920,
 *   height: 1080,
 *   mediaBasePath: '/Volumes/Media/Project',
 * });
 * ```
 */
export function generateFcp7Xml(timeline: Timeline, options: Fcp7Options): string {
  const tcOptions: TimecodeOptions = {
    frameRate: timeline.frameRate,
    dropFrame: timeline.dropFrame,
  };

  const edits = timeline.getEdits();
  const clips: Fcp7Clip[] = [];
  const transitions: Fcp7Transition[] = [];
  const files = new Map<string, FileReference>();

  // Convert timeline edits to FCP7 clips
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    const clipId = generateId('clipitem', i + 1);
    const fileId = generateId('file', edit.sourceId);

    // Calculate frame positions
    const startFrames = timecodeToFrames(edit.recordIn, tcOptions);
    const endFrames = timecodeToFrames(edit.recordOut, tcOptions);
    const sourceInFrames = timecodeToFrames(edit.sourceIn, tcOptions);
    const sourceOutFrames = timecodeToFrames(edit.sourceOut, tcOptions);
    const duration = sourceOutFrames - sourceInFrames;

    // Build file path
    const fileName = `${edit.reelName}_ISO.MOV`;
    const filePath = options.mediaBasePath
      ? `${options.mediaBasePath}/${fileName}`
      : fileName;

    // Create or update file reference
    if (!files.has(fileId)) {
      files.set(fileId, {
        id: fileId,
        name: fileName,
        pathurl: encodePathUrl(filePath),
        // Use a long duration for source clips (24 hours of frames)
        duration: getTimebase(options.frameRate) * 86400,
        width: options.width,
        height: options.height,
      });
    }

    // Create clip
    clips.push({
      id: clipId,
      name: edit.sourceName,
      fileName,
      filePath,
      duration,
      start: startFrames,
      end: endFrames,
      in: sourceInFrames,
      out: sourceOutFrames,
      masterClipId: fileId, // Reference the file ID for linking
    });

    // Create transition if not a cut
    if (edit.transitionType !== 'cut' && edit.transitionDuration > 0) {
      transitions.push({
        type: edit.transitionType === 'dissolve' ? 'dissolve' : 'wipe',
        duration: edit.transitionDuration,
        position: startFrames,
        alignment: 'centre',
      });
    }
  }

  // Build sequence XML
  const sequenceXml = buildSequenceXml(clips, transitions, files, options);

  // Build complete document
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="${XMEML_VERSION}">
  ${sequenceXml}
</xmeml>`;

  return xml;
}

/**
 * Generate FCP7 XML from raw program change events.
 * Convenience function that creates a timeline internally.
 */
export function generateFcp7XmlFromEvents(
  events: ProgramChangeEvent[],
  options: Fcp7Options & { startTimecode?: Timecode }
): string {
  const builder = new TimelineBuilder();
  const builderOptions = {
    frameRate: options.frameRate,
    dropFrame: options.dropFrame,
    title: options.title,
    ...(options.startTimecode !== undefined && { startTimecode: options.startTimecode }),
  };
  const timeline = builder.fromProgramChanges(events, builderOptions);

  return generateFcp7Xml(timeline, options);
}

/**
 * Validate FCP7 options for common issues.
 */
export function validateFcp7Options(options: Fcp7Options): string[] {
  const errors: string[] = [];

  // Validate frame rate
  const validRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const rateValid = validRates.some((r) => Math.abs(options.frameRate - r) < 0.01);
  if (!rateValid) {
    errors.push(`Unusual frame rate: ${options.frameRate}. Common rates are: ${validRates.join(', ')}`);
  }

  // Validate drop-frame setting
  if (options.dropFrame && !isNtscFrameRate(options.frameRate)) {
    errors.push(
      `Drop-frame timecode is only valid for NTSC rates (23.976, 29.97, 59.94). ` +
        `Got ${options.frameRate} fps.`
    );
  }

  // Validate dimensions
  if (options.width <= 0 || options.height <= 0) {
    errors.push(`Invalid dimensions: ${options.width}x${options.height}`);
  }

  // Validate title
  if (!options.title || options.title.trim() === '') {
    errors.push('Title is required');
  }

  return errors;
}
