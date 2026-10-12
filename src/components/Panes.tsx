import { useRef, useState } from 'react';

export interface Pane {
  width: number;
  collapsed: boolean;
}

export function usePane(key: string, initial: Pane): [Pane, (p: Partial<Pane>) => void] {
  const storageKey = `music-composer:pane:${key}`;
  const [pane, setPane] = useState<Pane>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  const update = (patch: Partial<Pane>) =>
    setPane((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return [pane, update];
}

/** Drag handle on a pane edge. `side` is where the pane sits relative to the handle. */
export function Splitter({
  side,
  width,
  min,
  max,
  onResize,
  onCollapse,
}: {
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (w: number) => void;
  onCollapse: () => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      className={`splitter ${active ? 'active' : ''}`}
      title="Drag to resize · double-click to collapse"
      onDoubleClick={onCollapse}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        const w = start.current.w + (side === 'left' ? dx : -dx);
        if (w < min - 80) return onCollapse();
        onResize(Math.max(min, Math.min(max, w)));
      }}
      onPointerUp={() => {
        start.current = null;
        setActive(false);
      }}
    />
  );
}

export function CollapsedBar({ label, side, onExpand }: { label: string; side: 'left' | 'right'; onExpand: () => void }) {
  return (
    <button className={`collapsed-bar ${side}`} onClick={onExpand} title={`Show ${label.toLowerCase()}`}>
      <span className="chev">{side === 'left' ? '›' : '‹'}</span>
      <span className="vlabel">{label}</span>
    </button>
  );
}
