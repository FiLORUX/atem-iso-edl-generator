/**
 * Timecode utility tests.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTimecode,
  formatTimecode,
  timecodeToFrames,
  framesToTimecode,
  addTimecodes,
  subtractTimecodes,
  validateTimecode,
} from '../src/core/timecode/timecode.js';

describe('parseTimecode', () => {
  it('parses non-drop-frame timecode', () => {
    const tc = parseTimecode('01:02:03:04');
    expect(tc).toEqual({ hours: 1, minutes: 2, seconds: 3, frames: 4 });
  });

  it('parses drop-frame timecode', () => {
    const tc = parseTimecode('01:02:03;04');
    expect(tc).toEqual({ hours: 1, minutes: 2, seconds: 3, frames: 4 });
  });

  it('throws on invalid format', () => {
    expect(() => parseTimecode('invalid')).toThrow();
    expect(() => parseTimecode('1:2:3:4')).toThrow();
    expect(() => parseTimecode('01:02:03')).toThrow();
  });
});

describe('formatTimecode', () => {
  it('formats non-drop-frame timecode', () => {
    const result = formatTimecode({ hours: 1, minutes: 2, seconds: 3, frames: 4 }, false);
    expect(result).toBe('01:02:03:04');
  });

  it('formats drop-frame timecode', () => {
    const result = formatTimecode({ hours: 1, minutes: 2, seconds: 3, frames: 4 }, true);
    expect(result).toBe('01:02:03;04');
  });

  it('pads single digits', () => {
    const result = formatTimecode({ hours: 0, minutes: 0, seconds: 0, frames: 0 }, false);
    expect(result).toBe('00:00:00:00');
  });
});

describe('timecodeToFrames (25fps)', () => {
  const options = { frameRate: 25, dropFrame: false };

  it('converts 00:00:00:00 to 0 frames', () => {
    expect(timecodeToFrames({ hours: 0, minutes: 0, seconds: 0, frames: 0 }, options)).toBe(0);
  });

  it('converts 00:00:01:00 to 25 frames', () => {
    expect(timecodeToFrames({ hours: 0, minutes: 0, seconds: 1, frames: 0 }, options)).toBe(25);
  });

  it('converts 00:01:00:00 to 1500 frames', () => {
    expect(timecodeToFrames({ hours: 0, minutes: 1, seconds: 0, frames: 0 }, options)).toBe(1500);
  });

  it('converts 01:00:00:00 to 90000 frames', () => {
    expect(timecodeToFrames({ hours: 1, minutes: 0, seconds: 0, frames: 0 }, options)).toBe(90000);
  });
});

describe('framesToTimecode (25fps)', () => {
  const options = { frameRate: 25, dropFrame: false };

  it('converts 0 frames to 00:00:00:00', () => {
    expect(framesToTimecode(0, options)).toEqual({ hours: 0, minutes: 0, seconds: 0, frames: 0 });
  });

  it('converts 25 frames to 00:00:01:00', () => {
    expect(framesToTimecode(25, options)).toEqual({ hours: 0, minutes: 0, seconds: 1, frames: 0 });
  });

  it('converts 1500 frames to 00:01:00:00', () => {
    expect(framesToTimecode(1500, options)).toEqual({ hours: 0, minutes: 1, seconds: 0, frames: 0 });
  });
});

describe('addTimecodes', () => {
  const options = { frameRate: 25, dropFrame: false };

  it('adds two timecodes', () => {
    const a = { hours: 0, minutes: 0, seconds: 1, frames: 0 };
    const b = { hours: 0, minutes: 0, seconds: 2, frames: 12 };
    const result = addTimecodes(a, b, options);
    expect(result).toEqual({ hours: 0, minutes: 0, seconds: 3, frames: 12 });
  });

  it('handles carry correctly', () => {
    const a = { hours: 0, minutes: 59, seconds: 59, frames: 24 };
    const b = { hours: 0, minutes: 0, seconds: 0, frames: 1 };
    const result = addTimecodes(a, b, options);
    expect(result).toEqual({ hours: 1, minutes: 0, seconds: 0, frames: 0 });
  });
});

describe('subtractTimecodes', () => {
  const options = { frameRate: 25, dropFrame: false };

  it('subtracts two timecodes', () => {
    const a = { hours: 0, minutes: 0, seconds: 5, frames: 0 };
    const b = { hours: 0, minutes: 0, seconds: 2, frames: 0 };
    const result = subtractTimecodes(a, b, options);
    expect(result).toEqual({ hours: 0, minutes: 0, seconds: 3, frames: 0 });
  });

  it('throws on negative result', () => {
    const a = { hours: 0, minutes: 0, seconds: 1, frames: 0 };
    const b = { hours: 0, minutes: 0, seconds: 2, frames: 0 };
    expect(() => subtractTimecodes(a, b, options)).toThrow();
  });
});

describe('validateTimecode', () => {
  const options25 = { frameRate: 25, dropFrame: false };
  const options30df = { frameRate: 29.97, dropFrame: true };

  it('returns empty array for valid timecode', () => {
    const tc = { hours: 12, minutes: 30, seconds: 45, frames: 20 };
    expect(validateTimecode(tc, options25)).toEqual([]);
  });

  it('catches invalid hours', () => {
    const tc = { hours: 25, minutes: 0, seconds: 0, frames: 0 };
    const errors = validateTimecode(tc, options25);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Hours');
  });

  it('catches invalid frames for frame rate', () => {
    const tc = { hours: 0, minutes: 0, seconds: 0, frames: 30 };
    const errors = validateTimecode(tc, options25);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Frames');
  });

  it('catches invalid drop-frame timecode', () => {
    // Frame 0 at second 0, minute 1 is invalid for drop-frame
    const tc = { hours: 0, minutes: 1, seconds: 0, frames: 0 };
    const errors = validateTimecode(tc, options30df);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Drop-frame');
  });
});
