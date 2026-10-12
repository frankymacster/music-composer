import { noteToMidi, freqToMidi } from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { TPW } from '../music/time';
import type { Note } from '../music/codegen';
import { drumByName, type TrackKind } from '../music/drums';

export type Pattern = any;

export type Compiled =
  | { ok: true; pattern: Pattern; locations: [number, number][] }
  | { ok: false; error: string };

export function compile(code: string): Compiled {
  try {
    const { output, miniLocations } = transpiler(code, { addReturn: true, emitWidgets: false });
    const pattern = new Function(`"use strict";${output}`)();
    if (!pattern || typeof pattern.queryArc !== 'function') {
      return { ok: false, error: 'Code must evaluate to a pattern' };
    }
    return { ok: true, pattern, locations: miniLocations ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function drumPitch(value: any): number | undefined {
  if (typeof value !== 'object' || value === null || typeof value.s !== 'string') return undefined;
  return drumByName.get(value.s)?.gm;
}

function hapPitch(value: any): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { note, n, freq } = value;
  if (typeof note === 'number') return Math.round(note);
  if (typeof note === 'string') return noteToMidi(note);
  if (typeof freq === 'number') return Math.round(freqToMidi(freq));
  if (typeof n === 'number' && value.s === undefined) return Math.round(n);
  return undefined;
}

export function onsetHaps(pattern: Pattern, length: number): any[] {
  return pattern.queryArc(0, length / TPW).filter((h: any) => h.hasOnset());
}

/** Guess whether a pattern is mostly drum hits or pitched notes. */
export function detectKind(pattern: Pattern, length: number): TrackKind {
  let drums = 0;
  let notes = 0;
  for (const hap of onsetHaps(pattern, length)) {
    if (hapPitch(hap.value) !== undefined) notes++;
    else if (drumPitch(hap.value) !== undefined) drums++;
  }
  return drums > notes ? 'drums' : 'notes';
}

/** True when every onset can be represented on the given kind of grid. */
export function fitsGrid(pattern: Pattern, length: number, kind: TrackKind): boolean {
  const pitchOf = kind === 'drums' ? drumPitch : hapPitch;
  return onsetHaps(pattern, length).every((h) => pitchOf(h.value) !== undefined);
}

export function hapsToNotes(pattern: Pattern, length: number, kind: TrackKind = 'notes'): Note[] {
  const pitchOf = kind === 'drums' ? drumPitch : hapPitch;
  const notes: Note[] = [];
  let i = 0;
  for (const hap of onsetHaps(pattern, length)) {
    const pitch = pitchOf(hap.value);
    if (pitch === undefined || pitch < 0 || pitch > 127) continue;
    const start = Math.round(hap.whole.begin.valueOf() * TPW);
    const end = Math.round(hap.whole.end.valueOf() * TPW);
    const vel = typeof hap.value.velocity === 'number' ? hap.value.velocity : 1;
    notes.push({ id: `h${i++}`, pitch, start, dur: Math.max(1, end - start), vel });
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
