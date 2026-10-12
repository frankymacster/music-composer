import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, laneConflict, type TrackView as Track } from '../store';
import { DRUM_BANKS, type KitLane } from '../music/kit';
import { availableSounds } from '../strudel/engine';
import { pitchLabel } from '../music/codegen';
import { preview } from './PianoRoll';

export function LaneEditor({ track, laneId, top, left, onClose }: { track: Track; laneId: string; top: number; left: number; onClose: () => void }) {
  const lanes = track.lanes ?? [];
  const index = lanes.findIndex((l) => l.id === laneId);
  const lane = lanes[index];
  const [draft, setDraft] = useState<KitLane | undefined>(lane);
  const [error, setError] = useState<string>();
  const sounds = useMemo(() => availableSounds(), []);
  const { updateLane, removeLane, moveLane } = useStore.getState();
  const sampleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // after the opening pointer event has finished moving focus
    const raf = requestAnimationFrame(() => sampleRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [laneId]);

  useEffect(() => setDraft(lane), [lane]);
  if (!lane || !draft) return null;

  const hits = Object.values(track.clips).flatMap((c) => c.notes).filter((n) => n.pitch === lane.note).length;
  const commit = (next: KitLane) => {
    setDraft(next);
    const err = laneConflict(lanes, next);
    setError(err);
    if (!err) updateLane(track.id, next);
  };

  return (
    <div className="popover lane-editor" style={{ left, top: Math.max(40, Math.min(top, window.innerHeight - 420)) }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="popover-title">Lane</div>
      <label>
        Name
        <input value={draft.name} placeholder={draft.sample} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => commit(draft)} />
      </label>
      <label>
        Sample
        <input
          ref={sampleRef}
          list="lane-sounds"
          value={draft.sample}
         
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, sample: e.target.value.trim() })}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
        />
        <datalist id="lane-sounds">
          {sounds.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label>
        Bank
        <select value={draft.bank} onChange={(e) => commit({ ...draft, bank: e.target.value })}>
          <option value="">— none —</option>
          {DRUM_BANKS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label>
        MIDI note
        <span className="row">
          <input
            type="number"
            min={0}
            max={127}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: Math.round(+e.target.value) })}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
          />
          <span className="hint">{pitchLabel(Math.max(0, Math.min(127, draft.note)))}</span>
        </span>
      </label>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button onClick={() => preview(track, lane.note)} title="Preview">
          ▶
        </button>
        <button onClick={() => moveLane(track.id, lane.id, -1)} disabled={index === 0} title="Move up">
          ↑
        </button>
        <button onClick={() => moveLane(track.id, lane.id, 1)} disabled={index === lanes.length - 1} title="Move down">
          ↓
        </button>
        <span className="spacer" />
        <button
          className="danger"
          onClick={() => {
            if (hits && !confirm(`Delete this lane and its ${hits} hit${hits === 1 ? '' : 's'}?`)) return;
            removeLane(track.id, lane.id);
            onClose();
          }}
        >
          Delete
        </button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="hint">Any loaded sample works, e.g. bd, cp:2, arpy:3, RolandTR808_bd.</div>
    </div>
  );
}
