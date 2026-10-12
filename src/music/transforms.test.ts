import { describe, expect, it } from 'vitest';
import { arpeggiate, euclid, humanize, invert, legato, reverse, scaleStep, stretch, strum } from './transforms';
import type { Note } from './codegen';

let i = 0;
const n = (pitch: number, start: number, dur: number): Note => ({ id: `n${i++}`, pitch, start, dur, vel: 0.8 });
const pick = (ns: Note[]) => ns.map(({ pitch, start, dur }) => [pitch, start, dur]);

describe('transforms', () => {
  it('reverse mirrors time within the selection', () => {
    expect(pick(reverse([n(60, 0, 120), n(62, 240, 240)]))).toEqual([[60, 360, 120], [62, 0, 240]]);
  });
  it('invert mirrors pitch within the range', () => {
    expect(pick(invert([n(60, 0, 1), n(64, 1, 1), n(67, 2, 1)])).map((x) => x[0])).toEqual([67, 63, 60]);
  });
  it('stretch doubles or halves around the first note', () => {
    expect(pick(stretch([n(60, 480, 240), n(62, 960, 240)], 0.5))).toEqual([[60, 480, 120], [62, 720, 120]]);
  });
  it('legato fills gaps up to the next onset', () => {
    expect(pick(legato([n(60, 0, 60), n(64, 0, 60), n(67, 480, 60)]))).toEqual([[60, 0, 480], [64, 0, 480], [67, 480, 60]]);
  });
  it('strum spreads chords upward', () => {
    expect(pick(strum([n(64, 0, 480), n(60, 0, 480)], 30))).toEqual([[64, 30, 450], [60, 0, 480]]);
  });
  it('humanize stays within bounds', () => {
    const out = humanize([n(60, 0, 120)], 10, 0.1, () => 1 - 1e-9);
    expect(out[0].start).toBe(10);
    expect(out[0].vel).toBe(0.9);
  });
  it('arpeggiates chords at a rate', () => {
    let k = 0;
    const out = arpeggiate([n(60, 0, 480), n(64, 0, 480), n(67, 0, 480)], 120, 'updown', () => `a${k++}`);
    expect(out.map((x) => x.pitch)).toEqual([60, 64, 67, 64]);
    expect(out.map((x) => x.start)).toEqual([0, 120, 240, 360]);
  });
  it('euclid matches the classic patterns', () => {
    const str = (b: boolean[]) => b.map((x) => (x ? 'x' : '.')).join('');
    expect(str(euclid(3, 8))).toBe('x..x..x.');
    expect(str(euclid(5, 8))).toBe('x.xx.xx.');
    expect(str(euclid(3, 8, 1))).toBe('..x..x.x');
  });
  it('steps through the scale', () => {
    const cMajor = { root: 0, mode: 'major' };
    expect(scaleStep(60, 1, cMajor)).toBe(62);
    expect(scaleStep(64, 1, cMajor)).toBe(65);
    expect(scaleStep(60, -1, cMajor)).toBe(59);
    expect(scaleStep(60, 1, undefined)).toBe(61);
  });
});
