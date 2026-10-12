import { useState } from 'react';
import { useStore, selectedTrack, uid, type TrackView } from '../store';
import { SNAPS, TPW } from '../music/time';
import { MODES, ROOTS } from '../music/scale';
import { arpeggiate, humanize, invert, legato, reverse, stretch, strum, type ArpDirection } from '../music/transforms';
import { laneLabel } from '../music/kit';
import { pitchLabel, type Note } from '../music/codegen';
import type { ChordStamp } from '../music/chords';

const stepTicks = (snap: number) => (snap > 1 ? snap : TPW / 16);

const TRANSFORMS: { label: string; run: (notes: Note[], snap: number) => Note[] }[] = [
  { label: 'Reverse', run: (n) => reverse(n) },
  { label: 'Invert', run: (n) => invert(n) },
  { label: 'Double speed', run: (n) => stretch(n, 0.5) },
  { label: 'Half speed', run: (n) => stretch(n, 2) },
  { label: 'Legato', run: (n) => legato(n) },
  { label: 'Strum', run: (n) => strum(n, TPW / 96) },
  { label: 'Humanize', run: (n) => humanize(n, TPW / 128, 0.08) },
  ...(['up', 'down', 'updown'] as ArpDirection[]).map((dir) => ({
    label: `Arpeggiate ${dir === 'up' ? '↑' : dir === 'down' ? '↓' : '↕'}`,
    run: (n: Note[], snap: number) => arpeggiate(n, stepTicks(snap), dir, uid),
  })),
];

const CHORD_LENGTHS: { label: string; value: { bars: number } | { beats: number } }[] = [
  { label: '1 bar each', value: { bars: 1 } },
  { label: '2 bars each', value: { bars: 2 } },
  { label: '1/2 bar each', value: { beats: 2 } },
  { label: '1 beat each', value: { beats: 1 } },
];

function ChordsPopover({ track, onClose }: { track: TrackView; onClose: () => void }) {
  const s = useStore();
  const [text, setText] = useState(() => localStorage.getItem('music-composer:last-progression') ?? 'Am F C G');
  const [len, setLen] = useState(0);
  const [replace, setReplace] = useState(true);
  const [bass, setBass] = useState('');
  const [error, setError] = useState<string>();
  const others = s.project.tracks.filter((t) => t.id !== track.id && t.kind === 'notes');
  const key = s.project.scale;
  const apply = () => {
    const err = s.writeProgression(track.id, text, CHORD_LENGTHS[len].value, replace, bass || undefined);
    setError(err);
    if (!err) {
      try {
        localStorage.setItem('music-composer:last-progression', text);
      } catch {
        /* not persisted */
      }
      onClose();
    }
  };
  return (
    <div className="popover chords" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="popover-title">Chord progression</div>
      <input
        value={text}
        autoFocus
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder="Am F C G  ·  vi IV I V  ·  Dm7 G7 Cmaj7"
      />
      <div className="hint">
        Letter chords (Am7, F/C, Bbmaj7) or Roman numerals in {key ? `${ROOTS[key.root]} (from Scale)` : 'C (set a Scale to change key)'}. Repeats to
        fill the section, voice-led.
      </div>
      <div className="row">
        <select value={len} onChange={(e) => setLen(+e.target.value)}>
          {CHORD_LENGTHS.map((l, i) => (
            <option key={l.label} value={i}>
              {l.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace notes
        </label>
      </div>
      <label>
        Bass line to
        <select value={bass} onChange={(e) => setBass(e.target.value)}>
          <option value="">— none —</option>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="primary" onClick={apply}>
          Write chords
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function EuclidPopover({ track, onClose }: { track: TrackView; onClose: () => void }) {
  const s = useStore();
  const lanes = track.kind === 'kit' ? track.lanes ?? [] : [];
  const firstSelected = track.notes.find((n) => s.selection.has(n.id));
  const [pitch, setPitch] = useState(firstSelected?.pitch ?? lanes[lanes.length - 1]?.note ?? 60);
  const [hits, setHits] = useState(3);
  const [steps, setSteps] = useState(8);
  const [rotate, setRotate] = useState(0);
  const step = stepTicks(s.snap);
  return (
    <div className="popover euclid" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="popover-title">Euclidean rhythm</div>
      <label>
        {track.kind === 'kit' ? 'Lane' : 'Pitch'}
        {track.kind === 'kit' ? (
          <select value={pitch} onChange={(e) => setPitch(+e.target.value)}>
            {lanes.map((l) => (
              <option key={l.id} value={l.note}>
                {laneLabel(l)}
              </option>
            ))}
          </select>
        ) : (
          <span className="row">
            <input type="number" min={0} max={127} value={pitch} onChange={(e) => setPitch(Math.max(0, Math.min(127, +e.target.value)))} />
            <span className="hint">{pitchLabel(pitch)}</span>
          </span>
        )}
      </label>
      <div className="row">
        <label>
          Hits
          <input type="number" min={0} max={steps} value={hits} onChange={(e) => setHits(Math.max(0, Math.min(steps, +e.target.value)))} />
        </label>
        <label>
          Steps
          <input type="number" min={1} max={64} value={steps} onChange={(e) => setSteps(Math.max(1, Math.min(64, +e.target.value)))} />
        </label>
        <label>
          Rotate
          <input type="number" min={0} max={steps - 1} value={rotate} onChange={(e) => setRotate(+e.target.value)} />
        </label>
      </div>
      <div className="hint">
        Steps are one grid step ({SNAPS.find((o) => o.ticks === step)?.label ?? '1/16'}), repeated through the section. Replaces that{' '}
        {track.kind === 'kit' ? 'lane' : 'pitch'} — like Strudel's <code>x({hits},{steps})</code>.
      </div>
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            s.euclidFill(track.id, pitch, hits, steps, rotate, step);
            onClose();
          }}
        >
          Fill
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export function RollToolbar() {
  const s = useStore();
  const track = selectedTrack(s);
  const scale = s.project.scale;
  const editable = track?.mode === 'grid';
  const [euclidOpen, setEuclidOpen] = useState(false);
  const [chordsOpen, setChordsOpen] = useState(false);

  return (
    <div className="roll-toolbar">
      <label>
        Snap
        <select value={s.snap} onChange={(e) => s.set({ snap: +e.target.value })}>
          {SNAPS.map((o) => (
            <option key={o.label} value={o.ticks}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button className={`toggle-btn ${s.draw ? 'on' : ''}`} onClick={() => s.set({ draw: !s.draw })} title="Draw mode (B): drag to paint notes, drag over notes to erase, ⌥ to paint across pitches">
        ✎ Draw
      </button>
      <button className={`toggle-btn ${s.fold ? 'on' : ''}`} onClick={() => s.set({ fold: !s.fold })} title="Fold: show only rows with notes (and scale rows)">
        Fold
      </button>
      <button className={`toggle-btn ${s.ghosts ? 'on' : ''}`} onClick={() => s.set({ ghosts: !s.ghosts })} title="Show other instrument tracks' notes faintly">
        Ghosts
      </button>
      <span className="sep" />
      <label title="Scale highlighting">
        Scale
        <select
          value={scale ? scale.root : ''}
          onChange={(e) => s.setScale(e.target.value === '' ? undefined : { root: +e.target.value, mode: scale?.mode ?? 'major' })}
        >
          <option value="">—</option>
          {ROOTS.map((r, i) => (
            <option key={r} value={i}>
              {r}
            </option>
          ))}
        </select>
        {scale && (
          <select value={scale.mode} onChange={(e) => s.setScale({ ...scale, mode: e.target.value })}>
            {Object.keys(MODES).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        )}
      </label>
      {track?.kind === 'notes' && (
        <>
          <label title="Drawn notes become chords: diatonic when a Scale is set">
            Chord
            <select value={s.chordStamp} onChange={(e) => s.set({ chordStamp: e.target.value as ChordStamp })}>
              <option value="off">off</option>
              <option value="triad">triad</option>
              <option value="seventh">7th</option>
              <option value="sus4">sus4</option>
            </select>
          </label>
          <span className="anchor">
            <button disabled={track.mode === 'code'} onClick={() => setChordsOpen(!chordsOpen)} title="Write a chord progression into this section">
              Chords…
            </button>
            {chordsOpen && <ChordsPopover track={track} onClose={() => setChordsOpen(false)} />}
          </span>
        </>
      )}
      <span className="sep" />
      <button
        disabled={!editable || s.snap === 1}
        onClick={() => track && s.quantize(track.id, s.selection)}
        title="Quantize selected notes (all notes if none selected) to the snap grid (⌘U)"
      >
        Quantize
      </button>
      <select value={s.quantizeStrength} onChange={(e) => s.set({ quantizeStrength: +e.target.value })} title="Quantize strength">
        {[1, 0.75, 0.5, 0.25].map((q) => (
          <option key={q} value={q}>
            {q * 100}%
          </option>
        ))}
      </select>
      <select
        value=""
        disabled={!editable || !track?.notes.length}
        onChange={(e) => {
          const t = TRANSFORMS[+e.target.value];
          if (t && track) s.transformNotes(track.id, (notes) => t.run(notes, s.snap));
        }}
        title="Transform the selected notes (all notes if none selected)"
      >
        <option value="">Transform…</option>
        {TRANSFORMS.map((t, i) => (
          <option key={t.label} value={i}>
            {t.label}
          </option>
        ))}
      </select>
      <span className="anchor">
        <button disabled={!track || track.mode === 'code'} onClick={() => setEuclidOpen(!euclidOpen)} title="Write a Euclidean rhythm">
          Euclid…
        </button>
        {euclidOpen && track && <EuclidPopover track={track} onClose={() => setEuclidOpen(false)} />}
      </span>
    </div>
  );
}
