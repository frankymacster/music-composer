import { useEffect, useRef, useState } from 'react';
import { useStore, selectedSection, uid } from '../store';
import { parseChord } from '../music/chords';
import { TPW } from '../music/time';
import type { ChordEvent } from '../music/generators';

/** Add or edit one chord in the selected section's chord lane. */
export function ChordEditPopover({ at, x, onClose }: { at: ChordEvent; x: number; onClose: () => void }) {
  const section = useStore(selectedSection);
  const scale = useStore((s) => s.project.scale);
  const setChords = useStore((s) => s.setChords);
  const chords = section.chords ?? [];
  const existing = chords.some((c) => c.id === at.id);
  const [symbol, setSymbol] = useState(at.symbol);
  const [beats, setBeats] = useState(+(at.dur / (TPW / 4)).toFixed(2));
  const [error, setError] = useState<string>();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, []);

  const save = () => {
    try {
      parseChord(symbol.trim(), scale);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const next: ChordEvent = { ...at, id: at.id || uid(), symbol: symbol.trim(), dur: Math.max(TPW / 16, Math.round(beats * (TPW / 4))) };
    const end = next.start + next.dur;
    // the edited chord wins over chords it now overlaps
    const others = chords
      .filter((c) => c.id !== at.id)
      .flatMap((c): ChordEvent[] => {
        const cEnd = c.start + c.dur;
        if (cEnd <= next.start || c.start >= end) return [c];
        const parts: ChordEvent[] = [];
        if (c.start < next.start) parts.push({ ...c, dur: next.start - c.start });
        if (cEnd > end) parts.push({ ...c, id: uid(), start: end, dur: cEnd - end });
        return parts;
      });
    setChords([...others, next]);
    onClose();
  };

  return (
    <div className="popover chord-edit" style={{ left: Math.max(8, x), top: 60 }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="popover-title">{existing ? 'Chord' : 'Add chord'}</div>
      <div className="row">
        <input
          ref={ref}
          value={symbol}
          spellCheck={false}
          placeholder="Am7, F/C, IV…"
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <label className="check" title="Length in beats">
          <input type="number" min={0.25} step={0.25} value={beats} onChange={(e) => setBeats(+e.target.value)} /> beats
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="primary" onClick={save}>
          {existing ? 'Save' : 'Add'}
        </button>
        {existing && (
          <button
            onClick={() => {
              setChords(chords.filter((c) => c.id !== at.id));
              onClose();
            }}
          >
            Delete
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
      </div>
      <div className="hint">Generated parts and chord-tone snapping follow this lane.</div>
    </div>
  );
}
