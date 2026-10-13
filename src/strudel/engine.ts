import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as webaudio from '@strudel/webaudio';
import * as midi from '@strudel/midi';
import { registerSoundfonts } from '@strudel/soundfonts';
import { transpiler } from '@strudel/transpiler';
import type { Pattern, PitchOf } from './compile';

let repl: any;
let audioInit: Promise<void> | undefined;

export async function initEngine(): Promise<void> {
  await core.evalScope(core, mini, tonal, webaudio, midi);
  repl = webaudio.webaudioRepl({ transpiler });
  await Promise.all([webaudio.registerSynthSounds(), registerSoundfonts()]);
  loadSamples();
}

async function loadSamples() {
  const load = (src: string) => webaudio.samples(src).catch((e: unknown) => console.warn(`samples ${src}`, e));
  await Promise.all([load('github:tidalcycles/dirt-samples'), load('https://strudel.b-cdn.net/tidal-drum-machines.json')]);
  // loaded last so the standard drum names (bd, sd, hh, …) resolve to this kit
  await load('github:tidalcycles/uzu-drumkit');
}

const ensureAudio = () => (audioInit ??= webaudio.initAudio());

interface Loop {
  start: number;
  len: number;
}

/** What plays from song-raw cycle `from` on: a base pattern looped over `loop`. */
interface Segment {
  from: number;
  base: Pattern;
  loop: Loop;
  shift: number;
  tag?: string;
}

let segs: Segment[] = [{ from: -Infinity, base: core.silence, loop: { start: 0, len: 1 }, shift: 0 }];
let playing = false;
/** Scheduler cycle at which the song starts (count-in length). */
let offset = 0;
let countIn: Pattern | undefined;
let lastRaw = 0;

const mod = (a: number, n: number) => ((a % n) + n) % n;
const last = () => segs[segs.length - 1];
const segAt = (raw: number) => {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].from <= raw) return segs[i];
  return segs[0];
};

function apply() {
  if (!repl) return;
  const raw = heardRaw() ?? -Infinity;
  const current = segs.indexOf(segAt(raw));
  if (current > 0) segs = segs.slice(current);
  const parts = segs.map((g, i) => {
    const lo = Math.max(g.from, 0) + offset;
    const hi = (segs[i + 1]?.from ?? Infinity) + offset;
    const p = g.base.ribbon(g.loop.start, g.loop.len).early(g.shift - offset);
    return p.filterHaps((h: any) => !h.whole || (h.whole.begin.valueOf() >= lo - 1e-9 && h.whole.begin.valueOf() < hi - 1e-9));
  });
  if (offset > 0 && countIn) parts.push(countIn.filterHaps((h: any) => !h.whole || h.whole.begin.valueOf() < offset - 1e-9));
  repl.scheduler.setPattern(parts.length === 1 ? parts[0] : core.stack(...parts), false);
}

/**
 * Song cycles elapsed since the song (not the count-in) started, for what is being heard right now:
 * the inverse of the scheduler's hap → audio-time mapping, minus its latency and the output latency.
 */
function heardRaw(): number | undefined {
  const sch = repl?.scheduler;
  if (!playing || !sch) return undefined;
  if (sch.num_ticks_since_cps_change === 0 || sch.seconds_at_cps_change === undefined) return lastRaw;
  const ctx = webaudio.getAudioContext();
  const outLatency = ctx.outputLatency || ctx.baseLatency || 0;
  const cycle = sch.num_cycles_at_cps_change + (ctx.currentTime - outLatency - sch.seconds_at_cps_change - sch.latency) * sch.cps;
  lastRaw = cycle - offset;
  return lastRaw;
}

/** Song-raw cycles between what is heard and what the scheduler has already queued. */
function lookahead(): number {
  const sch = repl?.scheduler;
  if (!sch) return 0;
  const ctx = webaudio.getAudioContext();
  return (sch.latency + 0.15 + (ctx.outputLatency || ctx.baseLatency || 0)) * sch.cps;
}

const midiPort = (name: string) => (midi.WebMidi.enabled ? midi.WebMidi.outputs.find((o: any) => o.name.includes(name)) : undefined);

export const engine = {
  get playing() {
    return playing;
  },

  /** Replaces what the current (or queued) segment plays. */
  setPattern(pattern: Pattern) {
    last().base = pattern;
    if (playing) apply();
  },

  setCps(cps: number) {
    repl?.scheduler.setCps(cps);
  },

  /** Song cycles heard since the song started (negative during count-in), or undefined when stopped. */
  rawNow: heardRaw,

  /** Loop position (cycles) of a raw time from rawNow(). */
  songPos(raw: number): number {
    const g = segAt(raw);
    return g.loop.start + mod(Math.max(0, raw) + g.shift, g.loop.len);
  },

  tagAt(raw: number): string | undefined {
    return segAt(raw).tag;
  },

  /** Tag of the segment being heard (the playing section in section mode). */
  tag(): string | undefined {
    const raw = heardRaw();
    return raw === undefined ? undefined : segAt(raw).tag;
  },

  countingIn(): boolean {
    const raw = heardRaw();
    return raw !== undefined && raw < 0;
  },

  /** Position (cycles) being heard right now. */
  position(): number {
    const raw = heardRaw();
    return raw === undefined ? last().loop.start : this.songPos(raw);
  },

  get loop(): Loop {
    const raw = heardRaw();
    return (raw === undefined ? last() : segAt(raw)).loop;
  },

  setLoop(next: Loop) {
    const g = last();
    const raw = heardRaw();
    if (raw !== undefined && g.from <= raw) {
      let pos = this.songPos(raw);
      if (pos < next.start || pos >= next.start + next.len) pos = next.start;
      g.shift = mod(pos - next.start - Math.max(0, raw), next.len);
    } else if (raw !== undefined) g.shift = mod(-g.from, next.len);
    g.loop = next;
    if (playing) apply();
  },

  /**
   * Switches to `pattern` looping `loop` (starting at loop.start) at the first boundary from `boundaries`
   * (positions in the current loop, cycles) that hasn't been scheduled yet. With `keep`, the position and loop
   * carry on unchanged (only the music changes). Returns false when stopped.
   */
  switchAt(boundaries: number[], pattern: Pattern, next: Loop, tag?: string, keep = false): boolean {
    const raw = heardRaw();
    if (raw === undefined) return false;
    const r = Math.max(0, raw);
    const g = segAt(r);
    const pos = this.songPos(r);
    const earliest = r + lookahead();
    const ahead = boundaries
      .flatMap((b) => [b, b + g.loop.len])
      .map((b) => r + (b - pos))
      .filter((at) => at >= earliest)
      .sort((a, b) => a - b);
    const at = ahead[0] ?? earliest;
    segs = segs.filter((s) => s.from < at);
    segs.push(keep ? { ...g, from: at, base: pattern } : { from: at, base: pattern, loop: next, shift: mod(-at, next.len), tag });
    apply();
    return true;
  },

  /** Starts playback at `from` (cycles); `count` is an optional count-in of `count.cycles` with its click pattern. */
  async play(from: number, next: Loop, count?: { cycles: number; pattern: Pattern }, tag?: string) {
    if (!repl) return;
    await ensureAudio();
    const pos = from >= next.start && from < next.start + next.len ? from : next.start;
    segs = [{ from: -Infinity, base: last().base, loop: next, shift: pos - next.start, tag }];
    offset = count?.cycles ?? 0;
    countIn = count?.pattern;
    lastRaw = -offset;
    playing = true;
    apply();
    await repl.scheduler.start();
  },

  stop() {
    if (!repl) return;
    repl.scheduler.stop();
    playing = false;
    offset = 0;
    segs = [{ ...last(), from: -Infinity }];
    if (midi.WebMidi.enabled) midi.WebMidi.outputs.forEach((o: any) => o.sendAllNotesOff());
  },

  /** Plays a note immediately. Built-in sounds can't be released early, so they last `duration` seconds. */
  async preview(value: Record<string, unknown>, out: Output, duration = 0.3) {
    if (out.type === 'midi') {
      midiPort(out.port)?.playNote(value.note, { channels: out.channel, duration: duration * 1000, attack: value.velocity ?? 0.8 });
      return;
    }
    await ensureAudio();
    const ctx = webaudio.getAudioContext();
    const sound = out.type === 'synth' ? { s: out.sound } : value.s ? {} : { s: 'triangle' };
    webaudio.superdough({ ...value, ...sound }, ctx.currentTime + 0.01, duration);
  },

  midiNoteOn(out: Output, note: number, velocity: number) {
    if (out.type === 'midi') midiPort(out.port)?.sendNoteOn(note, { channels: out.channel, attack: velocity });
  },

  midiNoteOff(out: Output, note: number) {
    if (out.type === 'midi') midiPort(out.port)?.sendNoteOff(note, { channels: out.channel });
  },
};

export type Output =
  | { type: 'synth'; sound: string }
  | { type: 'kit' }
  | { type: 'midi'; port: string; channel: number }
  | { type: 'code' };

/** `midiNoteOf` maps kit hits to their lane's MIDI note. */
export function applyOutput(pattern: Pattern, out: Output, gain: number, midiNoteOf?: PitchOf): Pattern {
  if (out.type === 'synth') pattern = pattern.s(out.sound);
  if (out.type === 'midi') {
    if (midiNoteOf) pattern = pattern.withValue((v: any) => ({ ...v, note: midiNoteOf(v) ?? v.note }));
    return pattern.midichan(out.channel).midi(out.port);
  }
  return gain === 1 ? pattern : pattern.postgain(gain);
}

export const stack = (...pats: Pattern[]): Pattern => core.stack(...pats);
export const silence: Pattern = core.silence;

export async function enableMidi(): Promise<string[]> {
  await midi.enableWebMidi();
  return midi.WebMidi.outputs.map((o: any) => o.name);
}

type NoteListener = (on: boolean, note: number, velocity: number) => void;
const attachedInputs = new Set<string>();

/** Calls `cb` for note on/off from every MIDI input, including ones connected later. */
export function listenMidiInputs(cb: NoteListener) {
  const attach = () => {
    for (const input of midi.WebMidi.inputs as any[]) {
      if (attachedInputs.has(input.id)) continue;
      attachedInputs.add(input.id);
      input.addListener('noteon', (e: any) => cb(e.note.attack > 0, e.note.number, e.note.attack));
      input.addListener('noteoff', (e: any) => cb(false, e.note.number, 0));
    }
  };
  attach();
  midi.WebMidi.addListener('connected', attach);
}

export const midiInputNames = (): string[] => (midi.WebMidi.enabled ? midi.WebMidi.inputs.map((i: any) => i.name) : []);

export function onMidiChange(cb: (ports: string[]) => void) {
  const handler = () => cb(midi.WebMidi.outputs.map((o: any) => o.name));
  midi.WebMidi.addListener('connected', handler);
  midi.WebMidi.addListener('disconnected', handler);
}

/** Names of every loaded sound (samples, synths, soundfonts). */
export function availableSounds(): string[] {
  return Object.keys(webaudio.soundMap.get()).sort();
}
