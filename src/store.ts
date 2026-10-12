import { create } from 'zustand';
import { generateTrackCode, type Note } from './music/codegen';
import { isGridCode } from './music/canonical';
import { snapTick, type MeterChange, TPW } from './music/time';
import { sectionInfo, timeline, type Section } from './music/arrangement';
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
import { modifierDef, type Modifier, type ModifierType } from './music/modifiers';
import { euclid } from './music/transforms';
import { bassNote, parseProgression, voiceLead, type ChordStamp } from './music/chords';

/** A track's content for one section. */
export interface Clip {
  code: string;
  mode: 'grid' | 'code';
  notes: Note[];
}

export interface Track {
  id: string;
  name: string;
  color: string;
  kind: TrackKind;
  /** Kit tracks only, top → bottom. */
  lanes?: KitLane[];
  /** Section id → clip; a missing clip is empty. */
  clips: Record<string, Clip>;
  output: Output;
  gain: number;
  mute: boolean;
  solo: boolean;
  /** Live Strudel transforms on the whole track. */
  modifiers?: Modifier[];
}

export interface Project {
  version: 2;
  bpm: number;
  sections: Section[];
  /** Section ids in playing order; a section can appear several times. */
  arrangement: string[];
  tracks: Track[];
  scale?: Scale;
}

/** A track seen through one of its clips (what the roll and editor work on). */
export type TrackView = Track & Clip & { sectionId: string };

export interface LoopRange {
  enabled: boolean;
  startBar: number;
  endBar: number;
}

export type PlayMode = 'section' | 'song';

export const COLORS = ['#f5a524', '#4fb3ff', '#ff6b8a', '#7ee081', '#b48cff', '#ffd84d', '#4fe3d0', '#ff8f4f'];
export const SECTION_COLORS = ['#5b8def', '#e0795a', '#58b88a', '#c27bd6', '#d6b84a', '#4fb8c4', '#e06b8b', '#8a8fe0'];

export const uid = () => Math.random().toString(36).slice(2, 10);

export const EMPTY_CLIP: Clip = { code: 'silence', mode: 'grid', notes: [] };
export const clipOf = (t: Track, sectionId: string): Clip => t.clips[sectionId] ?? EMPTY_CLIP;

const views = new WeakMap<Track, Map<string, TrackView>>();
export function trackView(t: Track, sectionId: string): TrackView {
  let bySection = views.get(t);
  if (!bySection) views.set(t, (bySection = new Map()));
  let v = bySection.get(sectionId);
  if (!v) bySection.set(sectionId, (v = { ...t, ...clipOf(t, sectionId), sectionId }));
  return v;
}

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
/** Compiled clip, or its last version that compiled while the code has errors. */
export function trackPattern(view: { id: string; sectionId: string; code: string }) {
  const key = `${view.id}:${view.sectionId}`;
  const c = compileCached(view.code);
  if (c.ok) {
    lastGood.set(key, c);
    return c;
  }
  return lastGood.get(key);
}

export const findSection = (p: Project, id: string) => p.sections.find((s) => s.id === id) ?? p.sections[0];

const withIds = (notes: Note[]) => notes.map((n) => ({ ...n, id: uid() }));

function regenClip(t: Track, clip: Clip, section: Section): Clip {
  if (clip.mode !== 'grid') return clip;
  const { bars, length } = sectionInfo(section);
  return { ...clip, code: generateTrackCode(clip.notes, bars, length, t.kind === 'kit' ? t.lanes : undefined) };
}

/** Regenerates the grid code of every clip (or only `sectionId`'s). */
function regen(t: Track, sections: Section[], sectionId?: string): Track {
  const clips: Record<string, Clip> = {};
  for (const [id, clip] of Object.entries(t.clips)) {
    const section = sections.find((s) => s.id === id);
    clips[id] = section && (!sectionId || id === sectionId) ? regenClip(t, clip, section) : clip;
  }
  return { ...t, clips };
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

const mapNotes = (t: Track, fn: (notes: Note[]) => Note[]): Track => ({
  ...t,
  clips: Object.fromEntries(Object.entries(t.clips).map(([id, c]) => [id, { ...c, notes: fn(c.notes) }])),
});

function makeTrack(partial: Partial<Track> & { name: string }, sections: Section[], index: number): Track {
  return regen(
    {
      id: uid(),
      color: COLORS[index % COLORS.length],
      kind: 'notes',
      clips: {},
      output: { type: 'synth', sound: 'gm_epiano1' },
      gain: 1,
      mute: false,
      solo: false,
      ...partial,
    },
    sections,
  );
}

const makeSection = (name: string, index: number, bars = 4, meters: MeterChange[] = [{ bar: 0, num: 4, den: 4 }]): Section => ({
  id: uid(),
  name,
  color: SECTION_COLORS[index % SECTION_COLORS.length],
  bars,
  meters,
});

const hit = (s: string, start: number, vel = 0.8): Note => ({
  id: uid(),
  pitch: STANDARD_DRUMS.find((d) => d.s === s)!.gm,
  start,
  dur: TPW / 16,
  vel,
});

function demoProject(): Project {
  const verse = makeSection('Verse', 0);
  const chorus = makeSection('Chorus', 1);
  const sections = [verse, chorus];
  const q = TPW / 4;
  const chordNotes = (chords: number[][]) =>
    chords.flatMap((c, bar) =>
      [0, 2].flatMap((beat) => c.map((pitch) => ({ id: uid(), pitch, start: bar * TPW + beat * q, dur: q * 1.5, vel: 0.7 }))),
    );
  const bassNotes = (roots: number[]) =>
    roots.flatMap((root, bar) => [
      { id: uid(), pitch: root, start: bar * TPW, dur: q * 1.5, vel: 0.9 },
      { id: uid(), pitch: root, start: bar * TPW + q * 2, dur: q / 2, vel: 0.7 },
      { id: uid(), pitch: root + 12, start: bar * TPW + q * 3, dur: q / 2, vel: 0.8 },
    ]);
  const beat = (open: boolean) =>
    [0, 1, 2, 3].flatMap((bar) => {
      const t = bar * TPW;
      return [
        hit('bd', t, 0.95),
        hit('bd', t + q * 2, 0.9),
        hit('sd', t + q, 0.85),
        hit('sd', t + q * 3, 0.85),
        ...Array.from({ length: 8 }, (_, i) => hit(open && i % 2 ? 'oh' : 'hh', t + (i * q) / 2, i % 2 ? 0.45 : 0.7)),
      ];
    });
  const grid = (notes: Note[]): Clip => ({ code: '', mode: 'grid', notes });
  return {
    version: 2,
    bpm: 110,
    sections,
    arrangement: [verse.id, verse.id, chorus.id, verse.id],
    tracks: [
      makeTrack(
        {
          name: 'Keys',
          clips: {
            [verse.id]: grid(chordNotes([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]])),
            [chorus.id]: grid(chordNotes([[53, 57, 60], [55, 59, 62], [57, 60, 64], [57, 60, 64]])),
          },
          output: { type: 'synth', sound: 'gm_epiano1' },
        },
        sections,
        0,
      ),
      makeTrack(
        {
          name: 'Bass',
          clips: { [verse.id]: grid(bassNotes([45, 41, 36, 43])), [chorus.id]: grid(bassNotes([41, 43, 45, 45])) },
          output: { type: 'synth', sound: 'gm_synth_bass_1' },
        },
        sections,
        1,
      ),
      makeTrack(
        {
          name: 'Drums',
          kind: 'kit',
          lanes: defaultLanes(uid, 'RolandTR909'),
          clips: { [verse.id]: grid(beat(false)), [chorus.id]: grid(beat(true)) },
          output: { type: 'kit' },
        },
        sections,
        2,
      ),
      makeTrack(
        {
          name: 'Arp',
          clips: { [chorus.id]: { code: 'n("0 2 4 <7 6>").scale("A4:minor").fast(2).late(1/16)', mode: 'code', notes: [] } },
          output: { type: 'synth', sound: 'gm_vibraphone' },
          gain: 0.6,
        },
        sections,
        3,
      ),
    ],
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Upgrades saved projects: v1 (one song timeline per track) becomes a single section; old drum tracks become kits. */
export function migrate(raw: any): Project {
  if (raw.version === 2) return raw as Project;
  const section = makeSection('A', 0, raw.song.bars, raw.song.meters);
  const tracks: Track[] = raw.tracks.map((t: any) => {
    let kind: TrackKind = t.kind ?? 'notes';
    let { lanes, output } = t;
    if ((t.kind as string) === 'drums') {
      kind = 'kit';
      lanes = defaultLanes(uid, output.bank ?? '');
      if (output.type === 'kit') output = { type: 'kit' };
    }
    const { code, mode, notes, ...rest } = t;
    return regen({ ...rest, kind, lanes, output, clips: { [section.id]: { code, mode, notes } } }, [section]);
  });
  return { version: 2, bpm: raw.song.bpm, sections: [section], arrangement: [section.id], tracks, scale: raw.scale };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const STORAGE_KEY = 'music-composer:project';

function loadSaved(): Project | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : undefined;
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
  /** Section being edited (and looped in section mode). */
  selectedSectionId: string;
  selection: Set<string>;
  snap: number;
  draw: boolean;
  loop: LoopRange;
  /** Tick inside the selected section. */
  cursor: number;
  ready: boolean;
  playing: boolean;
  playMode: PlayMode;
  /** In song mode, select the section being played. */
  follow: boolean;
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
  /** Drawn notes become chords. */
  chordStamp: ChordStamp;
  /** Show other tracks' notes in the roll. */
  ghosts: boolean;

  checkpoint(): void;
  undo(): void;
  redo(): void;
  setProject(p: Project): void;
  newProject(): void;

  setBpm(bpm: number): void;
  /** Length of the selected section. */
  setBars(bars: number): void;
  /** Time signature change in the selected section. */
  setMeter(bar: number, meter: { num: number; den: number } | null): void;

  selectSection(id: string): void;
  addSection(): void;
  duplicateSection(id: string): void;
  renameSection(id: string, name: string): void;
  removeSection(id: string): void;
  arrangeAppend(sectionId: string): void;
  arrangeRemove(index: number): void;
  arrangeMove(from: number, to: number): void;

  addTrack(kind: TrackKind): void;
  addLane(trackId: string): string | undefined;
  updateLane(trackId: string, lane: KitLane): string | undefined;
  removeLane(trackId: string, laneId: string): void;
  moveLane(trackId: string, laneId: string, dir: -1 | 1): void;
  applyKitPreset(trackId: string, bank: string): void;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: Partial<Omit<Track, 'clips'>>, history?: boolean): void;
  /** Sets a clip's notes (the selected section's unless `sectionId` is given). */
  setNotes(id: string, notes: Note[], history?: boolean, sectionId?: string): void;
  /** Sets a clip's code (the selected section's unless `sectionId` is given). */
  setCode(id: string, code: string, sectionId?: string): void;
  bake(id: string): void;
  setScale(scale: Scale | undefined): void;
  /** Quantizes note starts in `ids` (all notes when empty) to the current snap. */
  quantize(trackId: string, ids: Set<string>): void;
  /** Replaces the selected notes (all when none) of the current clip with `fn`'s result and selects it. */
  transformNotes(trackId: string, fn: (notes: Note[]) => Note[]): void;
  /** Writes a Euclidean rhythm on one pitch/lane across the selected section, replacing what was there. */
  euclidFill(trackId: string, pitch: number, hits: number, steps: number, rotate: number, stepTicks: number): void;
  /**
   * Writes a chord progression into the selected section, repeated to fill it; each chord lasts `bars` bars
   * (or `beats` beats when given). Optionally writes the bass line to another track. Returns an error message.
   */
  writeProgression(
    trackId: string,
    text: string,
    length: { bars: number } | { beats: number },
    replace: boolean,
    bassTrackId?: string,
  ): string | undefined;
  addModifier(trackId: string, type: ModifierType): void;
  updateModifier(trackId: string, id: string, patch: Partial<Modifier>, history?: boolean): void;
  removeModifier(trackId: string, id: string): void;

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
  const section = () => findSection(get().project, get().selectedSectionId);
  /** Updates the clip of `sectionId` (default: selected) on track `id`. */
  const mapClip = (id: string, fn: (clip: Clip, t: Track, section: Section) => Clip, history = true, sectionId?: string) => {
    const sec = sectionId ? findSection(get().project, sectionId) : section();
    mapTrack(id, (t) => ({ ...t, clips: { ...t.clips, [sec.id]: fn(clipOf(t, sec.id), t, sec) } }), history);
  };
  const setSection = (next: Section) => {
    const p = get().project;
    commit({
      ...p,
      sections: p.sections.map((s) => (s.id === next.id ? next : s)),
      tracks: p.tracks.map((t) => regen(t, p.sections.map((s) => (s.id === next.id ? next : s)), next.id)),
    });
  };
  const resetEditing = (patch: Partial<State> = {}) => set({ selection: new Set(), cursor: 0, loop: { ...get().loop, enabled: false }, ...patch });

  return {
    project: initial,
    past: [],
    future: [],
    selectedTrackId: initial.tracks[0]?.id ?? '',
    selectedSectionId: initial.arrangement[0] ?? initial.sections[0].id,
    selection: new Set(),
    snap: TPW / 16,
    draw: false,
    loop: { enabled: false, startBar: 0, endBar: 4 },
    cursor: 0,
    ready: false,
    playing: false,
    playMode: 'section',
    follow: true,
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
    chordStamp: 'off',
    ghosts: true,

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
      resetEditing({ selectedTrackId: project.tracks[0]?.id ?? '', selectedSectionId: project.arrangement[0] ?? project.sections[0].id });
    },
    newProject: () => {
      const a = makeSection('A', 0, 8);
      get().setProject({ version: 2, bpm: 120, sections: [a], arrangement: [a.id], tracks: [makeTrack({ name: 'Track 1' }, [a], 0)] });
    },

    setBpm: (bpm) => commit({ ...get().project, bpm }),
    setBars: (bars) => setSection({ ...section(), bars: Math.max(1, Math.min(512, Math.round(bars))) }),
    setMeter: (bar, meter) => {
      const sec = section();
      let meters: MeterChange[] = sec.meters.filter((m) => m.bar !== bar);
      if (meter) meters.push({ bar, ...meter });
      else if (bar === 0) return;
      meters = meters.sort((a, b) => a.bar - b.bar);
      setSection({ ...sec, meters });
    },

    selectSection: (id) => {
      if (id === get().selectedSectionId) return;
      resetEditing({ selectedSectionId: id });
    },
    addSection: () => {
      const p = get().project;
      const cur = section();
      const name = String.fromCharCode(65 + (p.sections.length % 26));
      const next = makeSection(name, p.sections.length, cur.bars, [{ ...cur.meters[0], bar: 0 }]);
      commit({ ...p, sections: [...p.sections, next], arrangement: [...p.arrangement, next.id] });
      resetEditing({ selectedSectionId: next.id });
    },
    duplicateSection: (id) => {
      const p = get().project;
      const src = findSection(p, id);
      const copy: Section = { ...src, id: uid(), name: `${src.name} 2`, color: SECTION_COLORS[p.sections.length % SECTION_COLORS.length] };
      const tracks = p.tracks.map((t) =>
        t.clips[src.id] ? { ...t, clips: { ...t.clips, [copy.id]: { ...t.clips[src.id], notes: withIds(t.clips[src.id].notes) } } } : t,
      );
      const at = p.arrangement.lastIndexOf(src.id);
      const arrangement = [...p.arrangement];
      arrangement.splice(at < 0 ? arrangement.length : at + 1, 0, copy.id);
      commit({ ...p, sections: [...p.sections, copy], arrangement, tracks });
      resetEditing({ selectedSectionId: copy.id });
    },
    renameSection: (id, name) => {
      const p = get().project;
      commit({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)) });
    },
    removeSection: (id) => {
      const p = get().project;
      if (p.sections.length < 2) return;
      const sections = p.sections.filter((s) => s.id !== id);
      const tracks = p.tracks.map((t) => {
        const { [id]: _removed, ...clips } = t.clips;
        return { ...t, clips };
      });
      commit({ ...p, sections, arrangement: p.arrangement.filter((a) => a !== id), tracks });
      if (get().selectedSectionId === id) resetEditing({ selectedSectionId: sections[0].id });
    },
    arrangeAppend: (sectionId) => {
      const p = get().project;
      commit({ ...p, arrangement: [...p.arrangement, sectionId] });
    },
    arrangeRemove: (index) => {
      const p = get().project;
      commit({ ...p, arrangement: p.arrangement.filter((_, i) => i !== index) });
    },
    arrangeMove: (from, to) => {
      const p = get().project;
      const arrangement = [...p.arrangement];
      const [moved] = arrangement.splice(from, 1);
      arrangement.splice(Math.max(0, Math.min(arrangement.length, to)), 0, moved);
      commit({ ...p, arrangement });
    },

    addTrack: (kind) => {
      const p = get().project;
      const t = makeTrack(
        kind === 'kit' ? { name: 'Kit', kind, lanes: defaultLanes(uid), output: { type: 'kit' } } : { name: `Track ${p.tracks.length + 1}` },
        p.sections,
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
      mapTrack(trackId, (t) => regen({ ...t, lanes: [lane, ...t.lanes!] }, get().project.sections));
      return lane.id;
    },
    updateLane: (trackId, lane) => {
      const t = get().project.tracks.find((t) => t.id === trackId);
      const old = t?.lanes?.find((l) => l.id === lane.id);
      if (!t || !old) return 'Lane not found';
      const conflict = laneConflict(t.lanes!, lane);
      if (conflict) return conflict;
      mapTrack(trackId, (t) => {
        const lanes = t.lanes!.map((l) => (l.id === lane.id ? lane : l));
        const moved = lane.note === old.note ? t : mapNotes(t, (ns) => ns.map((n) => (n.pitch === old.note ? { ...n, pitch: lane.note } : n)));
        return regen({ ...moved, lanes }, get().project.sections);
      });
      return undefined;
    },
    removeLane: (trackId, laneId) =>
      mapTrack(trackId, (t) => {
        const lane = t.lanes?.find((l) => l.id === laneId);
        if (!lane) return t;
        const cleared = mapNotes(t, (ns) => ns.filter((n) => n.pitch !== lane.note));
        return regen({ ...cleared, lanes: t.lanes!.filter((l) => l.id !== laneId) }, get().project.sections);
      }),
    moveLane: (trackId, laneId, dir) =>
      mapTrack(trackId, (t) => {
        const lanes = [...(t.lanes ?? [])];
        const i = lanes.findIndex((l) => l.id === laneId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= lanes.length) return t;
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
        return regen({ ...t, lanes }, get().project.sections);
      }),
    applyKitPreset: (trackId, bank) =>
      mapTrack(trackId, (t) => {
        let lanes = t.lanes ?? [];
        for (const lane of lanes) {
          if (!isStandardDrum(parseSample(lane.sample).s) || lane.bank === bank) continue;
          const next = { ...lane, bank };
          if (!laneConflict(lanes, next)) lanes = lanes.map((l) => (l.id === lane.id ? next : l));
        }
        return regen({ ...t, lanes }, get().project.sections);
      }),
    removeTrack: (id) => {
      const p = get().project;
      const tracks = p.tracks.filter((t) => t.id !== id);
      commit({ ...p, tracks });
      if (get().selectedTrackId === id) set({ selectedTrackId: tracks[0]?.id ?? '', selection: new Set() });
    },
    updateTrack: (id, patch, history = true) => mapTrack(id, (t) => ({ ...t, ...patch }), history),
    setNotes: (id, notes, history = true, sectionId) =>
      mapClip(id, (clip, t, sec) => regenClip(t, { ...clip, mode: 'grid', notes }, sec), history, sectionId),
    setCode: (id, code, sectionId) => {
      const sec = sectionId ? findSection(get().project, sectionId) : section();
      mapTrack(id, (t) => {
        const clip = clipOf(t, sec.id);
        if (clip.code === code) return t;
        const put = (next: Clip, lanes = t.lanes): Track => ({ ...t, lanes, clips: { ...t.clips, [sec.id]: next } });
        const c = compileCached(code);
        if (!c.ok) return put({ ...clip, code });
        const { length } = sectionInfo(sec);
        if (t.kind === 'kit' && isGridCode(code, 'kit')) {
          const lanes = mergeLanes(t.lanes ?? [], kitSounds(c.pattern, length));
          return put({ code, mode: 'grid', notes: withIds(hapsToNotes(c.pattern, length, kitPitch(lanes))) }, lanes);
        }
        if (t.kind === 'notes' && isGridCode(code) && fitsGrid(c.pattern, length, notePitch)) {
          return put({ code, mode: 'grid', notes: withIds(hapsToNotes(c.pattern, length)) });
        }
        return put({ code, mode: 'code', notes: [] });
      });
    },
    bake: (id) => {
      const s = get();
      const t = s.project.tracks.find((t) => t.id === id);
      if (!t) return;
      const sec = section();
      const c = trackPattern(trackView(t, sec.id));
      if (!c) return;
      const { length } = sectionInfo(sec);
      const kind = t.kind === 'kit' ? 'kit' : detectKind(c.pattern, length);
      const lanes = kind === 'kit' ? mergeLanes(t.lanes ?? [], kitSounds(c.pattern, length)) : undefined;
      const notes = withIds(hapsToNotes(c.pattern, length, lanes ? kitPitch(lanes) : notePitch));
      const output: Output =
        kind === 'kit' && t.output.type !== 'kit' && t.output.type !== 'midi'
          ? { type: 'kit' }
          : kind === 'notes' && t.output.type === 'kit'
            ? { type: 'synth', sound: 'gm_epiano1' }
            : t.output;
      s.checkpoint();
      mapTrack(
        id,
        (t) => {
          const changed = { ...t, kind, output, lanes };
          return regen({ ...changed, clips: { ...t.clips, [sec.id]: { ...clipOf(t, sec.id), mode: 'grid', notes } } }, get().project.sections);
        },
        false,
      );
    },

    setScale: (scale) => commit({ ...get().project, scale }),
    quantize: (trackId, ids) => {
      const { snap, quantizeStrength } = get();
      if (snap === 1) return;
      mapClip(trackId, (clip, t, sec) => {
        if (clip.mode !== 'grid') return clip;
        const { bars } = sectionInfo(sec);
        const notes = clip.notes.map((n) => {
          if (ids.size && !ids.has(n.id)) return n;
          const target = snapTick(n.start, snap, bars, 'round');
          return { ...n, start: Math.max(0, Math.round(n.start + (target - n.start) * quantizeStrength)) };
        });
        return regenClip(t, { ...clip, notes }, sec);
      });
    },

    transformNotes: (trackId, fn) => {
      const { selection } = get();
      let selected: string[] = [];
      mapClip(trackId, (clip, t, sec) => {
        if (clip.mode !== 'grid') return clip;
        const chosen = selection.size ? clip.notes.filter((n) => selection.has(n.id)) : clip.notes;
        if (!chosen.length) return clip;
        const ids = new Set(chosen.map((n) => n.id));
        const { length } = sectionInfo(sec);
        const result = fn(chosen).filter((n) => n.start < length && n.pitch >= 0 && n.pitch <= 127);
        selected = result.map((n) => n.id);
        return regenClip(t, { ...clip, notes: [...clip.notes.filter((n) => !ids.has(n.id)), ...result] }, sec);
      });
      set({ selection: new Set(selected) });
    },
    euclidFill: (trackId, pitch, hits, steps, rotate, stepTicks) =>
      mapClip(trackId, (clip, t, sec) => {
        const { length } = sectionInfo(sec);
        const pattern = euclid(hits, steps, rotate);
        const vel = get().velocity;
        const notes: Note[] = [];
        for (let i = 0, start = 0; start < length; i++, start += stepTicks) {
          if (pattern[i % steps]) notes.push({ id: uid(), pitch, start, dur: Math.min(stepTicks, length - start), vel });
        }
        const kept = clip.mode === 'grid' ? clip.notes.filter((n) => n.pitch !== pitch) : [];
        return regenClip(t, { ...clip, mode: 'grid', notes: [...kept, ...notes] }, sec);
      }),
    writeProgression: (trackId, text, length, replace, bassTrackId) => {
      let chords;
      try {
        chords = parseProgression(text, get().project.scale);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      if (!chords.length) return 'Type some chords, e.g. Am F C G or vi IV I V';
      const sec = section();
      const { bars, length: total } = sectionInfo(sec);
      // chord slots across the section
      const slots: { start: number; dur: number }[] = [];
      if ('bars' in length) {
        for (let b = 0; b < bars.length; b += length.bars) {
          const last = bars[Math.min(b + length.bars, bars.length) - 1];
          slots.push({ start: bars[b].start, dur: last.start + last.length - bars[b].start });
        }
      } else {
        for (let t = 0; t < total; t += (length.beats * TPW) / 4) slots.push({ start: t, dur: Math.min((length.beats * TPW) / 4, total - t) });
      }
      const sequence = slots.map((_, i) => chords[i % chords.length]);
      const voiced = voiceLead(sequence);
      const vel = get().velocity;
      const chordNotes: Note[] = slots.flatMap((slot, i) => voiced[i].map((pitch) => ({ id: uid(), pitch, start: slot.start, dur: slot.dur, vel })));
      const bassNotes: Note[] = slots.map((slot, i) => ({ id: uid(), pitch: bassNote(sequence[i]), start: slot.start, dur: slot.dur, vel }));
      get().checkpoint();
      const write = (id: string, notes: Note[]) =>
        mapClip(
          id,
          (clip, t) => regenClip(t, { ...clip, mode: 'grid', notes: replace || clip.mode !== 'grid' ? notes : [...clip.notes, ...notes] }, sec),
          false,
        );
      write(trackId, chordNotes);
      if (bassTrackId) write(bassTrackId, bassNotes);
      set({ selection: new Set(chordNotes.map((n) => n.id)) });
      return undefined;
    },
    addModifier: (trackId, type) =>
      mapTrack(trackId, (t) => ({
        ...t,
        modifiers: [...(t.modifiers ?? []), { id: uid(), type, amount: modifierDef(type).default, enabled: true }],
      })),
    updateModifier: (trackId, id, patch, history = true) =>
      mapTrack(trackId, (t) => ({ ...t, modifiers: (t.modifiers ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)) }), history),
    removeModifier: (trackId, id) => mapTrack(trackId, (t) => ({ ...t, modifiers: (t.modifiers ?? []).filter((m) => m.id !== id) })),

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

type StoreState = ReturnType<typeof useStore.getState>;

export const selectedSection = (s: StoreState) => findSection(s.project, s.selectedSectionId);

/** Bars and length of the section being edited. */
export const editInfo = (s: StoreState) => sectionInfo(selectedSection(s));

export const songTimeline = (p: Project) => timeline(p.sections, p.arrangement);

/** The selected track seen through the selected section's clip. */
export const selectedTrack = (s: StoreState): TrackView | undefined => {
  const t = s.project.tracks.find((t) => t.id === s.selectedTrackId);
  return t && trackView(t, selectedSection(s).id);
};
