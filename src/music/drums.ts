// Drum pieces use Strudel's standard drum names; the note number is the General MIDI drum key.
export interface DrumPiece {
  s: string;
  name: string;
  gm: number;
}

// Bottom → top, as shown in the grid.
export const DRUMS: DrumPiece[] = [
  { s: 'bd', name: 'Kick', gm: 36 },
  { s: 'sd', name: 'Snare', gm: 38 },
  { s: 'rim', name: 'Rim', gm: 37 },
  { s: 'cp', name: 'Clap', gm: 39 },
  { s: 'hh', name: 'Closed hat', gm: 42 },
  { s: 'oh', name: 'Open hat', gm: 46 },
  { s: 'lt', name: 'Low tom', gm: 45 },
  { s: 'mt', name: 'Mid tom', gm: 47 },
  { s: 'ht', name: 'High tom', gm: 50 },
  { s: 'cr', name: 'Crash', gm: 49 },
  { s: 'rd', name: 'Ride', gm: 51 },
  { s: 'cb', name: 'Cowbell', gm: 56 },
  { s: 'tb', name: 'Tambourine', gm: 54 },
  { s: 'sh', name: 'Shaker', gm: 70 },
  { s: 'perc', name: 'Perc', gm: 60 },
];

export const drumByGm = new Map(DRUMS.map((d) => [d.gm, d]));
export const drumByName = new Map(DRUMS.map((d) => [d.s, d]));

export const DRUM_BANKS = [
  'RolandTR909', 'RolandTR808', 'RolandTR707', 'RolandTR606', 'RolandTR505', 'RolandCompurhythm78', 'LinnDrum',
  'LinnLM1', 'AkaiMPC60', 'AkaiLinn', 'EmuSP12', 'OberheimDMX', 'AlesisHR16', 'BossDR110', 'BossDR55', 'CasioRZ1',
  'KorgKR55', 'KorgMinipops', 'SequentialCircuitsDrumtracks', 'SimmonsSDS5', 'YamahaRX5', 'YamahaRY30', 'MPC1000',
];

export type TrackKind = 'notes' | 'drums';

const NOTE_ROWS = Array.from({ length: 128 }, (_, i) => 127 - i);
const DRUM_ROWS = [...DRUMS].reverse().map((d) => d.gm);

/** Pitches shown in the grid, top to bottom. */
export const rowsFor = (kind: TrackKind) => (kind === 'drums' ? DRUM_ROWS : NOTE_ROWS);

export const midiDrumMap = Object.fromEntries(DRUMS.map((d) => [d.s, d.gm]));
