import { type Bar, TPW, gcd } from './time';
import { DRUMS, drumByGm, type TrackKind } from './drums';

export interface Note {
  id: string;
  pitch: number;
  start: number;
  dur: number;
  vel: number;
}

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

export function pitchName(pitch: number): string {
  if (pitch < 12) return String(pitch);
  return NAMES[pitch % 12] + (Math.floor(pitch / 12) - 1);
}

export function pitchLabel(pitch: number): string {
  return NAMES[pitch % 12].toUpperCase() + (Math.floor(pitch / 12) - 1);
}

export const isBlackKey = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);

interface Chord {
  start: number;
  dur: number;
  vel: number;
  pitches: number[];
}

function toChords(notes: Note[]): Chord[] {
  const map = new Map<string, Chord>();
  for (const n of notes) {
    const key = `${n.start}|${n.dur}|${n.vel}`;
    const c = map.get(key);
    if (c) c.pitches.push(n.pitch);
    else map.set(key, { start: n.start, dur: n.dur, vel: n.vel, pitches: [n.pitch] });
  }
  const chords = [...map.values()];
  chords.forEach((c) => c.pitches.sort((a, b) => a - b));
  return chords.sort((a, b) => a.start - b.start || a.pitches[0] - b.pitches[0]);
}

function splitVoices(chords: Chord[]): Chord[][] {
  const voices: { end: number; chords: Chord[] }[] = [];
  for (const c of chords) {
    const v = voices.find((v) => v.end <= c.start);
    if (v) {
      v.chords.push(c);
      v.end = c.start + c.dur;
    } else voices.push({ end: c.start + c.dur, chords: [c] });
  }
  return voices.map((v) => v.chords);
}

const fmtNum = (x: number) => String(+x.toFixed(4));
const weight = (steps: number) => (steps === 1 ? '' : `@${steps}`);

interface Token {
  bar: number;
  start: number;
  steps: number;
  chord?: Chord;
}

function voiceTokens(voice: Chord[], bars: Bar[], length: number, step: number): Token[] {
  const tokens: Token[] = [];
  const barOf = (t: number) => {
    let i = 0;
    while (i + 1 < bars.length && bars[i + 1].start <= t) i++;
    return i;
  };
  // Rests are split so each bar's content starts its own line; whole empty bars collapse into one token.
  const rest = (from: number, to: number) => {
    const cuts = [from];
    const firstBar = barOf(from);
    const lastBar = barOf(to - 1);
    if (lastBar > firstBar) {
      cuts.push(bars[firstBar + 1].start);
      if (to < length && bars[lastBar].start > cuts[cuts.length - 1]) cuts.push(bars[lastBar].start);
    }
    cuts.push(to);
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] > cuts[i]) tokens.push({ bar: barOf(cuts[i]), start: cuts[i], steps: (cuts[i + 1] - cuts[i]) / step });
    }
  };
  let t = 0;
  for (const c of voice) {
    rest(t, c.start);
    tokens.push({ bar: barOf(c.start), start: c.start, steps: c.dur / step, chord: c });
    t = c.start + c.dur;
  }
  rest(t, length);
  return tokens;
}

function renderMini(tokens: Token[], render: (t: Token) => string, indent: string): string {
  const lines: string[] = [];
  let bar = -1;
  for (const t of tokens) {
    const s = render(t) + weight(t.steps);
    if (t.bar !== bar) {
      lines.push(s);
      bar = t.bar;
    } else lines[lines.length - 1] += ' ' + s;
  }
  return lines.length > 1 ? '`' + lines.join('\n' + indent) + '`' : '`' + lines[0] + '`';
}

function renderVoice(voice: Chord[], bars: Bar[], length: number, step: number, indent: string, kind: TrackKind): string {
  const tokens = voiceTokens(voice, bars, length, step);
  const name = kind === 'drums' ? (p: number) => drumByGm.get(p)?.s ?? '~' : pitchName;
  const fn = kind === 'drums' ? 's' : 'note';
  const notes = renderMini(
    tokens,
    (t) => (!t.chord ? '~' : t.chord.pitches.length === 1 ? name(t.chord.pitches[0]) : `[${t.chord.pitches.map(name).join(',')}]`),
    indent + ' '.repeat(fn.length + 2),
  );
  let code = `${fn}(${notes})`;
  const vels = new Set(voice.map((c) => c.vel));
  if (vels.size === 1) {
    const v = voice[0].vel;
    if (v !== 1) code += `.velocity(${fmtNum(v)})`;
  } else {
    code += `\n${indent}  .velocity(${renderMini(tokens, (t) => (t.chord ? fmtNum(t.chord.vel) : '~'), indent + '            ')})`;
  }
  return code;
}

function drumVoices(notes: Note[]): Chord[][] {
  return DRUMS.flatMap((d) => {
    const piece = notes.filter((n) => n.pitch === d.gm);
    return piece.length ? splitVoices(toChords(piece)) : [];
  });
}

export function generateTrackCode(allNotes: Note[], bars: Bar[], length: number, kind: TrackKind = 'notes'): string {
  const notes = allNotes
    .filter((n) => n.start < length && n.dur > 0)
    .filter((n) => kind === 'notes' || drumByGm.has(n.pitch))
    .map((n) => ({ ...n, dur: Math.min(n.dur, length - n.start) }));
  if (!notes.length) return 'silence';

  let step = length;
  for (const n of notes) step = gcd(gcd(step, n.start), n.dur);
  for (const b of bars) step = gcd(step, b.start);

  const voices = kind === 'drums' ? drumVoices(notes) : splitVoices(toChords(notes));
  const cycles = length / TPW;
  const slow = cycles === 1 ? '' : `.slow(${fmtNum(cycles)})`;

  if (voices.length === 1) return renderVoice(voices[0], bars, length, step, '', kind) + slow;
  const body = voices.map((v) => '  ' + renderVoice(v, bars, length, step, '  ', kind)).join(',\n');
  return `stack(\n${body}\n)${slow}`;
}
