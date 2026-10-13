import { useEffect, useState } from 'react';
import { useStore, selectedTrack, uid, editInfo } from './store';
import { initEngine } from './strudel/engine';
import { startSync } from './sync';
import { Transport, togglePlay } from './components/Transport';
import { TrackList } from './components/TrackList';
import { PianoRoll, preview, snapLength } from './components/PianoRoll';
import { CodePanel } from './components/CodePanel';
import { RollToolbar } from './components/RollToolbar';
import { ArrangementBar } from './components/ArrangementBar';
import { CollapsedBar, Splitter, usePane } from './components/Panes';
import type { Note } from './music/codegen';
import { rowsFor } from './music/kit';
import { scaleStep } from './music/transforms';
import * as live from './live';
import {
  CHORD_STAMPS,
  CYCLE_CHORD,
  OPEN_CHORDS,
  OPEN_EUCLID,
  OPEN_GENERATE,
  REROLL,
  TOGGLE_CHORD_SNAP,
  ADD_VARIATION,
  variationIndex,
  TRANSFORMS,
  gridStep,
  matches,
  toggleTriplet,
} from './commands';
import { newSeed } from './music/generators';
import { lockedScale } from './live';
import { TPW } from './music/time';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';

let clipboard: Note[] = [];
/** Snap to restore when `\` turns snapping back on. */
let lastSnap = TPW / 16;

function handleKey(e: KeyboardEvent) {
  if (e.target instanceof Element && e.target.closest('input, select, textarea, .cm-editor')) return;
  if (live.handleKeyDown(e)) return;
  const s = useStore.getState();
  const track = selectedTrack(s);
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (e.key === '?') {
    s.set({ showShortcuts: !s.showShortcuts });
    return;
  }
  if (key === 'escape' && (s.showShortcuts || s.popover)) {
    s.set({ showShortcuts: false, popover: null });
    return;
  }
  const plain = !mod && !e.altKey;
  if (plain && (e.key === ',' || e.key === '.')) {
    s.set({ snap: gridStep(s.snap, e.key === ',') });
    return;
  }
  if (plain && e.key === '/') {
    s.set({ snap: toggleTriplet(s.snap === 1 ? lastSnap : s.snap) });
    return;
  }
  if (plain && e.key === '\\') {
    if (s.snap !== 1) lastSnap = s.snap;
    s.set({ snap: s.snap === 1 ? lastSnap : 1 });
    return;
  }
  if (matches(e, CYCLE_CHORD)) {
    e.preventDefault();
    s.set({ chordStamp: CHORD_STAMPS[(CHORD_STAMPS.indexOf(s.chordStamp) + 1) % CHORD_STAMPS.length] });
    return;
  }

  if (key === 'm' && !mod && !e.altKey) {
    live.releaseAll();
    s.set({ keyboard: !s.keyboard });
    return;
  }
  if (key === 'f9') {
    e.preventDefault();
    s.set({ armed: !s.armed });
    return;
  }

  if (key === ' ') {
    e.preventDefault();
    togglePlay();
    return;
  }
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) s.redo();
    else s.undo();
    return;
  }
  if (key === 'b' && !mod) {
    s.set({ draw: !s.draw });
    return;
  }
  if (track && variationIndex(e) >= 0) {
    e.preventDefault();
    s.selectVariation(track.id, variationIndex(e));
    return;
  }
  if (track && matches(e, ADD_VARIATION)) {
    e.preventDefault();
    s.addVariation(track.id);
    return;
  }
  if (!track || track.mode !== 'grid') return;
  const sel = track.notes.filter((n) => s.selection.has(n.id));
  const others = track.notes.filter((n) => !s.selection.has(n.id));

  if (matches(e, OPEN_CHORDS) && track.kind === 'notes') {
    e.preventDefault();
    s.set({ popover: s.popover === 'chords' ? null : 'chords' });
    return;
  }
  if (matches(e, OPEN_GENERATE)) {
    e.preventDefault();
    s.set({ popover: s.popover === 'generate' ? null : 'generate' });
    return;
  }
  if (matches(e, REROLL) && track.generator) {
    e.preventDefault();
    s.generateClip(track.id, { ...track.generator, seed: newSeed() });
    return;
  }
  if (matches(e, TOGGLE_CHORD_SNAP)) {
    e.preventDefault();
    s.set({ chordSnap: !s.chordSnap });
    return;
  }
  if (matches(e, OPEN_EUCLID)) {
    e.preventDefault();
    s.set({ popover: s.popover === 'euclid' ? null : 'euclid' });
    return;
  }
  const transform = TRANSFORMS.find((t) => matches(e, t.combo));
  if (transform) {
    e.preventDefault();
    s.transformNotes(track.id, (notes) => transform.run(notes, s.snap, lockedScale(s)));
    return;
  }
  const mapSel = (fn: (n: Note) => Note) => s.setNotes(track.id, track.notes.map((n) => (s.selection.has(n.id) ? fn(n) : n)));
  if (e.altKey && !mod && (key === 'arrowup' || key === 'arrowdown') && sel.length) {
    e.preventDefault();
    const d = key === 'arrowup' ? 0.1 : -0.1;
    mapSel((n) => ({ ...n, vel: Math.round(Math.max(0.01, Math.min(1, n.vel + d)) * 100) / 100 }));
    return;
  }
  if (e.altKey && !mod && (key === 'arrowleft' || key === 'arrowright') && sel.length) {
    e.preventDefault();
    const d = (key === 'arrowleft' ? -1 : 1) * (TPW / 128);
    if (sel.some((n) => n.start + d < 0)) return;
    mapSel((n) => ({ ...n, start: n.start + d }));
    return;
  }
  if (e.shiftKey && !mod && (key === 'arrowleft' || key === 'arrowright') && sel.length) {
    e.preventDefault();
    const { bars } = editInfo(s);
    const step = s.snap === 1 ? TPW / 16 : snapLength(s.snap, bars, sel[0].start);
    const d = key === 'arrowleft' ? -step : step;
    mapSel((n) => ({ ...n, dur: Math.max(step, n.dur + d) }));
    return;
  }

  if (mod && key === 'a') {
    e.preventDefault();
    s.select(new Set(track.notes.map((n) => n.id)));
  } else if ((key === 'backspace' || key === 'delete') && sel.length) {
    e.preventDefault();
    s.setNotes(track.id, others);
    s.select(new Set());
  } else if (mod && key === 'c' && sel.length) {
    clipboard = sel;
  } else if (mod && key === 'x' && sel.length) {
    clipboard = sel;
    s.setNotes(track.id, others);
    s.select(new Set());
  } else if (mod && key === 'v' && clipboard.length) {
    e.preventDefault();
    const min = Math.min(...clipboard.map((n) => n.start));
    const pasted = clipboard.map((n) => ({ ...n, id: uid(), start: n.start - min + s.cursor }));
    s.setNotes(track.id, [...track.notes, ...pasted]);
    s.select(new Set(pasted.map((n) => n.id)));
  } else if (mod && key === 'd' && sel.length) {
    e.preventDefault();
    const min = Math.min(...sel.map((n) => n.start));
    const max = Math.max(...sel.map((n) => n.start + n.dur));
    const copies = sel.map((n) => ({ ...n, id: uid(), start: n.start + max - min }));
    s.setNotes(track.id, [...track.notes, ...copies]);
    s.select(new Set(copies.map((n) => n.id)));
  } else if ((key === 'arrowup' || key === 'arrowdown') && sel.length) {
    e.preventDefault();
    const rows = rowsFor(track);
    const d = (key === 'arrowup' ? -1 : 1) * (e.shiftKey && track.kind === 'notes' ? 12 : 1);
    const scale = s.project.scale;
    const shift = (p: number) =>
      track.kind === 'notes' && scale && !e.shiftKey ? scaleStep(p, -d, scale) : rows[rows.indexOf(p) + d];
    if (sel.some((n) => shift(n.pitch) === undefined)) return;
    s.setNotes(track.id, track.notes.map((n) => (s.selection.has(n.id) ? { ...n, pitch: shift(n.pitch) } : n)));
    preview(track, shift(sel[0].pitch), sel[0].vel);
  } else if ((key === 'arrowleft' || key === 'arrowright') && sel.length) {
    e.preventDefault();
    const { bars } = editInfo(s);
    const step = snapLength(s.snap, bars, sel[0].start) * (key === 'arrowleft' ? -1 : 1);
    if (sel.some((n) => n.start + step < 0)) return;
    s.setNotes(track.id, track.notes.map((n) => (s.selection.has(n.id) ? { ...n, start: n.start + step } : n)));
  } else if (mod && key === 'u') {
    e.preventDefault();
    s.quantize(track.id, s.selection);
  } else if (key === 'escape') {
    s.select(new Set());
  }
}

export function App() {
  const ready = useStore((s) => s.ready);
  const [error, setError] = useState<string>();
  const [tracks, setTracks] = usePane('tracks', { width: 250, collapsed: false });
  const [code, setCode] = usePane('code', { width: 460, collapsed: false });

  useEffect(() => {
    initEngine()
      .then(() => {
        startSync();
        useStore.getState().set({ ready: true });
      })
      .catch((e) => setError(String(e)));
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', live.handleKeyUp);
    window.addEventListener('blur', live.releaseAll);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', live.handleKeyUp);
      window.removeEventListener('blur', live.releaseAll);
    };
  }, []);

  if (error) return <div className="loading error">Failed to start Strudel: {error}</div>;
  if (!ready) return <div className="loading">Loading Strudel…</div>;

  return (
    <div className="app">
      <Transport />
      <ShortcutsOverlay />
      <div className="main">
        {tracks.collapsed ? (
          <CollapsedBar label="Tracks" side="left" onExpand={() => setTracks({ collapsed: false })} />
        ) : (
          <>
            <div className="pane" style={{ width: tracks.width }}>
              <TrackList onCollapse={() => setTracks({ collapsed: true })} />
            </div>
            <Splitter
              side="left"
              width={tracks.width}
              min={190}
              max={480}
              onResize={(width) => setTracks({ width })}
              onCollapse={() => setTracks({ collapsed: true })}
            />
          </>
        )}
        <div className="editor-col">
          <ArrangementBar />
          <RollToolbar />
          <PianoRoll />
        </div>
        {code.collapsed ? (
          <CollapsedBar label="Code" side="right" onExpand={() => setCode({ collapsed: false })} />
        ) : (
          <>
            <Splitter
              side="right"
              width={code.width}
              min={280}
              max={Math.max(320, window.innerWidth - (tracks.collapsed ? 0 : tracks.width) - 320)}
              onResize={(width) => setCode({ width })}
              onCollapse={() => setCode({ collapsed: true })}
            />
            <div className="pane" style={{ width: code.width }}>
              <CodePanel onCollapse={() => setCode({ collapsed: true })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
