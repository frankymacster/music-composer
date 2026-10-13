import { useState } from 'react';
import { useStore, selectedTrack, type TrackView } from '../store';
import { SNAPS } from '../music/time';
import { MODES, ROOTS } from '../music/scale';
import { TRANSFORMS, stepTicks, OPEN_CHORDS, OPEN_EUCLID, CYCLE_CHORD } from '../commands';
import { laneLabel } from '../music/kit';
import { pitchLabel } from '../music/codegen';
import type { ChordStamp } from '../music/chords';
import { GENERATORS, newSeed, type GeneratorSpec, type GeneratorType } from '../music/generators';
import { TPW } from '../music/time';
import { OPEN_GENERATE, REROLL, TOGGLE_CHORD_SNAP } from '../commands';

const lastSpecs: Partial<Record<GeneratorType, GeneratorSpec>> = {};

export function GeneratePopover({ track, onClose }: { track: TrackView; onClose: () => void }) {
  const s = useStore();
  const types = (Object.keys(GENERATORS) as GeneratorType[]).filter((t) => GENERATORS[t].kinds.includes(track.kind));
  const current = track.generator && types.includes(track.generator.type) ? track.generator : undefined;
  const [spec, setSpec] = useState<GeneratorSpec>(
    () => current ?? lastSpecs[types[0]] ?? { type: types[0], style: GENERATORS[types[0]].styles[0][0], seed: newSeed(), rate: TPW / 16, density: 0.55 },
  );
  const update = (patch: Partial<GeneratorSpec>) => setSpec((x) => ({ ...x, ...patch }));
  const run = (next: GeneratorSpec) => {
    lastSpecs[next.type] = next;
    setSpec(next);
    s.generateClip(track.id, next);
  };
  const chords = s.project.sections.find((x) => x.id === s.selectedSectionId)?.chords?.length ?? 0;
  return (
    <div className="popover generate" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="popover-title">Generate</div>
      <div className="row">
        <select
          value={spec.type}
          onChange={(e) => {
            const type = e.target.value as GeneratorType;
            setSpec(lastSpecs[type] ?? { ...spec, type, style: GENERATORS[type].styles[0][0] });
          }}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {GENERATORS[t].label}
            </option>
          ))}
        </select>
        <select value={spec.style} onChange={(e) => update({ style: e.target.value })}>
          {GENERATORS[spec.type].styles.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {(spec.type === 'arp' || spec.type === 'melody') && (
        <label>
          Rate
          <select value={spec.rate ?? TPW / 16} onChange={(e) => update({ rate: +e.target.value })}>
            <option value={TPW / 8}>1/8</option>
            <option value={TPW / 12}>1/8T</option>
            <option value={TPW / 16}>1/16</option>
          </select>
        </label>
      )}
      {spec.type === 'melody' && (
        <label>
          Density {Math.round((spec.density ?? 0.55) * 100)}%
          <input type="range" min={0.15} max={0.9} step={0.05} value={spec.density ?? 0.55} onChange={(e) => update({ density: +e.target.value })} />
        </label>
      )}
      {spec.type === 'drums' && (
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={!!spec.fill} onChange={(e) => update({ fill: e.target.checked })} /> Fill in last bar
          </label>
          <label className="check">
            <input type="checkbox" checked={!!spec.crash} onChange={(e) => update({ crash: e.target.checked })} /> Crash
          </label>
        </div>
      )}
      <div className="hint">
        {spec.type === 'drums'
          ? 'Uses the kit lanes bd, sd/cp, hh, oh, toms, cr.'
          : chords
            ? `Follows the ${chords} chord${chords === 1 ? '' : 's'} in this section's chord lane — change them and the part updates.`
            : 'No chord lane in this section yet: uses the key\'s tonic chord. Set chords with Chords… or the lane above the grid.'}
        {' '}Editing the notes by hand stops it following.
      </div>
      <div className="row">
        <button className="primary" onClick={() => run(spec)}>
          Generate
        </button>
        <button onClick={() => run({ ...spec, seed: newSeed() })} title={`Same settings, new random seed (${REROLL.label})`}>
          🎲 Reroll
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

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
  const [lane, setLane] = useState(true);
  const [writeNotes, setWriteNotes] = useState(true);
  const [bass, setBass] = useState('');
  const [error, setError] = useState<string>();
  const others = s.project.tracks.filter((t) => t.id !== track.id && t.kind === 'notes');
  const key = s.project.scale;
  const apply = () => {
    const err = s.writeProgression(track.id, text, CHORD_LENGTHS[len].value, { lane, notes: writeNotes, replace, bassTrackId: bass || undefined });
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
      <div className="row">
        <label className="check" title="Set the section's chord lane (generators and chord-tone snapping follow it)">
          <input type="checkbox" checked={lane} onChange={(e) => setLane(e.target.checked)} /> Chord lane
        </label>
        <label className="check">
          <input type="checkbox" checked={writeNotes} onChange={(e) => setWriteNotes(e.target.checked)} /> Write chords here
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
  const euclidOpen = s.popover === 'euclid';
  const generateOpen = s.popover === 'generate';
  const chordsOpen = s.popover === 'chords';
  const setEuclidOpen = (open: boolean) => s.set({ popover: open ? 'euclid' : null });
  const setChordsOpen = (open: boolean) => s.set({ popover: open ? 'chords' : null });

  const variations = track?.variations;
  const active = track?.variation ?? 0;
  return (
    <div className="roll-toolbar">
      {track && (
        <span className="variations" title="Clip variations: alternative versions of this clip (⌥1–⌥9 switch, ⌥= adds). While playing, switches land on the next bar.">
          {variations ? (
            variations.map((_, i) => (
              <button
                key={i}
                className={`var-chip ${i === active ? 'on' : ''}`}
                onClick={(e) => (e.altKey ? confirm(`Delete variation ${String.fromCharCode(65 + i)}?`) && s.removeVariation(track.id, i) : s.selectVariation(track.id, i))}
                title={`Variation ${String.fromCharCode(65 + i)} (⌥${i + 1}) · ⌥-click to delete`}
              >
                {String.fromCharCode(65 + i)}
              </button>
            ))
          ) : (
            <span className="var-label">Var</span>
          )}
          <button className="var-chip" onClick={() => s.addVariation(track.id)} title="New variation: a copy of this clip (⌥=)">
            +
          </button>
        </span>
      )}
      <label title="Grid: , finer · . coarser · / triplet · \\ snap on/off">
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
      <label title="Key and scale: highlights in-key rows; chords, generators and ↑/↓ follow it">
        Key
        <select
          value={scale ? scale.root : ''}
          onChange={(e) => s.setScale(e.target.value === '' ? undefined : { root: +e.target.value, mode: scale?.mode ?? 'major' })}
        >
          <option value="">none</option>
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
      {scale && (
        <button
          className={`toggle-btn ${s.scaleLock ? 'on' : ''}`}
          onClick={() => s.set({ scaleLock: !s.scaleLock })}
          title="In key: drawn and dragged notes snap to the scale, the computer keyboard plays scale notes, MIDI input snaps, Invert stays in key"
        >
          In key
        </button>
      )}
      {track?.kind === 'notes' && (
        <>
          <label title={`Drawn notes become chords: diatonic when a Scale is set (${CYCLE_CHORD.label} cycles)`}>
            Chord
            <select value={s.chordStamp} onChange={(e) => s.set({ chordStamp: e.target.value as ChordStamp })}>
              <option value="off">off</option>
              <option value="triad">triad</option>
              <option value="seventh">7th</option>
              <option value="sus4">sus4</option>
            </select>
          </label>
          <button
            className={`toggle-btn ${s.chordSnap ? 'on' : ''}`}
            onClick={() => s.set({ chordSnap: !s.chordSnap })}
            title={`Drawn notes snap to the chord lane's tones (${TOGGLE_CHORD_SNAP.label})`}
          >
            Chord tones
          </button>
          <span className="anchor">
            <button disabled={track.mode === 'code'} onClick={() => setChordsOpen(!chordsOpen)} title={`Write a chord progression into this section (${OPEN_CHORDS.label})`}>
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
          if (t && track) s.transformNotes(track.id, (notes) => t.run(notes, s.snap, s.scaleLock ? s.project.scale : undefined));
        }}
        title="Transform the selected notes (all notes if none selected)"
      >
        <option value="">Transform…</option>
        {TRANSFORMS.map((t, i) => (
          <option key={t.label} value={i}>
            {t.label}  {t.combo.label}
          </option>
        ))}
      </select>
      <span className="anchor">
        <button
          disabled={!track}
          onClick={() => s.set({ popover: generateOpen ? null : 'generate' })}
          title={`Generate a part that follows the chord lane (${OPEN_GENERATE.label})`}
        >
          🎲 Generate…
        </button>
        {generateOpen && track && <GeneratePopover track={track} onClose={() => s.set({ popover: null })} />}
      </span>
      <span className="anchor">
        <button disabled={!track || track.mode === 'code'} onClick={() => setEuclidOpen(!euclidOpen)} title={`Write a Euclidean rhythm (${OPEN_EUCLID.label})`}>
          Euclid…
        </button>
        {euclidOpen && track && <EuclidPopover track={track} onClose={() => setEuclidOpen(false)} />}
      </span>
    </div>
  );
}
