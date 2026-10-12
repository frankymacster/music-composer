import { useStore, selectedTrack } from '../store';
import { SNAPS } from '../music/time';
import { MODES, ROOTS } from '../music/scale';

export function RollToolbar() {
  const s = useStore();
  const track = selectedTrack(s);
  const scale = s.project.scale;
  const editable = track?.mode === 'grid';

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
    </div>
  );
}
