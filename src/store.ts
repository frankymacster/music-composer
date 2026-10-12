import { create } from 'zustand';
import { generateTrackCode, type Note } from './music/codegen';
import { isGridCode } from './music/canonical';
import { computeBars, songLength, snapTick, type MeterChange, type Song, TPW } from './music/time';
import type { Scale } from './music/scale';
import { compile, detectKind, fitsGrid, hapsToNotes, kitPitch, kitSounds, notePitch, type Compiled } from './strudel/compile';
import {
  STANDARD_DRUMS,
  defaultLanes,
  freeNote,
  isStandardDrum,
  laneForValue,
  laneKey,
  parseSample,
  soundKey,
  type KitLane,
  type TrackKind,
} from './music/kit';
import type { Output } from './strudel/engine';

export interface Track {
  id: string;
  name: string;
  color: string;
  kind: TrackKind;
  /** Kit tracks only, top → bottom. */
  lanes?: KitLane[];
  code: string;
  mode: 'grid' | 'code';
  notes: Note[];
  output: Output;
  gain: number;
  mute: boolean;
  solo: boolean;
}

export interface Project {
  version: 1;
  song: Song;
  tracks: Track[];
  scale?: Scale;
}

export interface LoopRange {
  enabled: boolean;
  startBar: number;
  endBar: number;
}

export const COLORS = ['#f5a524', '#4fb3ff', '#ff6b8a', '#7ee081', '#b48cff', '#ffd84d', '#4fe3d0', '#ff8f4f'];

export const uid = () => Math.random().toString(36).slice(2, 10);

const compileCache = new Map<string, Compiled>();
export function compileCached(code: string): Compiled {
  let c = compileCache.get(code);
  if (!c) {
    if (compileCache.size > 500) compileCache.clear();
    c = compile(code);
    compileCache.set(code, c);
  }
  return c;
}

const lastGood = new Map<string, Compiled & { ok: true }>();
export function trackPattern(track: Track) {
  const c = compileCached(track.code);
  if (c.ok) {
    lastGood.set(track.id, c);
    return c;
  }
  return lastGood.get(track.id);
}

export const songInfo = (song: Song) => {
  const bars = computeBars(song);
  return { bars, length: songLength(bars) };
};

const withIds = (notes: Note[]) => notes.map((n) => ({ ...n, id: uid() }));

function regen(track: Track, song: Song): Track {
  if (track.mode !== 'grid') return track;
  const { bars, length } = songInfo(song);
  return { ...track, code: generateTrackCode(track.notes, bars, length, track.kind === 'kit' ? track.lanes : undefined) };
}

/** Adds a lane (at the top) for every sound not already in the kit. */
function mergeLanes(lanes: KitLane[], sounds: { s: string; n?: number; bank?: string }[]): KitLane[] {
  const keys = new Set(lanes.map(laneKey));
  let out = lanes;
  for (const v of sounds) {
    if (keys.has(soundKey(v)!)) continue;
    const lane = laneForValue(v, out, uid);
    keys.add(laneKey(lane));
    out = [lane, ...out];
  }
  return out;
}

/** Why a lane change is not allowed, or undefined if it is. */
export function laneConflict(lanes: KitLane[], lane: KitLane): string | undefined {
  if (!parseSample(lane.sample).s) return 'Sample name is required';
  if (!/^[A-Za-z][\w#]*(:\d+)?$/.test(lane.sample)) return 'Use a Strudel sample name like bd, cp:2 or RolandTR808_bd';
  if (lane.note < 0 || lane.note > 127) return 'MIDI note must be 0–127';
  const others = lanes.filter((l) => l.id !== lane.id);
  if (others.some((l) => l.note === lane.note)) return `MIDI note ${lane.note} is used by another lane`;
  if (others.some((l) => laneKey(l) === laneKey(lane))) return 'Another lane already plays this sound';
  return undefined;
}

function makeTrack(partial: Partial<Track> & { name: string }, song: Song, index: number): Track {
  return regen(
    {
      id: uid(),
      color: COLORS[index % COLORS.length],
      kind: 'notes',
      code: 'silence',
      mode: 'grid',
      notes: [],
      output: { type: 'synth', sound: 'gm_epiano1' },
      gain: 1,
      mute: false,
      solo: false,
      ...partial,
    },
    song,
  );
}

function demoProject(): Project {
  const song: Song = { bpm: 110, bars: 4, meters: [{ bar: 0, num: 4, den: 4 }] };
  const q = TPW / 4;
  const chords = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ];
  const keys: Note[] = chords.flatMap((c, bar) =>
    [0, 2].flatMap((beat) => c.map((pitch) => ({ id: uid(), pitch, start: bar * TPW + beat * q, dur: q * 1.5, vel: 0.7 }))),
  );
  const bass: Note[] = [45, 41, 36, 43].flatMap((root, bar) => [
    { id: uid(), pitch: root, start: bar * TPW, dur: q * 1.5, vel: 0.9 },
    { id: uid(), pitch: root, start: bar * TPW + q * 2, dur: q / 2, vel: 0.7 },
    { id: uid(), pitch: root + 12, start: bar * TPW + q * 3, dur: q / 2, vel: 0.8 },
  ]);
  const drums: Note[] = [0, 1, 2, 3].flatMap((bar) => {
    const t = bar * TPW;
    return [
      hit('bd', t, 0.95),
      hit('bd', t + q * 2, 0.9),
      hit('sd', t + q, 0.85),
      hit('sd', t + q * 3, 0.85),
      ...Array.from({ length: 8 }, (_, i) => hit('hh', t + (i * q) / 2, i % 2 ? 0.45 : 0.7)),
    ];
  });
  return {
    version: 1,
    song,
    tracks: [
      makeTrack({ name: 'Keys', notes: keys, output: { type: 'synth', sound: 'gm_epiano1' } }, song, 0),
      makeTrack({ name: 'Bass', notes: bass, output: { type: 'synth', sound: 'gm_synth_bass_1' } }, song, 1),
      makeTrack({ name: 'Drums', kind: 'kit', lanes: defaultLanes(uid, 'RolandTR909'), notes: drums, output: { type: 'kit' } }, song, 2),
      {
        ...makeTrack({ name: 'Arp', output: { type: 'synth', sound: 'gm_vibraphone' }, gain: 0.6 }, song, 3),
        mode: 'code',
        code: 'n("0 2 4 <7 6>").scale("A4:minor").fast(2).late(1/16)',
      },
    ],
  };
}

const hit = (s: string, start: number, vel = 0.8): Note => ({
  id: uid(),
  pitch: STANDARD_DRUMS.find((d) => d.s === s)!.gm,
  start,
  dur: TPW / 16,
  vel,
});

export const migrate = (p: Project): Project => ({
  ...p,
  tracks: p.tracks.map((t) => {
    const kind = (t.kind as string) ?? 'notes';
    if (kind !== 'drums') return { ...t, kind: kind as TrackKind };
    // drum tracks (fixed GM lanes, track-level bank) became kit tracks
    const bank = (t.output as { bank?: string }).bank ?? '';
    const output: Output = t.output.type === 'kit' ? { type: 'kit' } : t.output;
    return regen({ ...t, kind: 'kit', lanes: defaultLanes(uid, bank), output }, p.song);
  }),
});

const STORAGE_KEY = 'music-composer:project';

function loadSaved(): Project | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw) as Project) : undefined;
  } catch {
    return undefined;
  }
}

type FunctionKeys<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T];

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  selectedTrackId: string;
  selection: Set<string>;
  snap: number;
  draw: boolean;
  loop: LoopRange;
  cursor: number;
  ready: boolean;
  playing: boolean;
  midiPorts: string[];
  fold: boolean;
  quantizeStrength: number;
  /** Computer keyboard plays notes (Ableton's "M" mode). */
  keyboard: boolean;
  octave: number;
  velocity: number;
  armed: boolean;
  metronome: boolean;
  countIn: boolean;
  inputQuantize: boolean;

  checkpoint(): void;
  undo(): void;
  redo(): void;
  setProject(p: Project): void;
  newProject(): void;

  setBpm(bpm: number): void;
  setBars(bars: number): void;
  setMeter(bar: number, meter: { num: number; den: number } | null): void;

  addTrack(kind: TrackKind): void;
  addLane(trackId: string): string | undefined;
  updateLane(trackId: string, lane: KitLane): string | undefined;
  removeLane(trackId: string, laneId: string): void;
  moveLane(trackId: string, laneId: string, dir: -1 | 1): void;
  applyKitPreset(trackId: string, bank: string): void;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: Partial<Track>, history?: boolean): void;
  setNotes(id: string, notes: Note[], history?: boolean): void;
  setCode(id: string, code: string): void;
  bake(id: string): void;
  setScale(scale: Scale | undefined): void;
  /** Quantizes note starts in `ids` (all notes when empty) to the current snap. */
  quantize(trackId: string, ids: Set<string>): void;

  select(ids: Set<string>): void;
  set(patch: Partial<Omit<State, 'project' | 'past' | 'future' | 'selection' | FunctionKeys<State>>>): void;
}

const initial = loadSaved() ?? demoProject();

export const useStore = create<State>((set, get) => {
  const commit = (project: Project, history = true) => {
    if (history) set({ past: [...get().past.slice(-199), get().project], future: [] });
    set({ project });
  };
  const mapTrack = (id: string, fn: (t: Track) => Track, history = true) => {
    const p = get().project;
    commit({ ...p, tracks: p.tracks.map((t) => (t.id === id ? fn(t) : t)) }, history);
  };
  const setSong = (song: Song) => {
    const p = get().project;
    commit({ ...p, song, tracks: p.tracks.map((t) => regen(t, song)) });
  };

  return {
    project: initial,
    past: [],
    future: [],
    selectedTrackId: initial.tracks[0]?.id ?? '',
    selection: new Set(),
    snap: TPW / 16,
    draw: false,
    loop: { enabled: false, startBar: 0, endBar: 4 },
    cursor: 0,
    ready: false,
    playing: false,
    midiPorts: [],
    fold: false,
    quantizeStrength: 1,
    keyboard: false,
    octave: 4,
    velocity: 0.8,
    armed: false,
    metronome: false,
    countIn: true,
    inputQuantize: false,

    checkpoint: () => set({ past: [...get().past.slice(-199), get().project], future: [] }),
    undo: () => {
      const { past, project, future } = get();
      if (!past.length) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
    },
    redo: () => {
      const { past, project, future } = get();
      if (!future.length) return;
      set({ project: future[0], future: future.slice(1), past: [...past, project] });
    },
    setProject: (project) => {
      commit(project);
      set({ selectedTrackId: project.tracks[0]?.id ?? '', selection: new Set() });
    },
    newProject: () => {
      const song: Song = { bpm: 120, bars: 8, meters: [{ bar: 0, num: 4, den: 4 }] };
      get().setProject({ version: 1, song, tracks: [makeTrack({ name: 'Track 1' }, song, 0)] });
    },

    setBpm: (bpm) => commit({ ...get().project, song: { ...get().project.song, bpm } }),
    setBars: (bars) => setSong({ ...get().project.song, bars: Math.max(1, Math.min(512, Math.round(bars))) }),
    setMeter: (bar, meter) => {
      const song = get().project.song;
      let meters: MeterChange[] = song.meters.filter((m) => m.bar !== bar);
      if (meter) meters.push({ bar, ...meter });
      else if (bar === 0) return;
      meters = meters.sort((a, b) => a.bar - b.bar);
      setSong({ ...song, meters });
    },

    addTrack: (kind) => {
      const p = get().project;
      const t = makeTrack(
        kind === 'kit'
          ? { name: 'Kit', kind, lanes: defaultLanes(uid), output: { type: 'kit' } }
          : { name: `Track ${p.tracks.length + 1}` },
        p.song,
        p.tracks.length,
      );
      commit({ ...p, tracks: [...p.tracks, t] });
      set({ selectedTrackId: t.id, selection: new Set() });
    },
    addLane: (trackId) => {
      const t = get().project.tracks.find((t) => t.id === trackId);
      if (!t?.lanes) return;
      const used = new Set(t.lanes.map(laneKey));
      const std = STANDARD_DRUMS.find((d) => !used.has(d.s));
      let sample = std?.s ?? 'perc';
      for (let i = 1; used.has(laneKey({ sample, bank: '' })); i++) sample = `perc:${i}`;
      const lane: KitLane = { id: uid(), name: std?.name ?? '', sample, bank: '', note: freeNote(t.lanes, std?.gm) };
      mapTrack(trackId, (t) => regen({ ...t, lanes: [lane, ...t.lanes!] }, get().project.song));
      return lane.id;
    },
    updateLane: (trackId, lane) => {
      const t = get().project.tracks.find((t) => t.id === trackId);
      const old = t?.lanes?.find((l) => l.id === lane.id);
      if (!t || !old) return 'Lane not found';
      const conflict = laneConflict(t.lanes!, lane);
      if (conflict) return conflict;
      mapTrack(trackId, (t) =>
        regen(
          {
            ...t,
            lanes: t.lanes!.map((l) => (l.id === lane.id ? lane : l)),
            notes: lane.note === old.note ? t.notes : t.notes.map((n) => (n.pitch === old.note ? { ...n, pitch: lane.note } : n)),
          },
          get().project.song,
        ),
      );
      return undefined;
    },
    removeLane: (trackId, laneId) =>
      mapTrack(trackId, (t) => {
        const lane = t.lanes?.find((l) => l.id === laneId);
        if (!lane) return t;
        return regen(
          { ...t, lanes: t.lanes!.filter((l) => l.id !== laneId), notes: t.notes.filter((n) => n.pitch !== lane.note) },
          get().project.song,
        );
      }),
    moveLane: (trackId, laneId, dir) =>
      mapTrack(trackId, (t) => {
        const lanes = [...(t.lanes ?? [])];
        const i = lanes.findIndex((l) => l.id === laneId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= lanes.length) return t;
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
        return regen({ ...t, lanes }, get().project.song);
      }),
    applyKitPreset: (trackId, bank) =>
      mapTrack(trackId, (t) => {
        let lanes = t.lanes ?? [];
        for (const lane of lanes) {
          if (!isStandardDrum(parseSample(lane.sample).s) || lane.bank === bank) continue;
          const next = { ...lane, bank };
          if (!laneConflict(lanes, next)) lanes = lanes.map((l) => (l.id === lane.id ? next : l));
        }
        return regen({ ...t, lanes }, get().project.song);
      }),
    removeTrack: (id) => {
      const p = get().project;
      const tracks = p.tracks.filter((t) => t.id !== id);
      commit({ ...p, tracks });
      if (get().selectedTrackId === id) set({ selectedTrackId: tracks[0]?.id ?? '', selection: new Set() });
    },
    updateTrack: (id, patch, history = true) => mapTrack(id, (t) => ({ ...t, ...patch }), history),
    setNotes: (id, notes, history = true) =>
      mapTrack(id, (t) => regen({ ...t, mode: 'grid', notes }, get().project.song), history),
    setCode: (id, code) =>
      mapTrack(id, (t) => {
        if (t.code === code) return t;
        const c = compileCached(code);
        if (!c.ok) return { ...t, code };
        const { length } = songInfo(get().project.song);
        if (t.kind === 'kit' && isGridCode(code, 'kit')) {
          const lanes = mergeLanes(t.lanes ?? [], kitSounds(c.pattern, length));
          return { ...t, code, mode: 'grid', lanes, notes: withIds(hapsToNotes(c.pattern, length, kitPitch(lanes))) };
        }
        if (t.kind === 'notes' && isGridCode(code) && fitsGrid(c.pattern, length, notePitch)) {
          return { ...t, code, mode: 'grid', notes: withIds(hapsToNotes(c.pattern, length)) };
        }
        return { ...t, code, mode: 'code', notes: [] };
      }),
    bake: (id) => {
      const t = get().project.tracks.find((t) => t.id === id);
      const c = t && trackPattern(t);
      if (!c) return;
      const { length } = songInfo(get().project.song);
      const kind = t.kind === 'kit' ? 'kit' : detectKind(c.pattern, length);
      const lanes = kind === 'kit' ? mergeLanes(t.lanes ?? [], kitSounds(c.pattern, length)) : undefined;
      const notes = withIds(hapsToNotes(c.pattern, length, lanes ? kitPitch(lanes) : notePitch));
      const output: Output =
        kind === 'kit' && t.output.type !== 'kit' && t.output.type !== 'midi'
          ? { type: 'kit' }
          : kind === 'notes' && t.output.type === 'kit'
            ? { type: 'synth', sound: 'gm_epiano1' }
            : t.output;
      get().checkpoint();
      get().updateTrack(id, { kind, output, lanes }, false);
      get().setNotes(id, notes, false);
    },

    setScale: (scale) => commit({ ...get().project, scale }),
    quantize: (trackId, ids) => {
      const { snap, quantizeStrength, project } = get();
      if (snap === 1) return;
      const { bars } = songInfo(project.song);
      mapTrack(trackId, (t) =>
        t.mode !== 'grid'
          ? t
          : regen(
              {
                ...t,
                notes: t.notes.map((n) => {
                  if (ids.size && !ids.has(n.id)) return n;
                  const target = snapTick(n.start, snap, bars, 'round');
                  return { ...n, start: Math.max(0, Math.round(n.start + (target - n.start) * quantizeStrength)) };
                }),
              },
              project.song,
            ),
      );
    },

    select: (selection) => set({ selection }),
    set: (patch) => set(patch),
  };
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s.project));
    } catch {
      /* storage full or unavailable */
    }
  }, 400);
});

export const selectedTrack = (s: State) => s.project.tracks.find((t) => t.id === s.selectedTrackId);
