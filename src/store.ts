import { create } from 'zustand';
import { generateTrackCode, type Note } from './music/codegen';
import { isGridCode } from './music/canonical';
import { computeBars, songLength, type MeterChange, type Song, TPW } from './music/time';
import { compile, detectKind, fitsGrid, hapsToNotes, type Compiled } from './strudel/compile';
import { drumByName, type TrackKind } from './music/drums';
import type { Output } from './strudel/engine';

export interface Track {
  id: string;
  name: string;
  color: string;
  kind: TrackKind;
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
  return { ...track, code: generateTrackCode(track.notes, bars, length, track.kind) };
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
      makeTrack({ name: 'Drums', kind: 'drums', notes: drums, output: { type: 'kit', bank: 'RolandTR909' } }, song, 2),
      {
        ...makeTrack({ name: 'Arp', output: { type: 'synth', sound: 'gm_vibraphone' }, gain: 0.6 }, song, 3),
        mode: 'code',
        code: 'n("0 2 4 <7 6>").scale("A4:minor").fast(2).late(1/16)',
      },
    ],
  };
}

const hit = (s: string, start: number, vel = 0.8): Note => ({ id: uid(), pitch: drumByName.get(s)!.gm, start, dur: TPW / 16, vel });

export const migrate = (p: Project): Project => ({
  ...p,
  tracks: p.tracks.map((t) => ({ ...t, kind: t.kind ?? 'notes' })),
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

  checkpoint(): void;
  undo(): void;
  redo(): void;
  setProject(p: Project): void;
  newProject(): void;

  setBpm(bpm: number): void;
  setBars(bars: number): void;
  setMeter(bar: number, meter: { num: number; den: number } | null): void;

  addTrack(kind: TrackKind): void;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: Partial<Track>, history?: boolean): void;
  setNotes(id: string, notes: Note[], history?: boolean): void;
  setCode(id: string, code: string): void;
  bake(id: string): void;

  select(ids: Set<string>): void;
  set(patch: Partial<Pick<State, 'selectedTrackId' | 'snap' | 'draw' | 'loop' | 'cursor' | 'ready' | 'playing' | 'midiPorts'>>): void;
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
        kind === 'drums'
          ? { name: 'Drums', kind, output: { type: 'kit', bank: '' } }
          : { name: `Track ${p.tracks.length + 1}` },
        p.song,
        p.tracks.length,
      );
      commit({ ...p, tracks: [...p.tracks, t] });
      set({ selectedTrackId: t.id, selection: new Set() });
    },
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
        if (isGridCode(code, t.kind) && fitsGrid(c.pattern, length, t.kind)) {
          const notes = withIds(hapsToNotes(c.pattern, length, t.kind));
          return { ...t, code, mode: 'grid', notes };
        }
        return { ...t, code, mode: 'code', notes: [] };
      }),
    bake: (id) => {
      const t = get().project.tracks.find((t) => t.id === id);
      const c = t && trackPattern(t);
      if (!c) return;
      const { length } = songInfo(get().project.song);
      const kind = detectKind(c.pattern, length);
      const notes = withIds(hapsToNotes(c.pattern, length, kind));
      const output: Output =
        kind === 'drums' && t.output.type !== 'kit' && t.output.type !== 'midi'
          ? { type: 'kit', bank: '' }
          : kind === 'notes' && t.output.type === 'kit'
            ? { type: 'synth', sound: 'gm_epiano1' }
            : t.output;
      get().checkpoint();
      get().updateTrack(id, { kind, output }, false);
      get().setNotes(id, notes, false);
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
