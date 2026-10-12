import { beforeAll, describe, expect, it } from 'vitest';
import { baseScope } from '../strudel/scope';
import { compile, hapsToNotes } from '../strudel/compile';
import { generateTrackCode, type Note } from './codegen';
import { isGridCode } from './canonical';
import { computeBars, songLength, type Song } from './time';

beforeAll(async () => {
  await baseScope();
});

const strip = (ns: Note[]) =>
  ns.map(({ pitch, start, dur, vel }) => ({ pitch, start, dur, vel })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);

function roundTrip(notes: Note[], song: Song) {
  const bars = computeBars(song);
  const length = songLength(bars);
  const code = generateTrackCode(notes, bars, length);
  expect(isGridCode(code)).toBe(true);
  const c = compile(code);
  if (!c.ok) throw new Error(c.error + '\n' + code);
  expect(strip(hapsToNotes(c.pattern, length))).toEqual(strip(notes));
  return code;
}

let id = 0;
const n = (pitch: number, start: number, dur: number, vel = 0.8): Note => ({ id: String(id++), pitch, start, dur, vel });

describe('codegen round-trip', () => {
  it('simple 4/4 melody', () => {
    const code = roundTrip([n(60, 0, 480), n(64, 480, 480), n(67, 960, 960)], { bpm: 120, bars: 2, meters: [{ bar: 0, num: 4, den: 4 }] });
    expect(code).toContain('.slow(2)');
  });

  it('chords, overlaps and velocities', () => {
    roundTrip(
      [n(60, 0, 960, 0.5), n(64, 0, 960, 0.5), n(67, 0, 960, 0.5), n(72, 240, 1680, 1), n(48, 120, 120, 0.9)],
      { bpm: 120, bars: 1, meters: [{ bar: 0, num: 4, den: 4 }] },
    );
  });

  it('meter changes and notes crossing bar lines', () => {
    const song: Song = { bpm: 100, bars: 4, meters: [{ bar: 0, num: 4, den: 4 }, { bar: 1, num: 7, den: 8 }, { bar: 3, num: 3, den: 4 }] };
    roundTrip([n(62, 1440, 960), n(65, 1920 + 240 * 6, 240), n(70, 1920 + 1680 + 1680, 480 * 3)], song);
  });

  it('triplets and sharps', () => {
    roundTrip([n(61, 0, 160), n(66, 160, 160), n(70, 320, 160), n(25, 1600, 160)], { bpm: 120, bars: 1, meters: [{ bar: 0, num: 4, den: 4 }] });
  });

  it('empty track', () => {
    expect(generateTrackCode([], computeBars({ bpm: 120, bars: 1, meters: [{ bar: 0, num: 4, den: 4 }] }), 1920)).toBe('silence');
  });
});

describe('isGridCode', () => {
  it.each([
    ['note("c4 e4 g4")', true],
    ['note(`c4@2 ~ [e4,g4]`).velocity(0.5).slow(2)', true],
    ['stack(note("c4"), note("e4").velocity("0.5 1"),).slow(4)', true],
    ['note("c4 e4").fast(2)', false],
    ['note("<c4 e4>")', false],
    ['note("c4?")', false],
    ['s("bd sd")', false],
  ])('%s → %s', (code, expected) => {
    expect(isGridCode(code)).toBe(expected);
  });
});
