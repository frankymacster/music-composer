// Kit tracks: each lane is a pad that plays one sample. A lane's MIDI note doubles as the
// note's `pitch` in the grid, so it is unique within a kit.

export interface KitLane {
  id: string;
  name: string;
  sample: string;
  bank: string;
  note: number;
}

export type TrackKind = 'notes' | 'kit';

/** Standard Strudel drum names with their General MIDI drum keys, top → bottom as shown in the grid. */
export const STANDARD_DRUMS = [
  { s: 'perc', name: 'Perc', gm: 60 },
  { s: 'sh', name: 'Shaker', gm: 70 },
  { s: 'tb', name: 'Tambourine', gm: 54 },
  { s: 'cb', name: 'Cowbell', gm: 56 },
  { s: 'rd', name: 'Ride', gm: 51 },
  { s: 'cr', name: 'Crash', gm: 49 },
  { s: 'ht', name: 'High tom', gm: 50 },
  { s: 'mt', name: 'Mid tom', gm: 47 },
  { s: 'lt', name: 'Low tom', gm: 45 },
  { s: 'oh', name: 'Open hat', gm: 46 },
  { s: 'hh', name: 'Closed hat', gm: 42 },
  { s: 'cp', name: 'Clap', gm: 39 },
  { s: 'rim', name: 'Rim', gm: 37 },
  { s: 'sd', name: 'Snare', gm: 38 },
  { s: 'bd', name: 'Kick', gm: 36 },
];
const standard = new Map(STANDARD_DRUMS.map((d) => [d.s, d]));
export const isStandardDrum = (sample: string) => standard.has(sample);

export const DRUM_BANKS = [
  'RolandTR909', 'RolandTR808', 'RolandTR707', 'RolandTR606', 'RolandTR505', 'RolandCompurhythm78', 'LinnDrum',
  'LinnLM1', 'AkaiMPC60', 'AkaiLinn', 'EmuSP12', 'OberheimDMX', 'AlesisHR16', 'BossDR110', 'BossDR55', 'CasioRZ1',
  'KorgKR55', 'KorgMinipops', 'SequentialCircuitsDrumtracks', 'SimmonsSDS5', 'YamahaRX5', 'YamahaRY30', 'MPC1000',
];

export const defaultLanes = (makeId: () => string, bank = ''): KitLane[] =>
  STANDARD_DRUMS.map((d) => ({ id: makeId(), name: d.name, sample: d.s, bank, note: d.gm }));

/** Identity of a sound as it appears in a hap value: bank, sample name and index. */
export function soundKey(v: { s?: unknown; n?: unknown; bank?: unknown }): string | undefined {
  if (typeof v.s !== 'string') return undefined;
  const n = typeof v.n === 'number' && v.n !== 0 ? `:${v.n}` : '';
  const bank = typeof v.bank === 'string' && v.bank ? `${v.bank}_` : '';
  return `${bank}${v.s}${n}`;
}

export function parseSample(sample: string): { s: string; n?: number } {
  const m = /^(.*?)(?::(\d+))?$/.exec(sample.trim())!;
  return m[2] ? { s: m[1], n: Number(m[2]) } : { s: m[1] };
}

export const laneKey = (lane: Pick<KitLane, 'sample' | 'bank'>) => soundKey({ ...parseSample(lane.sample), bank: lane.bank })!;

export const laneValue = (lane: KitLane) => ({ ...parseSample(lane.sample), ...(lane.bank ? { bank: lane.bank } : {}) });

export const laneLabel = (lane: KitLane) => lane.name || lane.sample;

export function freeNote(lanes: KitLane[], preferred?: number): number {
  const used = new Set(lanes.map((l) => l.note));
  if (preferred !== undefined && !used.has(preferred)) return preferred;
  for (let n = 60; n < 128; n++) if (!used.has(n)) return n;
  for (let n = 59; n >= 0; n--) if (!used.has(n)) return n;
  return 0;
}

/** Lane for a sound found in code; standard drum names get their name and GM note. */
export function laneForValue(v: { s: string; n?: number; bank?: string }, lanes: KitLane[], makeId: () => string): KitLane {
  const sample = v.n ? `${v.s}:${v.n}` : v.s;
  const d = standard.get(v.s);
  return { id: makeId(), name: d && !v.n ? d.name : '', sample, bank: v.bank ?? '', note: freeNote(lanes, d?.gm) };
}

const NOTE_ROWS = Array.from({ length: 128 }, (_, i) => 127 - i);

/** Pitches shown in the grid, top to bottom. */
export const rowsFor = (track: { kind: TrackKind; lanes?: KitLane[] }) =>
  track.kind === 'kit' ? (track.lanes ?? []).map((l) => l.note) : NOTE_ROWS;
