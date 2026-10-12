import { noteToMidi, freqToMidi } from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { TPW } from '../music/time';
import type { Note } from '../music/codegen';

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

function hapPitch(value: any): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { note, n, freq } = value;
  if (typeof note === 'number') return Math.round(note);
  if (typeof note === 'string') return noteToMidi(note);
  if (typeof freq === 'number') return Math.round(freqToMidi(freq));
  if (typeof n === 'number' && value.s === undefined) return Math.round(n);
  return undefined;
}

export function hapsToNotes(pattern: Pattern, length: number): Note[] {
  const notes: Note[] = [];
  const haps = pattern.queryArc(0, length / TPW);
  let i = 0;
  for (const hap of haps) {
    if (!hap.hasOnset()) continue;
    const pitch = hapPitch(hap.value);
    if (pitch === undefined || pitch < 0 || pitch > 127) continue;
    const start = Math.round(hap.whole.begin.valueOf() * TPW);
    const end = Math.round(hap.whole.end.valueOf() * TPW);
    const vel = typeof hap.value.velocity === 'number' ? hap.value.velocity : 1;
    notes.push({ id: `h${i++}`, pitch, start, dur: Math.max(1, end - start), vel });
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
