import { describe, expect, it } from 'vitest';
import { bassNote, parseChord, parseProgression, stampChord, voiceLead } from './chords';

const pcs = (c: { root: number; intervals: number[] }) => c.intervals.map((i) => (c.root + i) % 12);

describe('chords', () => {
  it('parses letter chords', () => {
    expect(pcs(parseChord('Am'))).toEqual([9, 0, 4]);
    expect(pcs(parseChord('F#dim'))).toEqual([6, 9, 0]);
    expect(pcs(parseChord('Bbmaj7'))).toEqual([10, 2, 5, 9]);
    expect(parseChord('C/E').bass).toBe(4);
  });

  it('parses roman numerals in a key', () => {
    const g = { root: 7, mode: 'major' };
    expect(pcs(parseChord('I', g))).toEqual([7, 11, 2]);
    expect(pcs(parseChord('vi', g))).toEqual([4, 7, 11]);
    expect(pcs(parseChord('V7', g))).toEqual([2, 6, 9, 0]);
    expect(pcs(parseChord('ii7', g))).toEqual([9, 0, 4, 7]);
    expect(pcs(parseChord('vii°', g))).toEqual([6, 9, 0]);
    expect(pcs(parseChord('bVII', g))).toEqual([5, 9, 0]);
  });

  it('rejects unknown chords', () => {
    expect(() => parseChord('Hm')).toThrow();
    expect(() => parseChord('Cxyz')).toThrow();
  });

  it('voice-leads with small moves', () => {
    const voiced = voiceLead(parseProgression('C G Am F'));
    for (let i = 1; i < voiced.length; i++) {
      const move = voiced[i].reduce((sum, p, j) => sum + Math.abs(p - voiced[i - 1][j]), 0);
      expect(move).toBeLessThanOrEqual(5);
    }
    voiced.forEach((v) => v.forEach((p) => expect(p).toBeGreaterThanOrEqual(55)));
  });

  it('bass notes stay in the low octave', () => {
    expect(bassNote(parseChord('Am'))).toBe(45);
    expect(bassNote(parseChord('C/E'))).toBe(40);
  });

  it('stamps diatonic chords in a scale', () => {
    const a = { root: 9, mode: 'minor' };
    expect(stampChord(57, 'triad', a)).toEqual([57, 60, 64]);
    expect(stampChord(59, 'triad', a)).toEqual([59, 62, 65]);
    expect(stampChord(60, 'triad', undefined)).toEqual([60, 64, 67]);
  });
});
