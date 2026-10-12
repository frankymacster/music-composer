import type { Scale } from './scale';
import { scaleStep } from './transforms';

/** Semitones above the root for each chord quality suffix. */
const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '-': [0, 3, 7],
  dim: [0, 3, 6],
  '°': [0, 3, 6],
  o: [0, 3, 6],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  '-7': [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  ø: [0, 3, 6, 10],
  ø7: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '°7': [0, 3, 6, 9],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
};

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROMAN: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

export interface Chord {
  symbol: string;
  /** Pitch class of the root. */
  root: number;
  intervals: number[];
  /** Pitch class of a slash bass. */
  bass?: number;
}

const pc = (letter: string, acc: string) => (LETTERS[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;

/** Parses `Am7`, `F#dim`, `C/E`, or a Roman numeral (`vi`, `IV7`, `bVII`, `ii°`) relative to `key`'s root. */
export function parseChord(symbol: string, key?: Scale): Chord {
  const letter = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(symbol);
  if (letter) {
    const [, l, acc, quality, bl, bacc] = letter;
    const intervals = QUALITIES[quality];
    if (!intervals) throw new Error(`Unknown chord quality "${quality}" in ${symbol}`);
    return { symbol, root: pc(l, acc), intervals, bass: bl ? pc(bl, bacc) : undefined };
  }
  const roman = /^([#b]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(symbol);
  if (roman) {
    const [, acc, numeral, suffix] = roman;
    const minor = numeral === numeral.toLowerCase();
    const degree = ROMAN[numeral.toUpperCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
    let quality = suffix;
    if (minor && !/^(°|o|ø|dim|m)/.test(suffix)) quality = suffix === '7' ? 'm7' : `m${suffix}`;
    if (minor && quality === 'm°') quality = '°';
    const intervals = QUALITIES[quality];
    if (!intervals) throw new Error(`Unknown chord quality "${suffix}" in ${symbol}`);
    return { symbol, root: (((key?.root ?? 0) + degree) % 12 + 12) % 12, intervals };
  }
  throw new Error(`Can't read chord "${symbol}"`);
}

export function parseProgression(text: string, key?: Scale): Chord[] {
  return text
    .split(/[\s|,]+/)
    .filter(Boolean)
    .map((sym) => parseChord(sym, key));
}

/** All close-position voicings of the chord's pitch classes with the lowest note in [low, high]. */
function voicings(chord: Chord, low: number, high: number): number[][] {
  const pcs = [...new Set(chord.intervals.map((i) => (chord.root + i) % 12))];
  const out: number[][] = [];
  for (let r = 0; r < pcs.length; r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let base = low; base <= high; base++) {
      if (base % 12 !== order[0]) continue;
      const v = [base];
      for (const p of order.slice(1)) {
        let next = v[v.length - 1] + 1;
        while (next % 12 !== p) next++;
        v.push(next);
      }
      out.push(v);
    }
  }
  return out;
}

const distance = (a: number[], b: number[]) => {
  const n = Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs((a[Math.min(i, a.length - 1)] ?? 0) - (b[Math.min(i, b.length - 1)] ?? 0));
  return d;
};

/** Voices a progression in close position, each chord as near as possible to the previous one. */
export function voiceLead(chords: Chord[], low = 55, high = 67, center = 64): number[][] {
  let prev: number[] | undefined;
  return chords.map((chord) => {
    const options = voicings(chord, low, high);
    const cost = (v: number[]) =>
      prev ? distance(v, prev) : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
    const best = options.sort((a, b) => cost(a) - cost(b))[0] ?? [];
    prev = best;
    return best;
  });
}

/** Bass note for a chord (slash bass or root) in the octave starting at `low`. */
export const bassNote = (chord: Chord, low = 36) => low + ((((chord.bass ?? chord.root) - low) % 12) + 12) % 12;

export type ChordStamp = 'off' | 'triad' | 'seventh' | 'sus4';

/** Chord built on `pitch`: stacked scale thirds when a scale is set, otherwise a major chord. */
export function stampChord(pitch: number, type: ChordStamp, scale: Scale | undefined): number[] {
  if (type === 'off') return [pitch];
  if (scale) {
    const degrees = type === 'triad' ? [0, 2, 4] : type === 'seventh' ? [0, 2, 4, 6] : [0, 3, 4];
    return degrees.map((d) => scaleStep(pitch, d, scale));
  }
  const intervals = type === 'triad' ? [0, 4, 7] : type === 'seventh' ? [0, 4, 7, 10] : [0, 5, 7];
  return intervals.map((i) => pitch + i).filter((p) => p <= 127);
}
