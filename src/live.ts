import { useStore, selectedTrack, editInfo, findSection, trackView, uid, type Track } from './store';
import { locateRaw } from './sync';
import { sectionInfo } from './music/arrangement';
import { engine, listenMidiInputs } from './strudel/engine';
import { laneValue } from './music/kit';
import { snapLength, snapTick, TPW } from './music/time';
import type { Note } from './music/codegen';

/** Ableton-style computer keyboard: A = C, W = C#, … ; = E an octave up. */
export const PIANO_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';'];

/** Recorded timing resolution: 1/128 note keeps generated code readable without audible loss. */
const REC_GRID = TPW / 128;
const toGrid = (ticks: number) => Math.round(ticks / REC_GRID) * REC_GRID;

/** How long monitored notes ring with built-in sounds, which can't be released early. */
const MONITOR_SECONDS = { notes: 0.6, kit: 1 };

interface Held {
  trackId: string;
  pitch: number;
  vel: number;
  /** rawNow() at note-on while playing. */
  startRaw?: number;
  /** Section and tick inside it at note-on while playing. */
  sectionId?: string;
  startTick?: number;
  /** Id of the note being recorded. */
  recId?: string;
  step?: boolean;
}

interface Played {
  trackId: string;
  pitch: number;
  vel: number;
  startRaw: number;
  endRaw: number;
  sectionId: string;
  startTick: number;
}

const held = new Map<string, Held>();
/** Recently played notes that were not recorded, for Capture. */
let played: Played[] = [];
let takeCheckpointed = false;
let stepLen = 0;

const listeners = new Set<() => void>();
export const onLiveChange = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const changed = () => listeners.forEach((cb) => cb());

export const capturable = () => {
  const id = useStore.getState().selectedTrackId;
  return played.filter((p) => p.trackId === id).length;
};

/** Pitch played by keyboard key index `i` on `track`: chromatic from the octave, or kit lanes bottom-up. */
function keyPitch(track: Track, i: number): number | undefined {
  if (track.kind === 'kit') {
    const lanes = track.lanes ?? [];
    return lanes[lanes.length - 1 - i]?.note;
  }
  const pitch = 12 * (useStore.getState().octave + 1) + i;
  return pitch <= 127 ? pitch : undefined;
}

function monitor(track: Track, pitch: number, vel: number) {
  if (track.output.type === 'midi') return engine.midiNoteOn(track.output, pitch, vel);
  const value =
    track.kind === 'kit'
      ? (() => {
          const lane = track.lanes?.find((l) => l.note === pitch);
          return lane ? { ...laneValue(lane), velocity: vel } : undefined;
        })()
      : { note: pitch, velocity: vel };
  if (value) engine.preview({ ...value, postgain: track.gain }, track.output, MONITOR_SECONDS[track.kind]);
}

const isPlayable = (track: Track, pitch: number) => track.kind !== 'kit' || !!track.lanes?.some((l) => l.note === pitch);

export function noteOn(id: string, pitch: number, vel: number) {
  const s = useStore.getState();
  const track = selectedTrack(s);
  if (!track || held.has(id) || !isPlayable(track, pitch)) return;
  monitor(track, pitch, vel);

  const h: Held = { trackId: track.id, pitch, vel };
  const raw = engine.rawNow();
  const { bars, length } = editInfo(s);
  const at = raw !== undefined && raw >= 0 ? locateRaw(raw) : undefined;

  if (raw !== undefined && at) {
    h.startRaw = raw;
    h.sectionId = at.sectionId;
    h.startTick = toGrid(at.tick);
    const clip = trackView(track, at.sectionId);
    if (s.armed && clip.mode === 'grid') {
      if (!takeCheckpointed) {
        s.checkpoint();
        takeCheckpointed = true;
      }
      const note: Note = { id: uid(), pitch, start: h.startTick, dur: TPW / 16, vel };
      h.recId = note.id;
      s.setNotes(track.id, [...clip.notes, note], false, at.sectionId);
    }
  } else if (raw === undefined && s.armed && track.mode === 'grid') {
    // step input: notes held together form a chord at the cursor
    const chordOpen = [...held.values()].some((x) => x.step);
    if (!chordOpen) {
      s.checkpoint();
      stepLen = s.snap > 1 || s.snap === 0 ? snapLength(s.snap, bars, s.cursor) : TPW / 16;
    }
    if (s.cursor < length) {
      const fresh = selectedTrack(useStore.getState())!;
      const note: Note = { id: uid(), pitch, start: s.cursor, dur: stepLen, vel };
      s.setNotes(track.id, [...fresh.notes.filter((n) => !(n.pitch === pitch && n.start === s.cursor)), note], false);
    }
    h.step = true;
  }
  held.set(id, h);
}

export function noteOff(id: string) {
  const h = held.get(id);
  if (!h) return;
  held.delete(id);
  const s = useStore.getState();
  const track = s.project.tracks.find((t) => t.id === h.trackId);
  if (track) engine.midiNoteOff(track.output, h.pitch);

  const raw = engine.rawNow();
  if (h.recId && track && h.sectionId && raw !== undefined && h.startRaw !== undefined) {
    const { bars } = sectionInfo(findSection(s.project, h.sectionId));
    const dur = Math.max(REC_GRID, toGrid((raw - h.startRaw) * TPW));
    s.setNotes(
      track.id,
      trackView(track, h.sectionId).notes.map((n) => {
        if (n.id !== h.recId) return n;
        const start = s.inputQuantize && s.snap !== 1 ? snapTick(n.start, s.snap, bars, 'round') : n.start;
        return { ...n, start, dur };
      }),
      false,
      h.sectionId,
    );
  } else if (raw !== undefined && h.startRaw !== undefined && h.startTick !== undefined && h.sectionId) {
    played.push({
      trackId: h.trackId,
      pitch: h.pitch,
      vel: h.vel,
      startRaw: h.startRaw,
      endRaw: raw,
      sectionId: h.sectionId,
      startTick: h.startTick,
    });
    if (played.length > 2000) played = played.slice(-1000);
    changed();
  }

  if (h.step && ![...held.values()].some((x) => x.step)) {
    const { length } = editInfo(s);
    s.set({ cursor: Math.min(length, s.cursor + stepLen) });
  }
}

export function releaseAll() {
  for (const id of [...held.keys()]) noteOff(id);
}

/** Called when playback starts: the next recorded note opens a new undo step. */
export function startTake() {
  takeCheckpointed = false;
}

/**
 * Turns what was just played on the selected track (but not recorded) into notes: everything within
 * one loop length before the latest note.
 */
export function capture(): number {
  const s = useStore.getState();
  const track = s.project.tracks.find((t) => t.id === s.selectedTrackId);
  if (!track) return 0;
  const mine = played.filter((p) => p.trackId === track.id);
  if (!mine.length) return 0;
  const anchor = engine.rawNow() ?? Math.max(...mine.map((p) => p.endRaw));
  const from = anchor - engine.loop.len;
  const picked = mine.filter((p) => p.startRaw >= from && trackView(track, p.sectionId).mode === 'grid');
  if (!picked.length) return 0;
  s.checkpoint();
  const added: string[] = [];
  for (const sectionId of new Set(picked.map((p) => p.sectionId))) {
    const { bars } = sectionInfo(findSection(s.project, sectionId));
    const notes: Note[] = picked
      .filter((p) => p.sectionId === sectionId)
      .map((p) => {
        const start = s.inputQuantize && s.snap !== 1 ? snapTick(p.startTick, s.snap, bars, 'round') : p.startTick;
        return { id: uid(), pitch: p.pitch, start, dur: Math.max(REC_GRID, toGrid((p.endRaw - p.startRaw) * TPW)), vel: p.vel };
      });
    const current = useStore.getState().project.tracks.find((t) => t.id === track.id)!;
    s.setNotes(track.id, [...trackView(current, sectionId).notes, ...notes], false, sectionId);
    added.push(...notes.map((n) => n.id));
  }
  s.select(new Set(added));
  played = played.filter((p) => p.trackId !== track.id);
  changed();
  return added.length;
}

/** Computer keyboard handling; returns true when the key was used for playing. */
export function handleKeyDown(e: KeyboardEvent): boolean {
  const s = useStore.getState();
  if (!s.keyboard || e.metaKey || e.ctrlKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  const i = PIANO_KEYS.indexOf(key);
  if (i >= 0) {
    e.preventDefault();
    if (e.repeat) return true;
    const track = selectedTrack(s);
    const pitch = track && keyPitch(track, i);
    if (pitch !== undefined) noteOn(`kb:${key}`, pitch, s.velocity);
    return true;
  }
  if (key === 'z' || key === 'x') {
    e.preventDefault();
    releaseAll();
    s.set({ octave: Math.max(0, Math.min(8, s.octave + (key === 'z' ? -1 : 1))) });
    return true;
  }
  if (key === 'c' || key === 'v') {
    e.preventDefault();
    s.set({ velocity: Math.round(Math.max(0.05, Math.min(1, s.velocity + (key === 'c' ? -0.1 : 0.1))) * 100) / 100 });
    return true;
  }
  return false;
}

export function handleKeyUp(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  if (PIANO_KEYS.includes(key)) noteOff(`kb:${key}`);
}

let midiListening = false;
export function listenMidi() {
  if (midiListening) return;
  midiListening = true;
  listenMidiInputs((on, note, velocity) => (on ? noteOn(`midi:${note}`, note, velocity) : noteOff(`midi:${note}`)));
}
