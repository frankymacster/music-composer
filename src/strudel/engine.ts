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

const mod = (a: number, n: number) => ((a % n) + n) % n;

function apply() {
  if (!repl) return;
  repl.scheduler.setPattern(base.ribbon(loop.start, loop.len).early(shift), false);
}

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

  /** Current song position in cycles. */
  position(): number {
    if (!playing || !repl) return loop.start;
    return loop.start + mod(repl.scheduler.now() + shift, loop.len);
  },

  setLoop(next: Loop) {
    if (playing && repl) {
      let pos = this.position();
      if (pos < next.start || pos >= next.start + next.len) pos = next.start;
      shift = mod(pos - next.start - repl.scheduler.now(), next.len);
      loop = next;
      apply();
    } else loop = next;
  },

  async play(from: number, next: Loop) {
    if (!repl) return;
    await ensureAudio();
    loop = next;
    const pos = from >= next.start && from < next.start + next.len ? from : next.start;
    shift = pos - next.start;
    apply();
    await repl.scheduler.start();
    playing = true;
  },

  stop() {
    if (!repl) return;
    repl.scheduler.stop();
    playing = false;
    if (midi.WebMidi.enabled) midi.WebMidi.outputs.forEach((o: any) => o.sendAllNotesOff());
  },

  async preview(value: Record<string, unknown>, out: Output) {
    if (out.type === 'midi') {
      const port = midi.WebMidi.enabled && midi.WebMidi.outputs.find((o: any) => o.name.includes(out.port));
      port?.playNote(value.note, { channels: out.channel, duration: 250, attack: value.velocity ?? 0.8 });
      return;
    }
    await ensureAudio();
    const ctx = webaudio.getAudioContext();
    const sound = out.type === 'synth' ? { s: out.sound } : value.s ? {} : { s: 'triangle' };
    webaudio.superdough({ ...value, ...sound }, ctx.currentTime + 0.02, 0.3);
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

export function onMidiChange(cb: (ports: string[]) => void) {
  const handler = () => cb(midi.WebMidi.outputs.map((o: any) => o.name));
  midi.WebMidi.addListener('connected', handler);
  midi.WebMidi.addListener('disconnected', handler);
}

/** Names of every loaded sound (samples, synths, soundfonts). */
export function availableSounds(): string[] {
  return Object.keys(webaudio.soundMap.get()).sort();
}
