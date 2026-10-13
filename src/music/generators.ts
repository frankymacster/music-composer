import type { Bar } from './time';
import { TPW } from './time';
import type { Note } from './codegen';
import { bassNote, parseChord, voiceLead, type Chord } from './chords';
import { inScale, type Scale } from './scale';
import { parseSample, type KitLane, type TrackKind } from './kit';
import { scaleStep } from './transforms';

/** A chord placed in a section (the chord lane). */
export interface ChordEvent {
  id: string;
  symbol: string;
  start: number;
  dur: number;
}

export type GeneratorType = 'bass' | 'arp' | 'pad' | 'melody' | 'drums';

/** How a clip was generated, so it can be rerolled or regenerated when the chords change. */
export interface GeneratorSpec {
  type: GeneratorType;
  style: string;
  seed: number;
  /** Arp step / melody grid in ticks. */
  rate?: number;
  /** Melody: 0..1. */
  density?: number;
  /** Drums: fill in the last bar. */
  fill?: boolean;
  /** Drums: crash on the first beat. */
  crash?: boolean;
}

export const GENERATORS: Record<GeneratorType, { label: string; kinds: TrackKind[]; styles: [string, string][] }> = {
  bass: {
    label: 'Bass line',
    kinds: ['notes'],
    styles: [
      ['groove', 'Groove (🎲 rhythm)'],
      ['root', 'Roots'],
      ['pulse', '8th-note pulse'],
      ['rootFifth', 'Root–fifth'],
      ['octave', 'Octaves'],
      ['walking', 'Walking'],
    ],
  },
  arp: {
    label: 'Arpeggio',
    kinds: ['notes'],
    styles: [
      ['up', 'Up'],
      ['down', 'Down'],
      ['updown', 'Up-down'],
      ['random', 'Random (🎲)'],
    ],
  },
  pad: {
    label: 'Chords / pads',
    kinds: ['notes'],
    styles: [
      ['sustain', 'Sustained'],
      ['offbeat', 'Off-beat stabs'],
      ['charleston', 'Charleston'],
      ['stabs', 'Rhythmic stabs (🎲)'],
    ],
  },
  melody: {
    label: 'Melody',
    kinds: ['notes'],
    styles: [
      ['phrase', 'Phrase (🎲)'],
      ['sparse', 'Sparse (🎲)'],
    ],
  },
  drums: {
    label: 'Drum groove',
    kinds: ['kit'],
    styles: [
      ['house', 'House'],
      ['hiphop', 'Hip-hop'],
      ['rock', 'Rock'],
      ['breakbeat', 'Breakbeat'],
    ],
  },
};

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => Math.floor(Math.random() * 1e9);

export interface ChordSpan {
  chord: Chord;
  start: number;
  dur: number;
}

export interface GenContext {
  bars: Bar[];
  length: number;
  chords: ChordSpan[];
  scale?: Scale;
  lanes?: KitLane[];
}

/** Chord lane → parsed spans; without chords, the key's tonic triad (C major by default) for the whole section. */
export function chordSpans(events: ChordEvent[] | undefined, scale: Scale | undefined, length: number): ChordSpan[] {
  const spans: ChordSpan[] = [];
  for (const e of [...(events ?? [])].sort((a, b) => a.start - b.start)) {
    try {
      spans.push({ chord: parseChord(e.symbol, scale), start: e.start, dur: Math.min(e.dur, length - e.start) });
    } catch {
      /* invalid symbols are shown in the lane and skipped here */
    }
  }
  if (spans.length) return spans.filter((s) => s.dur > 0);
  const minor = !!scale && (scale.mode.includes('minor') || ['dorian', 'phrygian', 'locrian', 'blues'].includes(scale.mode));
  return [{ chord: { symbol: '', root: scale?.root ?? 0, intervals: minor ? [0, 3, 7] : [0, 4, 7] }, start: 0, dur: length }];
}

const chordAt = (spans: ChordSpan[], t: number) => spans.find((s) => t >= s.start && t < s.start + s.dur) ?? spans[spans.length - 1];

/** Beat start ticks in [from, to), following each bar's meter. */
function beats(bars: Bar[], from: number, to: number): number[] {
  const out: number[] = [];
  for (const bar of bars) {
    const len = TPW / bar.den;
    for (let t = bar.start; t < bar.start + bar.length; t += len) if (t >= from && t < to) out.push(t);
  }
  return out;
}

const steps = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  return out;
};

const tones = (c: Chord) => [...new Set(c.intervals.map((i) => (c.root + i) % 12))];

/** Pitch with pitch class `pc` nearest to `near`. */
const nearestPc = (pc: number, near: number) => {
  const base = near - ((((near - pc) % 12) + 12) % 12);
  return near - base <= 6 ? base : base + 12;
};

const clampOctave = (p: number, lo: number, hi: number) => {
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
};

type Make = (pitch: number, start: number, dur: number, vel: number) => Note;

function bass(spec: GeneratorSpec, ctx: GenContext, make: Make, rand: () => number): Note[] {
  const out: Note[] = [];
  const lo = 28;
  const hi = 52;
  const eighth = TPW / 8;
  // groove: one 16-step rhythm (with note roles) per seed, reused every bar
  const groove = Array.from({ length: 16 }, (_, i) => {
    const on = i === 0 || rand() < (i % 4 === 0 ? 0.55 : i % 2 === 0 ? 0.3 : 0.18);
    const r = rand();
    return { on, role: i === 0 ? 'root' : r < 0.65 ? 'root' : r < 0.82 ? 'octave' : 'fifth' };
  });
  ctx.chords.forEach((span, si) => {
    const root = bassNote(span.chord, 36);
    const end = span.start + span.dur;
    const fifth = clampOctave(root + 7, lo, hi);
    switch (spec.style) {
      case 'root':
        out.push(make(root, span.start, span.dur, 0.9));
        break;
      case 'pulse':
        steps(span.start, end, eighth).forEach((t, i) => out.push(make(root, t, Math.min(eighth, end - t), i % 2 ? 0.65 : 0.9)));
        break;
      case 'octave':
        steps(span.start, end, eighth).forEach((t, i) => out.push(make(i % 2 ? root + 12 : root, t, Math.min(eighth, end - t), i % 2 ? 0.7 : 0.9)));
        break;
      case 'rootFifth': {
        const bs = beats(ctx.bars, span.start, end);
        bs.forEach((t, i) => out.push(make(i % 2 ? fifth : root, t, (bs[i + 1] ?? end) - t, i % 2 ? 0.75 : 0.9)));
        break;
      }
      case 'walking': {
        const bs = beats(ctx.bars, span.start, end);
        const next = ctx.chords[si + 1] ?? ctx.chords[0];
        const nextRoot = bassNote(next.chord, 36);
        let prev = root;
        bs.forEach((t, i) => {
          let p = root;
          if (i === bs.length - 1 && bs.length > 1) p = nextRoot + (rand() < 0.5 ? 1 : -1);
          else if (i > 0) {
            const pcs = tones(span.chord);
            const options = [...pcs.map((pc) => nearestPc(pc, prev)), scaleStep(prev, rand() < 0.5 ? 1 : -1, ctx.scale)];
            p = options[Math.floor(rand() * options.length)];
          }
          p = clampOctave(p, lo, hi);
          out.push(make(p, t, (bs[i + 1] ?? end) - t, i === 0 ? 0.9 : 0.75));
          prev = p;
        });
        break;
      }
      default: {
        // groove
        const sixteenth = TPW / 16;
        const onsets = steps(span.start, end, sixteenth).filter((t) => groove[Math.round((t % TPW) / sixteenth) % 16].on);
        onsets.forEach((t, i) => {
          const g = groove[Math.round((t % TPW) / sixteenth) % 16];
          const p = g.role === 'octave' ? root + 12 : g.role === 'fifth' ? fifth : root;
          const dur = Math.min((onsets[i + 1] ?? end) - t, TPW / 4);
          out.push(make(p, t, Math.max(sixteenth, dur - sixteenth / 4), t % (TPW / 4) === 0 ? 0.9 : 0.7));
        });
      }
    }
  });
  return out;
}

function arp(spec: GeneratorSpec, ctx: GenContext, make: Make, rand: () => number): Note[] {
  const out: Note[] = [];
  const rate = spec.rate ?? TPW / 16;
  for (const span of ctx.chords) {
    const base = clampOctave(60 + span.chord.root, 57, 68);
    const one = [...new Set(span.chord.intervals.map((i) => base + i))].sort((a, b) => a - b);
    const notes = [...one, ...one.map((p) => p + 12)];
    const order = spec.style === 'down' ? [...notes].reverse() : spec.style === 'updown' ? [...notes, ...notes.slice(1, -1).reverse()] : notes;
    steps(span.start, span.start + span.dur, rate).forEach((t, i) => {
      const p = spec.style === 'random' ? notes[Math.floor(rand() * notes.length)] : order[i % order.length];
      out.push(make(p, t, Math.min(rate, span.start + span.dur - t), i % 4 === 0 ? 0.85 : 0.65));
    });
  }
  return out;
}

function pad(spec: GeneratorSpec, ctx: GenContext, make: Make, rand: () => number): Note[] {
  const out: Note[] = [];
  const voiced = voiceLead(ctx.chords.map((s) => s.chord));
  const eighth = TPW / 8;
  const stabs = Array.from({ length: 8 }, (_, i) => i === 0 || rand() < (i % 2 ? 0.4 : 0.3));
  ctx.chords.forEach((span, i) => {
    const end = span.start + span.dur;
    const hits: [number, number][] = [];
    if (spec.style === 'sustain') hits.push([span.start, span.dur]);
    else if (spec.style === 'offbeat') steps(span.start + eighth, end, TPW / 4).forEach((t) => hits.push([t, eighth]));
    else if (spec.style === 'charleston')
      for (const bar of ctx.bars.filter((b) => b.start >= span.start && b.start < end)) {
        hits.push([bar.start, (TPW * 3) / 16], [bar.start + (TPW * 3) / 8, eighth]);
      }
    else steps(span.start, end, eighth).forEach((t) => stabs[Math.round((t % TPW) / eighth) % 8] && hits.push([t, eighth]));
    for (const [t, d] of hits) if (t >= 0 && t < end) voiced[i].forEach((p) => out.push(make(p, t, Math.min(d, end - t), 0.7)));
  });
  return out;
}

function melody(spec: GeneratorSpec, ctx: GenContext, make: Make, rand: () => number): Note[] {
  const out: Note[] = [];
  const grid = spec.rate ?? TPW / 8;
  const density = spec.density ?? (spec.style === 'sparse' ? 0.3 : 0.55);
  // two bar rhythms, alternated (A B A B') so the line feels like phrases
  const perBar = (len: number) => steps(0, len, grid).map((t, i) => i === 0 || rand() < density * (t % (TPW / 4) === 0 ? 1.3 : 0.8));
  const rhythms = [perBar(TPW), perBar(TPW)];
  const scale = ctx.scale;
  let prev = clampOctave(nearestPc(ctx.chords[0].chord.root, 67), 62, 76);
  ctx.bars.forEach((bar) => {
    const rhythm = rhythms[bar.index % 2];
    const onsets = steps(bar.start, bar.start + bar.length, grid).filter((_, i) => rhythm[i % rhythm.length]);
    onsets.forEach((t, i) => {
      const span = chordAt(ctx.chords, t);
      const strong = t % (TPW / 4) === 0;
      const lastOfPhrase = bar.index % 2 === 1 && i === onsets.length - 1;
      let p: number;
      if (lastOfPhrase) p = nearestPc(span.chord.root, prev);
      else if (strong) {
        const options = tones(span.chord).map((pc) => nearestPc(pc, prev + Math.round((rand() - 0.5) * 6)));
        p = options[Math.floor(rand() * options.length)];
      } else p = scaleStep(prev, (rand() < 0.5 ? -1 : 1) * (rand() < 0.75 ? 1 : 2), scale);
      p = clampOctave(p, 60, 81);
      if (scale && !inScale(scale, p)) p = scaleStep(p, 1, scale);
      const next = onsets[i + 1] ?? bar.start + bar.length;
      out.push(make(p, t, Math.max(TPW / 16, Math.min(next - t, TPW / 2) - TPW / 64), strong ? 0.85 : 0.7));
      prev = p;
    });
  });
  return out;
}

const DRUM_PATTERNS: Record<string, Record<string, string>> = {
  house: { bd: 'x...x...x...x...', cp: '....x.......x...', oh: '..x...x...x...x.', hh: 'xxxxxxxxxxxxxxxx' },
  hiphop: { bd: 'x.........x.....', sd: '....x.......x...', hh: 'x.x.x.x.x.x.x.x.' },
  rock: { bd: 'x.......x.x.....', sd: '....x.......x...', hh: 'x.x.x.x.x.x.x.x.' },
  breakbeat: { bd: 'x.x.......x.....', sd: '....x..x.x..x...', hh: 'x.x.x.x.x.x.x.x.' },
};

function drums(spec: GeneratorSpec, ctx: GenContext, make: Make, rand: () => number): Note[] {
  const lane = (name: string) => ctx.lanes?.find((l) => parseSample(l.sample).s === name && !parseSample(l.sample).n)?.note;
  const out: Note[] = [];
  const pattern = DRUM_PATTERNS[spec.style] ?? DRUM_PATTERNS.house;
  const sixteenth = TPW / 16;
  // per-seed variations reused every bar: extra kicks and ghost snares
  const extraKick = Array.from({ length: 16 }, (_, i) => i % 2 === 0 && i > 0 && rand() < 0.15);
  const ghost = Array.from({ length: 16 }, (_, i) => i % 2 === 1 && rand() < 0.2);
  const lastBar = ctx.bars[ctx.bars.length - 1];
  const fillFrom = spec.fill && lastBar ? lastBar.start + lastBar.length / 2 : Infinity;
  for (const bar of ctx.bars) {
    for (let t = bar.start, i = 0; t < bar.start + bar.length; t += sixteenth, i++) {
      if (t >= fillFrom) continue;
      const step = i % 16;
      for (const [name, row] of Object.entries(pattern)) {
        const pitch = lane(name);
        if (pitch === undefined || row[step] !== 'x') continue;
        const vel = name === 'hh' ? (step % 4 === 0 ? 0.75 : 0.45) + (rand() - 0.5) * 0.1 : name === 'bd' && step === 0 ? 1 : 0.85;
        out.push(make(pitch, t, sixteenth, Math.round(vel * 100) / 100));
      }
      const kick = lane('bd');
      if (kick !== undefined && extraKick[step] && pattern.bd?.[step] !== 'x') out.push(make(kick, t, sixteenth, 0.7));
      const snare = lane('sd') ?? lane('cp');
      if (snare !== undefined && ghost[step]) out.push(make(snare, t, sixteenth, 0.3));
    }
  }
  if (spec.fill && lastBar) {
    const toms = ['ht', 'mt', 'lt'].map(lane).filter((p): p is number => p !== undefined);
    const voices = [lane('sd') ?? lane('cp'), ...toms].filter((p): p is number => p !== undefined);
    steps(fillFrom, lastBar.start + lastBar.length, sixteenth).forEach((t, i, all) => {
      const pitch = voices[Math.min(voices.length - 1, Math.floor((i / all.length) * voices.length))];
      if (pitch !== undefined && (i % 2 === 0 || rand() < 0.7)) out.push(make(pitch, t, sixteenth, Math.round((0.5 + (0.5 * i) / all.length) * 100) / 100));
    });
  }
  const crash = lane('cr');
  if (spec.crash && crash !== undefined) out.push(make(crash, 0, sixteenth, 0.9));
  return out;
}

/** Notes for a generator spec in a section; same spec and context always give the same notes. */
export function generate(spec: GeneratorSpec, ctx: GenContext, makeId: () => string): Note[] {
  const rand = rng(spec.seed);
  const make: Make = (pitch, start, dur, vel) => ({ id: makeId(), pitch, start, dur, vel });
  const fn = { bass, arp, pad, melody, drums }[spec.type];
  return fn(spec, ctx, make, rand).filter((n) => n.start >= 0 && n.start < ctx.length && n.dur > 0 && n.pitch >= 0 && n.pitch <= 127);
}
