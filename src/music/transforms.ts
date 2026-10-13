import type { Note } from './codegen';
import { inScale, scaleDistance, snapToScale, type Scale } from './scale';

/** Pure note transforms used by the roll's Transform menu. Each returns the transformed copies of `notes`. */

const span = (notes: Note[]) => {
  const start = Math.min(...notes.map((n) => n.start));
  const end = Math.max(...notes.map((n) => n.start + n.dur));
  return { start, end };
};

export function reverse(notes: Note[]): Note[] {
  if (!notes.length) return notes;
  const { start, end } = span(notes);
  return notes.map((n) => ({ ...n, start: start + end - (n.start + n.dur) }));
}

/** Mirrors pitches around the middle of the selection's range; with a scale, by scale degree so notes stay in key. */
export function invert(notes: Note[], scale?: Scale): Note[] {
  if (!notes.length) return notes;
  const lo = Math.min(...notes.map((n) => n.pitch));
  const hi = Math.max(...notes.map((n) => n.pitch));
  if (!scale) return notes.map((n) => ({ ...n, pitch: hi + lo - n.pitch }));
  return notes.map((n) => ({ ...n, pitch: scaleStep(snapToScale(hi, scale), -scaleDistance(lo, n.pitch, scale), scale) }));
}

/** Scales time around the selection start: 0.5 = double speed, 2 = half speed. */
export function stretch(notes: Note[], factor: number): Note[] {
  if (!notes.length) return notes;
  const { start } = span(notes);
  return notes.map((n) => ({ ...n, start: Math.round(start + (n.start - start) * factor), dur: Math.max(1, Math.round(n.dur * factor)) }));
}

/** Extends each note to the next later start (chords move together); the last onset keeps its length. */
export function legato(notes: Note[]): Note[] {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  return notes.map((n) => {
    const next = starts.find((s) => s > n.start);
    return next === undefined ? n : { ...n, dur: next - n.start };
  });
}

/** Spreads notes that start together, lowest first, by `step` ticks each (keeping their end). */
export function strum(notes: Note[], step: number): Note[] {
  const byStart = new Map<number, Note[]>();
  for (const n of notes) byStart.set(n.start, [...(byStart.get(n.start) ?? []), n]);
  const out = new Map<string, Note>();
  for (const group of byStart.values()) {
    group
      .sort((a, b) => a.pitch - b.pitch)
      .forEach((n, i) => {
        const shift = Math.min(i * step, n.dur - 1);
        out.set(n.id, { ...n, start: n.start + shift, dur: n.dur - shift });
      });
  }
  return notes.map((n) => out.get(n.id)!);
}

/** Small random timing and velocity changes. `rand` returns [0, 1). */
export function humanize(notes: Note[], timing: number, velocity: number, rand: () => number = Math.random): Note[] {
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, n.start + Math.round((rand() * 2 - 1) * timing)),
    vel: Math.round(Math.max(0.05, Math.min(1, n.vel + (rand() * 2 - 1) * velocity)) * 100) / 100,
  }));
}

export type ArpDirection = 'up' | 'down' | 'updown';

/** Replaces each chord (notes starting together) with its notes played one after another every `rate` ticks. */
export function arpeggiate(notes: Note[], rate: number, dir: ArpDirection, makeId: () => string): Note[] {
  const byStart = new Map<number, Note[]>();
  for (const n of notes) byStart.set(n.start, [...(byStart.get(n.start) ?? []), n]);
  const out: Note[] = [];
  for (const [start, chord] of byStart) {
    const up = [...chord].sort((a, b) => a.pitch - b.pitch);
    const order = dir === 'up' ? up : dir === 'down' ? [...up].reverse() : [...up, ...up.slice(1, -1).reverse()];
    const end = Math.max(...chord.map((n) => n.start + n.dur));
    for (let t = start, i = 0; t < end; t += rate, i++) {
      const src = order[i % order.length];
      out.push({ ...src, id: makeId(), start: t, dur: Math.min(rate, end - t) });
    }
  }
  return out;
}

/** Bjorklund: `hits` onsets spread as evenly as possible over `steps`, rotated by `rotate` (same as Strudel's x(k,n)). */
export function euclid(hits: number, steps: number, rotate = 0): boolean[] {
  if (hits <= 0) return Array(steps).fill(false);
  if (hits >= steps) return Array(steps).fill(true);
  let a: number[][] = Array.from({ length: hits }, () => [1]);
  let b: number[][] = Array.from({ length: steps - hits }, () => [0]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = a.slice(0, m).map((x, i) => [...x, ...b[i]]);
    b = rest;
  }
  const pattern = [...a, ...b].flat().map((x) => x === 1);
  const r = ((rotate % steps) + steps) % steps;
  return [...pattern.slice(r), ...pattern.slice(0, r)];
}

/** Moves a pitch by `steps` scale degrees (semitones when there is no scale). */
export function scaleStep(pitch: number, steps: number, scale: Scale | undefined): number {
  if (!scale) return pitch + steps;
  let p = pitch;
  const dir = Math.sign(steps);
  for (let left = Math.abs(steps); left > 0; ) {
    p += dir;
    if (p < 0 || p > 127) return pitch;
    if (inScale(scale, p)) left--;
  }
  return p;
}
