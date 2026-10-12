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

let base: Pattern = core.silence;
let loop: Loop = { start: 0, len: 1 };
let shift = 0;
let playing = false;
/** Scheduler cycle at which the song starts (count-in length). */
let offset = 0;
let countIn: Pattern | undefined;
let lastRaw = 0;

const mod = (a: number, n: number) => ((a % n) + n) % n;

function apply() {
  if (!repl) return;
  let song = base.ribbon(loop.start, loop.len).early(shift - offset);
  if (offset > 0) {
    const from = (h: any) => !h.whole || h.whole.begin.valueOf() >= offset - 1e-9;
    song = song.filterHaps(from);
    if (countIn) song = core.stack(countIn.filterHaps((h: any) => !from(h)), song);
  }
  repl.scheduler.setPattern(song, false);
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

const midiPort = (name: string) => (midi.WebMidi.enabled ? midi.WebMidi.outputs.find((o: any) => o.name.includes(name)) : undefined);

export const engine = {
  get playing() {
    return playing;
  },

  setPattern(pattern: Pattern) {
    base = pattern;
    if (playing) apply();
  },

  setCps(cps: number) {
    repl?.scheduler.setCps(cps);
  },

  /** Song cycles heard since the song started (negative during count-in), or undefined when stopped. */
  rawNow: heardRaw,

  /** Song position (cycles) of a raw time from rawNow(). */
  songPos(raw: number): number {
    return loop.start + mod(Math.max(0, raw) + shift, loop.len);
  },

  countingIn(): boolean {
    const raw = heardRaw();
    return raw !== undefined && raw < 0;
  },

  /** Song position (cycles) being heard right now. */
  position(): number {
    const raw = heardRaw();
    return raw === undefined ? loop.start : this.songPos(raw);
  },

  get loop(): Loop {
    return loop;
  },

  setLoop(next: Loop) {
    const raw = heardRaw();
    if (raw !== undefined) {
      let pos = this.songPos(raw);
      if (pos < next.start || pos >= next.start + next.len) pos = next.start;
      shift = mod(pos - next.start - Math.max(0, raw), next.len);
      loop = next;
      apply();
    } else loop = next;
  },

  /** Starts playback at `from` (cycles); `count` is an optional count-in of `count.cycles` with its click pattern. */
  async play(from: number, next: Loop, count?: { cycles: number; pattern: Pattern }) {
    if (!repl) return;
    await ensureAudio();
    loop = next;
    const pos = from >= next.start && from < next.start + next.len ? from : next.start;
    shift = pos - next.start;
    offset = count?.cycles ?? 0;
    countIn = count?.pattern;
    lastRaw = -offset;
    apply();
    await repl.scheduler.start();
    playing = true;
  },

  stop() {
    if (!repl) return;
    repl.scheduler.stop();
    playing = false;
    offset = 0;
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
