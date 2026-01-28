/**
 * EDL generator tests.
 */

import { describe, it, expect } from 'vitest';
import {
  generateEdl,
  buildEdlEvents,
  validateEdl,
  type EdlDocument,
  type GeneratorOptions,
} from '../src/generators/edl/cmx3600.js';
import type { ProgramChangeEvent } from '../src/core/events/types.js';

describe('generateEdl', () => {
  it('generates valid EDL with title', () => {
    const doc: EdlDocument = {
      title: 'TEST_PRODUCTION',
      frameRate: 25,
      dropFrame: false,
      events: [],
    };

    const edl = generateEdl(doc);
    expect(edl).toContain('TITLE: TEST_PRODUCTION');
    expect(edl).toContain('FCM: NON-DROP FRAME');
  });

  it('generates drop-frame FCM line', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 29.97,
      dropFrame: true,
      events: [],
    };

    const edl = generateEdl(doc);
    expect(edl).toContain('FCM: DROP FRAME');
  });

  it('formats cut event correctly', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      events: [
        {
          eventNumber: 1,
          reelName: 'CAM1',
          track: 'V',
          transition: 'C',
          transitionFrames: 0,
          sourceIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
          sourceOut: { hours: 1, minutes: 0, seconds: 5, frames: 0 },
          recordIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
          recordOut: { hours: 1, minutes: 0, seconds: 5, frames: 0 },
          comments: [],
        },
      ],
    };

    const edl = generateEdl(doc);
    expect(edl).toContain('001');
    expect(edl).toContain('CAM1');
    expect(edl).toContain('C   ');
    expect(edl).toContain('01:00:00:00');
    expect(edl).toContain('01:00:05:00');
  });

  it('formats dissolve event with duplicate line', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      events: [
        {
          eventNumber: 1,
          reelName: 'CAM1',
          track: 'V',
          transition: 'D',
          transitionFrames: 25,
          sourceIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
          sourceOut: { hours: 1, minutes: 0, seconds: 5, frames: 0 },
          recordIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
          recordOut: { hours: 1, minutes: 0, seconds: 5, frames: 0 },
          comments: [],
        },
      ],
    };

    const edl = generateEdl(doc);
    // Dissolves should have duplicate lines
    const lines = edl.split('\n').filter((l) => l.startsWith('001'));
    expect(lines.length).toBe(2);
    expect(edl).toContain('D    025');
  });

  it('includes comment lines', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      events: [
        {
          eventNumber: 1,
          reelName: 'CAM1',
          track: 'V',
          transition: 'C',
          transitionFrames: 0,
          sourceIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
          sourceOut: { hours: 1, minutes: 0, seconds: 5, frames: 0 },
          recordIn: { hours: 1, minutes: 0, seconds: 0, frames: 0 },
          recordOut: { hours: 1, minutes: 0, seconds: 5, frames: 0 },
          comments: [
            { key: 'FROM CLIP NAME', value: 'CAM1_A001.MOV' },
            { key: 'SOURCE FILE', value: '/path/to/CAM1_A001.MOV' },
          ],
        },
      ],
    };

    const edl = generateEdl(doc);
    expect(edl).toContain('* FROM CLIP NAME: CAM1_A001.MOV');
    expect(edl).toContain('* SOURCE FILE: /path/to/CAM1_A001.MOV');
  });
});

describe('buildEdlEvents', () => {
  const createProgramChange = (
    inputId: number,
    reelName: string,
    sequence: number
  ): ProgramChangeEvent => ({
    type: 'program_change',
    timestamp: {
      wallClock: new Date(Date.now() + sequence * 5000).toISOString(),
      hrTime: BigInt(sequence * 5_000_000_000),
      sequence,
    },
    mixEffect: 0,
    input: { inputId, name: `Camera ${inputId}`, reelName },
    previousInput: null,
    transitionType: 'cut',
    transitionFrames: 0,
  });

  it('builds events from program changes', () => {
    const changes: ProgramChangeEvent[] = [
      createProgramChange(1, 'CAM1', 0),
      createProgramChange(2, 'CAM2', 1),
      createProgramChange(1, 'CAM1', 2),
    ];

    const options: GeneratorOptions = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      includeComments: true,
    };

    const events = buildEdlEvents(changes, options);
    expect(events.length).toBe(3);
    expect(events[0]?.reelName).toBe('CAM1');
    expect(events[1]?.reelName).toBe('CAM2');
    expect(events[2]?.reelName).toBe('CAM1');
  });

  it('truncates reel names to 8 characters', () => {
    const changes: ProgramChangeEvent[] = [
      createProgramChange(1, 'VERYLONGREELNAME', 0),
    ];

    const options: GeneratorOptions = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      includeComments: false,
    };

    const events = buildEdlEvents(changes, options);
    expect(events[0]?.reelName.length).toBeLessThanOrEqual(8);
  });
});

describe('validateEdl', () => {
  it('returns empty array for valid document', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      events: [
        {
          eventNumber: 1,
          reelName: 'CAM1',
          track: 'V',
          transition: 'C',
          transitionFrames: 0,
          sourceIn: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
          sourceOut: { hours: 0, minutes: 0, seconds: 1, frames: 0 },
          recordIn: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
          recordOut: { hours: 0, minutes: 0, seconds: 1, frames: 0 },
          comments: [],
        },
      ],
    };

    const errors = validateEdl(doc);
    expect(errors).toEqual([]);
  });

  it('catches empty events', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      events: [],
    };

    const errors = validateEdl(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('no events');
  });

  it('catches reel name longer than 8 characters', () => {
    const doc: EdlDocument = {
      title: 'TEST',
      frameRate: 25,
      dropFrame: false,
      events: [
        {
          eventNumber: 1,
          reelName: 'TOOLONGREELNAME',
          track: 'V',
          transition: 'C',
          transitionFrames: 0,
          sourceIn: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
          sourceOut: { hours: 0, minutes: 0, seconds: 1, frames: 0 },
          recordIn: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
          recordOut: { hours: 0, minutes: 0, seconds: 1, frames: 0 },
          comments: [],
        },
      ],
    };

    const errors = validateEdl(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('8 characters');
  });
});
