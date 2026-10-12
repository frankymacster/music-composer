import { useState } from 'react';
import { useStore } from '../store';
import { meterAt } from '../music/time';

const DENS = [1, 2, 4, 8, 16, 32];

export function MeterPopover({ bar, x, onClose }: { bar: number; x: number; onClose: () => void }) {
  const song = useStore((s) => s.project.song);
  const setMeter = useStore((s) => s.setMeter);
  const current = meterAt(song.meters, bar);
  const [num, setNum] = useState(current.num);
  const [den, setDen] = useState(current.den);
  const isChange = song.meters.some((m) => m.bar === bar);

  return (
    <div className="popover" style={{ left: Math.max(8, x), top: 20 }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="popover-title">Time signature from bar {bar + 1}</div>
      <div className="row">
        <input type="number" min={1} max={64} value={num} autoFocus onChange={(e) => setNum(Math.max(1, Math.min(64, +e.target.value || 1)))} />
        <span>/</span>
        <select value={den} onChange={(e) => setDen(+e.target.value)}>
          {DENS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            setMeter(bar, { num, den });
            onClose();
          }}
        >
          Apply
        </button>
        {isChange && bar > 0 && (
          <button
            onClick={() => {
              setMeter(bar, null);
              onClose();
            }}
          >
            Remove change
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
      </div>
      <div className="hint">Applies until the next change. Notes keep their absolute position.</div>
    </div>
  );
}
