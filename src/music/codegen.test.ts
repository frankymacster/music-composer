import { beforeAll, describe, expect, it } from 'vitest';
import { baseScope } from '../strudel/scope';
import { compile, detectKind, fitsGrid, hapsToNotes, kitPitch, kitSounds, notePitch } from '../strudel/compile';
import { defaultLanes, type KitLane } from './kit';
import { generateTrackCode, type Note } from './codegen';
import { isGridCode } from './canonical';
import { computeBars, songLength, type Song } from './time';

beforeAll(async () => {
  await baseScope();
});

const strip = (ns: Note[]) =>
  ns.map(({ pitch, start, dur, vel }) => ({ pitch, start, dur, vel })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);

function roundTrip(notes: Note[], song: Song, lanes?: KitLane[]) {
  const bars = computeBars(song);
  const length = songLength(bars);
  const code = generateTrackCode(notes, bars, length, lanes);
  expect(isGridCode(code, lanes ? 'kit' : 'notes')).toBe(true);
  const c = compile(code);
  if (!c.ok) throw new Error(c.error + '\n' + code);
  const pitchOf = lanes ? kitPitch(lanes) : notePitch;
  expect(fitsGrid(c.pattern, length, pitchOf)).toBe(true);
  expect(strip(hapsToNotes(c.pattern, length, pitchOf))).toEqual(strip(notes));
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

  it('collapses runs of empty bars into one rest', () => {
    const code = roundTrip([n(60, 240, 480), n(62, 7 * 1920 + 960, 480)], { bpm: 120, bars: 8, meters: [{ bar: 0, num: 4, den: 4 }] });
    expect(code).toBe('note(`~ c4@2 ~@5\n      ~@48\n      ~@4 d4@2 ~@2`).velocity(0.8).slow(8)');
  });

  it('empty track', () => {
    expect(generateTrackCode([], computeBars({ bpm: 120, bars: 1, meters: [{ bar: 0, num: 4, den: 4 }] }), 1920)).toBe('silence');
  });
});

describe('kit', () => {
  const song: Song = { bpm: 120, bars: 2, meters: [{ bar: 0, num: 4, den: 4 }, { bar: 1, num: 6, den: 8 }] };
  let lid = 0;
  const lanes = defaultLanes(() => `l${lid++}`);

  it('one s() line per lane, kick first, round-trips', () => {
    const code = roundTrip(
      [n(36, 0, 120, 1), n(36, 960, 120), n(38, 480, 120), n(42, 0, 120, 0.5), n(42, 240, 120, 0.7), n(42, 1920, 120), n(49, 1920 + 720, 240)],
      song,
      lanes,
    );
    expect(code).toMatch(/^stack\(\n  s\(`bd/);
    expect(code.match(/s\(`/g)).toHaveLength(4);
  });

  it('per-lane banks, sample indexes and custom notes', () => {
    const custom: KitLane[] = [
      { id: 'a', name: 'Arp', sample: 'arpy:3', bank: '', note: 60 },
      { id: 'b', name: '', sample: 'bd', bank: 'RolandTR909', note: 36 },
      { id: 'c', name: '', sample: 'bd', bank: 'RolandTR808', note: 35 },
    ];
    const code = roundTrip([n(60, 0, 240), n(36, 480, 120), n(35, 960, 120)], { bpm: 120, bars: 1, meters: [{ bar: 0, num: 4, den: 4 }] }, custom);
    expect(code).toContain('.bank("RolandTR808")');
    expect(code).toContain('s(`arpy:3');
  });

  it('lists the sounds a pattern hits, for adding lanes', () => {
    const c = compile('s("bd arpy:3 ~ bd").bank("<RolandTR909 x>")');
    if (!c.ok) throw new Error(c.error);
    expect(kitSounds(c.pattern, 1920)).toEqual([
      { s: 'bd', bank: 'RolandTR909' },
      { s: 'arpy', n: 3, bank: 'RolandTR909' },
    ]);
  });

  it('code with sounds outside the kit does not fit', () => {
    const c = compile('s("bd arpy")');
    if (!c.ok) throw new Error(c.error);
    expect(fitsGrid(c.pattern, 1920, kitPitch(lanes))).toBe(false);
  });

  it('detects sample patterns for baking', () => {
    const c = compile('s("bd*4, [~ sd]*2, hh*8")');
    if (!c.ok) throw new Error(c.error);
    expect(detectKind(c.pattern, 1920)).toBe('kit');
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

  it.each([
    ['stack(s(`bd ~ bd ~`), s("~ sd").velocity(0.8)).slow(2)', true],
    ['s("bd*4")', true],
    ['s("arpy:3 RolandTR808_bd")', true],
    ['s("bd sd").bank("RolandTR909").velocity(0.5)', true],
    ['note("c4")', false],
    ['s("bd sd").fast(2)', false],
    ['s("<bd sd>")', false],
  ])('kit: %s → %s', (code, expected) => {
    expect(isGridCode(code, 'kit')).toBe(expected);
  });
});
