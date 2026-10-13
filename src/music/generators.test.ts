import { describe, expect, it } from 'vitest';
import { chordSpans, generate, GENERATORS, type GeneratorSpec, type GenContext } from './generators';
import { computeBars, songLength, TPW } from './time';
import { defaultLanes } from './kit';
import { inScale } from './scale';

let k = 0;
const id = () => `g${k++}`;
const bars = computeBars({ bars: 4, meters: [{ bar: 0, num: 4, den: 4 }] });
const length = songLength(bars);
const chords = chordSpans(
  ['Am', 'F', 'C', 'G'].map((symbol, i) => ({ id: symbol, symbol, start: i * TPW, dur: TPW })),
  { root: 9, mode: 'minor' },
  length,
);
const ctx: GenContext = { bars, length, chords, scale: { root: 9, mode: 'minor' }, lanes: defaultLanes(id) };
const spec = (type: GeneratorSpec['type'], style: string, seed = 1, extra: Partial<GeneratorSpec> = {}): GeneratorSpec => ({ type, style, seed, ...extra });
const pick = (ns: { pitch: number; start: number }[]) => ns.map((n) => [n.pitch, n.start]);

describe('generators', () => {
  it('root bass follows the chords', () => {
    const notes = generate(spec('bass', 'root'), ctx, id);
    expect(notes.map((n) => n.pitch % 12)).toEqual([9, 5, 0, 7]);
    expect(notes.every((n) => n.pitch >= 28 && n.pitch <= 52)).toBe(true);
  });

  it('every style generates notes inside the section', () => {
    for (const [type, def] of Object.entries(GENERATORS)) {
      for (const [style] of def.styles) {
        const notes = generate(spec(type as GeneratorSpec['type'], style, 7, { fill: true, crash: true }), ctx, id);
        expect(notes.length, `${type}/${style}`).toBeGreaterThan(0);
        expect(notes.every((n) => n.start >= 0 && n.start + n.dur <= length + 1)).toBe(true);
      }
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = pick(generate(spec('bass', 'groove', 42), ctx, id));
    const b = pick(generate(spec('bass', 'groove', 42), ctx, id));
    const c = pick(generate(spec('bass', 'groove', 43), ctx, id));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('melody stays in the scale', () => {
    const notes = generate(spec('melody', 'phrase', 3), ctx, id);
    expect(notes.every((n) => inScale(ctx.scale, n.pitch))).toBe(true);
  });

  it('house drums put the kick on every beat', () => {
    const kicks = generate(spec('drums', 'house', 5), ctx, id).filter((n) => n.pitch === 36 && n.vel >= 0.85);
    expect(kicks.map((n) => n.start)).toEqual(Array.from({ length: 16 }, (_, i) => i * (TPW / 4)));
  });

  it('pads are voice-led chords spanning each chord', () => {
    const notes = generate(spec('pad', 'sustain'), ctx, id);
    expect(new Set(notes.map((n) => n.start))).toEqual(new Set([0, TPW, 2 * TPW, 3 * TPW]));
  });
});
