/**
 * DRP generator tests.
 */

import { describe, it, expect } from 'vitest';
import {
  generateDrp,
  buildDrpDocument,
  buildHeader,
  buildEvent,
  formatVideoMode,
  generateRecordingId,
  validateDrp,
  parseDrp,
  type DrpDocument,
  type DrpOptions,
  type DrpSource,
} from '../src/generators/drp/resolve.js';
import { Timeline, type TimelineEdit } from '../src/core/timeline/model.js';
import type { Timecode } from '../src/core/timecode/timecode.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestTimeline(): Timeline {
  const timeline = new Timeline({
    frameRate: 25,
    dropFrame: false,
    title: 'TEST_PRODUCTION',
    startTimecode: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
  });

  // Add some test edits
  const edits: TimelineEdit[] = [
    {
      id: 'edit-1',
      sourceId: 1,
      sourceName: 'Camera 1',
      reelName: 'CAM1',
      sourceIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
      sourceOut: { hours: 1, minutes: 0, seconds: 10, frames: 0 },
      recordIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
      recordOut: { hours: 1, minutes: 0, seconds: 10, frames: 0 },
      transitionType: 'cut',
      transitionDuration: 0,
      metadata: {},
    },
    {
      id: 'edit-2',
      sourceId: 2,
      sourceName: 'Camera 2',
      reelName: 'CAM2',
      sourceIn: { hours: 1, minutes: 0, seconds: 10, frames: 0 },
      sourceOut: { hours: 1, minutes: 0, seconds: 20, frames: 0 },
      recordIn: { hours: 1, minutes: 0, seconds: 10, frames: 0 },
      recordOut: { hours: 1, minutes: 0, seconds: 20, frames: 0 },
      transitionType: 'cut',
      transitionDuration: 0,
      metadata: {},
    },
    {
      id: 'edit-3',
      sourceId: 1,
      sourceName: 'Camera 1',
      reelName: 'CAM1',
      sourceIn: { hours: 1, minutes: 0, seconds: 20, frames: 0 },
      sourceOut: { hours: 1, minutes: 0, seconds: 30, frames: 0 },
      recordIn: { hours: 1, minutes: 0, seconds: 20, frames: 0 },
      recordOut: { hours: 1, minutes: 0, seconds: 30, frames: 0 },
      transitionType: 'dissolve',
      transitionDuration: 25,
      metadata: {},
    },
  ];

  for (const edit of edits) {
    timeline.addEdit(edit);
  }

  return timeline;
}

const testOptions: DrpOptions = {
  videoMode: '1080p25',
  sources: [
    {
      inputId: 1,
      name: 'Camera 1',
      volume: 'Recording',
      projectPath: '/ISO',
      filename: 'Cam1_ISO.mov',
    },
    {
      inputId: 2,
      name: 'Camera 2',
      volume: 'Recording',
      projectPath: '/ISO',
      filename: 'Cam2_ISO.mov',
    },
  ],
};

// ============================================================================
// formatVideoMode Tests
// ============================================================================

describe('formatVideoMode', () => {
  it('formats 1080p25 correctly', () => {
    expect(formatVideoMode(1920, 1080, 25)).toBe('1080p25');
  });

  it('formats 1080p29.97 correctly', () => {
    expect(formatVideoMode(1920, 1080, 29.97)).toBe('1080p29.97');
  });

  it('formats 2160p30 (4K UHD) correctly', () => {
    expect(formatVideoMode(3840, 2160, 30)).toBe('2160p30');
  });

  it('formats 720p50 correctly', () => {
    expect(formatVideoMode(1280, 720, 50)).toBe('720p50');
  });

  it('formats interlaced modes correctly', () => {
    expect(formatVideoMode(1920, 1080, 25, true)).toBe('1080i50');
    expect(formatVideoMode(1920, 1080, 29.97, true)).toBe('1080i59.94');
  });

  it('handles non-standard frame rates gracefully', () => {
    const result = formatVideoMode(1920, 1080, 48);
    expect(result).toBe('1080p48');
  });
});

// ============================================================================
// generateRecordingId Tests
// ============================================================================

describe('generateRecordingId', () => {
  it('generates unique IDs', () => {
    const id1 = generateRecordingId();
    const id2 = generateRecordingId();
    expect(id1).not.toBe(id2);
  });

  it('generates IDs with expected format', () => {
    const id = generateRecordingId();
    // Should contain timestamp-like format and random suffix
    expect(id.length).toBeGreaterThan(20);
    expect(id).toMatch(/-[a-z0-9]{6}$/);
  });
});

// ============================================================================
// buildDrpDocument Tests
// ============================================================================

describe('buildDrpDocument', () => {
  it('builds document with correct header', () => {
    const timeline = createTestTimeline();
    const doc = buildDrpDocument(timeline, testOptions);

    expect(doc.header.version).toBe(1);
    expect(doc.header.videoMode).toBe('1080p25');
    expect(doc.header.masterTimecode).toBe('01:00:00:00');
  });

  it('builds document with correct sources', () => {
    const timeline = createTestTimeline();
    const doc = buildDrpDocument(timeline, testOptions);

    expect(doc.header.sources.length).toBe(2);

    const cam1 = doc.header.sources.find((s) => s.name === 'Camera 1');
    expect(cam1).toBeDefined();
    expect(cam1?.file).toBe('Cam1_ISO.mov');
    expect(cam1?.volume).toBe('Recording');
    expect(cam1?.projectPath).toBe('/ISO');

    const cam2 = doc.header.sources.find((s) => s.name === 'Camera 2');
    expect(cam2).toBeDefined();
    expect(cam2?.file).toBe('Cam2_ISO.mov');
  });

  it('builds document with correct events', () => {
    const timeline = createTestTimeline();
    const doc = buildDrpDocument(timeline, testOptions);

    // First edit is in header, so we should have 2 events
    expect(doc.events.length).toBe(2);

    // Second event should be at 01:00:10:00 (Camera 2)
    expect(doc.events[0]?.masterTimecode).toBe('01:00:10:00');

    // Third event should be at 01:00:20:00 (Camera 1 again)
    expect(doc.events[1]?.masterTimecode).toBe('01:00:20:00');
  });

  it('throws on empty timeline', () => {
    const emptyTimeline = new Timeline({
      frameRate: 25,
      dropFrame: false,
      title: 'EMPTY',
    });

    expect(() => buildDrpDocument(emptyTimeline, testOptions)).toThrow(
      'Cannot generate DRP from empty timeline'
    );
  });
});

// ============================================================================
// generateDrp Tests
// ============================================================================

describe('generateDrp', () => {
  it('generates valid newline-delimited JSON', () => {
    const timeline = createTestTimeline();
    const drp = generateDrp(timeline, testOptions);

    const lines = drp.trim().split('\n');

    // Should have header + events
    expect(lines.length).toBeGreaterThanOrEqual(1);

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('generates output with trailing newline', () => {
    const timeline = createTestTimeline();
    const drp = generateDrp(timeline, testOptions);

    expect(drp.endsWith('\n')).toBe(true);
  });

  it('generates parseable output', () => {
    const timeline = createTestTimeline();
    const drp = generateDrp(timeline, testOptions);
    const parsed = parseDrp(drp);

    expect(parsed.header.version).toBe(1);
    expect(parsed.header.videoMode).toBe('1080p25');
    expect(parsed.events.length).toBe(2);
  });
});

// ============================================================================
// parseDrp Tests
// ============================================================================

describe('parseDrp', () => {
  it('parses generated DRP correctly', () => {
    const timeline = createTestTimeline();
    const drp = generateDrp(timeline, testOptions);
    const doc = parseDrp(drp);

    expect(doc.header.version).toBe(1);
    expect(doc.header.sources.length).toBe(2);
    expect(doc.events.length).toBe(2);
  });

  it('throws on empty content', () => {
    expect(() => parseDrp('')).toThrow('Empty DRP file');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDrp('not json')).toThrow('Failed to parse DRP header');
  });
});

// ============================================================================
// validateDrp Tests
// ============================================================================

describe('validateDrp', () => {
  it('returns empty array for valid document', () => {
    const timeline = createTestTimeline();
    const doc = buildDrpDocument(timeline, testOptions);
    const errors = validateDrp(doc);

    expect(errors).toEqual([]);
  });

  it('catches invalid version', () => {
    const doc: DrpDocument = {
      header: {
        version: 99,
        masterTimecode: '01:00:00:00',
        videoMode: '1080p25',
        recordingId: 'test',
        sources: [
          {
            name: 'Test',
            type: 'Video',
            volume: 'Vol',
            projectPath: '/',
            file: 'test.mov',
            startTimecode: '01:00:00:00',
            _index_: 0,
          },
        ],
        mixEffectBlocks: [{ source: 0, _index_: 0 }],
      },
      events: [],
    };

    const errors = validateDrp(doc);
    expect(errors.some((e) => e.includes('Invalid version'))).toBe(true);
  });

  it('catches missing sources', () => {
    const doc: DrpDocument = {
      header: {
        version: 1,
        masterTimecode: '01:00:00:00',
        videoMode: '1080p25',
        recordingId: 'test',
        sources: [],
        mixEffectBlocks: [{ source: 0, _index_: 0 }],
      },
      events: [],
    };

    const errors = validateDrp(doc);
    expect(errors.some((e) => e.includes('No sources'))).toBe(true);
  });

  it('catches invalid source references', () => {
    const doc: DrpDocument = {
      header: {
        version: 1,
        masterTimecode: '01:00:00:00',
        videoMode: '1080p25',
        recordingId: 'test',
        sources: [
          {
            name: 'Test',
            type: 'Video',
            volume: 'Vol',
            projectPath: '/',
            file: 'test.mov',
            startTimecode: '01:00:00:00',
            _index_: 0,
          },
        ],
        mixEffectBlocks: [{ source: 99, _index_: 0 }], // Invalid reference
      },
      events: [],
    };

    const errors = validateDrp(doc);
    expect(errors.some((e) => e.includes('invalid source index'))).toBe(true);
  });

  it('catches invalid timecode format', () => {
    const doc: DrpDocument = {
      header: {
        version: 1,
        masterTimecode: 'invalid',
        videoMode: '1080p25',
        recordingId: 'test',
        sources: [
          {
            name: 'Test',
            type: 'Video',
            volume: 'Vol',
            projectPath: '/',
            file: 'test.mov',
            startTimecode: '01:00:00:00',
            _index_: 0,
          },
        ],
        mixEffectBlocks: [{ source: 0, _index_: 0 }],
      },
      events: [],
    };

    const errors = validateDrp(doc);
    expect(errors.some((e) => e.includes('Invalid master timecode'))).toBe(true);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('DRP round-trip', () => {
  it('preserves data through generate/parse cycle', () => {
    const timeline = createTestTimeline();
    const originalDoc = buildDrpDocument(timeline, testOptions);
    const drp = generateDrp(timeline, testOptions);
    const parsedDoc = parseDrp(drp);

    // Compare header
    expect(parsedDoc.header.version).toBe(originalDoc.header.version);
    expect(parsedDoc.header.videoMode).toBe(originalDoc.header.videoMode);
    expect(parsedDoc.header.masterTimecode).toBe(originalDoc.header.masterTimecode);
    expect(parsedDoc.header.sources.length).toBe(originalDoc.header.sources.length);

    // Compare events
    expect(parsedDoc.events.length).toBe(originalDoc.events.length);
    for (let i = 0; i < parsedDoc.events.length; i++) {
      expect(parsedDoc.events[i]?.masterTimecode).toBe(
        originalDoc.events[i]?.masterTimecode
      );
    }
  });
});
