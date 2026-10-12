import type { TrackKind } from './kit';

/** A non-destructive Strudel transform appended to a whole track (all sections). */
export interface Modifier {
  id: string;
  type: ModifierType;
  amount: number;
  enabled: boolean;
}

interface ModifierDef {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  format: (amount: number) => string;
  code: (amount: number, bpm: number) => string;
  /** Only makes sense for these track kinds. */
  kinds?: TrackKind[];
  /** Audio effect: no effect on MIDI out. */
  audioOnly?: boolean;
}

const pct = (a: number) => `${Math.round(a * 100)}%`;
const num = (a: number) => String(+a.toFixed(3));

export const MODIFIERS = {
  swing8: {
    label: 'Swing 8ths',
    min: 0,
    max: 0.33,
    step: 0.01,
    default: 0.12,
    format: pct,
    code: (a) => `.swingBy(${num(a)}, 4)`,
  },
  swing16: {
    label: 'Swing 16ths',
    min: 0,
    max: 0.33,
    step: 0.01,
    default: 0.12,
    format: pct,
    code: (a) => `.swingBy(${num(a)}, 8)`,
  },
  degrade: {
    label: 'Drop notes',
    min: 0,
    max: 0.9,
    step: 0.05,
    default: 0.2,
    format: pct,
    code: (a) => `.degradeBy(${num(a)})`,
  },
  stutter: {
    label: 'Stutter',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    format: pct,
    code: (a) => `.sometimesBy(${num(a)}, x => x.ply(2))`,
  },
  octaves: {
    label: 'Octave jumps',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    format: pct,
    code: (a) => `.sometimesBy(${num(a)}, x => x.transpose(12))`,
    kinds: ['notes'],
  },
  reverse: {
    label: 'Reverse every N bars',
    min: 2,
    max: 8,
    step: 1,
    default: 4,
    format: (a) => `every ${a}`,
    code: (a) => `.lastOf(${a}, rev)`,
  },
  echo: {
    label: 'Echo (dotted 8th)',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    format: pct,
    code: (a, bpm) => `.delay(${num(a)}).delaytime(${num((60 / bpm) * 0.75)}).delayfeedback(0.45)`,
    audioOnly: true,
  },
  sweep: {
    label: 'Filter sweep',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    format: pct,
    code: (a) => `.lpf(sine.range(300, ${Math.round(300 + a * 6000)}).slow(8))`,
    audioOnly: true,
  },
} satisfies Record<string, ModifierDef>;

export type ModifierType = keyof typeof MODIFIERS;

export const modifierDef = (type: ModifierType): ModifierDef => MODIFIERS[type];

/** Strudel method chain for a track's enabled modifiers. */
export const modifiersCode = (mods: Modifier[] | undefined, bpm: number) =>
  (mods ?? [])
    .filter((m) => m.enabled)
    .map((m) => modifierDef(m.type).code(m.amount, bpm))
    .join('');
