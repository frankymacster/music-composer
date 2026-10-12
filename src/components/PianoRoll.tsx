import { useEffect, useRef, useState } from 'react';
import { useStore, selectedTrack, songInfo, trackPattern, uid, type Track } from '../store';
import { hapsToNotes } from '../strudel/compile';
import { engine } from '../strudel/engine';
import { TPW, snapTick, barAtTick, type Bar } from '../music/time';
import { isBlackKey, pitchLabel, type Note } from '../music/codegen';
import { drumByGm, rowsFor, type TrackKind } from '../music/drums';
import { MeterPopover } from './MeterPopover';
import { loopRange } from '../sync';

const METER_H = 18;
const RULER_H = 38;
const VEL_H = 84;
const EDGE = 6;

interface Lane {
  kind: TrackKind;
  rows: number[];
  index: Map<number, number>;
  keysW: number;
}

const makeLane = (kind: TrackKind, keysW: number): Lane => {
  const rows = rowsFor(kind);
  return { kind, rows, index: new Map(rows.map((p, i) => [p, i])), keysW };
};
const LANES: Record<TrackKind, Lane> = { notes: makeLane('notes', 64), drums: makeLane('drums', 96) };

interface View {
  ppt: number;
  rowH: number;
  scrollTick: number;
  scrollY: number;
  w: number;
  h: number;
  lane: Lane;
  saved: Record<TrackKind, { rowH: number; scrollY: number }>;
}

type Drag =
  | { kind: 'move'; anchor: Note; origs: Note[]; x0: number; y0: number; lastPitch: number }
  | { kind: 'resize'; anchor: Note; origs: Note[]; x0: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<string> }
  | { kind: 'vel'; origs: Note[]; y0: number }
  | { kind: 'loop'; bar0: number; moved: boolean }
  | { kind: 'keys'; lastPitch: number };

const ghostCache = { key: '', notes: [] as Note[] };
function visibleNotes(track: Track, length: number): Note[] {
  if (track.mode === 'grid') return track.notes;
  const key = `${track.code}|${length}`;
  if (ghostCache.key !== key) {
    const c = trackPattern(track);
    ghostCache.key = key;
    ghostCache.notes = c ? hapsToNotes(c.pattern, length) : [];
  }
  return ghostCache.notes;
}

export const snapLength = (snap: number, bars: Bar[], at: number) => (snap === 0 ? barAtTick(bars, at).length : snap);

export function preview(track: Track, pitch: number, vel = 0.8) {
  if (track.kind === 'drums' && track.output.type !== 'midi') {
    const d = drumByGm.get(pitch);
    if (d) engine.preview({ s: d.s, velocity: vel }, track.output);
    return;
  }
  engine.preview({ note: pitch, velocity: vel }, track.output);
}

export const newNoteLength = (track: Track, snap: number, bars: Bar[], at: number, last: number) =>
  track.kind === 'drums' ? (snap > 1 ? snapLength(snap, bars, at) : TPW / 16) : last;

export function PianoRoll() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({
    ppt: 0.25,
    rowH: 14,
    scrollTick: 0,
    scrollY: (127 - 76) * 14,
    w: 0,
    h: 0,
    lane: LANES.notes,
    saved: { notes: { rowH: 14, scrollY: (127 - 76) * 14 }, drums: { rowH: 24, scrollY: 0 } },
  });
  const drag = useRef<Drag | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const lastLen = useRef(TPW / 8);
  const [meterEdit, setMeterEdit] = useState<{ bar: number; x: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const v = view.current;
    let raf = 0;
    let fitted = false;

    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      v.w = r.width;
      v.h = r.height;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!fitted && v.w > 0) {
        fitted = true;
        const { length } = songInfo(useStore.getState().project.song);
        v.ppt = (v.w - v.lane.keysW - 20) / length;
      }
    };

    const draw = () => {
      const s = useStore.getState();
      const track = selectedTrack(s);
      const lane = LANES[track?.kind ?? 'notes'];
      if (v.lane !== lane) {
        v.saved[v.lane.kind] = { rowH: v.rowH, scrollY: v.scrollY };
        v.rowH = v.saved[lane.kind].rowH;
        v.scrollY = v.saved[lane.kind].scrollY;
        v.lane = lane;
      }
      const KEYS_W = lane.keysW;
      const drums = lane.kind === 'drums';
      const { bars, length } = songInfo(s.project.song);
      const { w, h, ppt, rowH, scrollTick, scrollY } = v;
      const gridH = h - RULER_H - VEL_H;
      const xOf = (t: number) => KEYS_W + (t - scrollTick) * ppt;
      const yOf = (p: number) => RULER_H + (lane.index.get(p) ?? -1000) * rowH - scrollY;
      const iTop = Math.max(0, Math.floor(scrollY / rowH));
      const iBot = Math.min(lane.rows.length - 1, Math.ceil((scrollY + gridH) / rowH));
      const t0 = scrollTick;
      const t1 = scrollTick + (w - KEYS_W) / ppt;
      const pos = s.playing ? engine.position() * TPW : s.cursor;

      if (s.playing && engine.playing) {
        const px = xOf(pos);
        if (px > w - 40 || px < KEYS_W) v.scrollTick = Math.max(0, pos - (20 / ppt));
      }

      ctx.fillStyle = '#16171a';
      ctx.fillRect(0, 0, w, h);

      // grid rows
      ctx.save();
      ctx.beginPath();
      ctx.rect(KEYS_W, RULER_H, w - KEYS_W, gridH);
      ctx.clip();
      for (let i = iTop; i <= iBot; i++) {
        const p = lane.rows[i];
        const y = yOf(p);
        ctx.fillStyle = (drums ? i % 2 : isBlackKey(p)) ? '#1c1d21' : '#232529';
        ctx.fillRect(KEYS_W, y, w, rowH);
        if (drums ? true : p % 12 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(KEYS_W, y + rowH - 1, w, 1);
        }
      }

      // loop shading
      if (s.loop.enabled) {
        const a = bars[Math.min(s.loop.startBar, bars.length - 1)];
        const b = bars[Math.min(s.loop.endBar, bars.length) - 1] ?? a;
        ctx.fillStyle = 'rgba(79,179,255,0.06)';
        ctx.fillRect(xOf(a.start), RULER_H, (b.start + b.length - a.start) * ppt, gridH);
      }

      // vertical lines
      const sub = s.snap > 1 ? s.snap : TPW / 16;
      for (const bar of bars) {
        if (bar.start > t1) break;
        if (bar.start + bar.length < t0) continue;
        const beat = TPW / bar.den;
        if (sub * ppt > 5) {
          ctx.fillStyle = 'rgba(255,255,255,0.035)';
          for (let t = bar.start; t < bar.start + bar.length; t += sub) ctx.fillRect(Math.round(xOf(t)), RULER_H, 1, gridH);
        }
        if (beat * ppt > 4) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          for (let t = bar.start + beat; t < bar.start + bar.length - 1; t += beat) ctx.fillRect(Math.round(xOf(t)), RULER_H, 1, gridH);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(Math.round(xOf(bar.start)), RULER_H, 1, gridH);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(xOf(length), RULER_H, w, gridH);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(Math.round(xOf(length)), RULER_H, 1, gridH);

      // notes
      const notes = track ? visibleNotes(track, length) : [];
      const ghost = track?.mode === 'code';
      const color = track?.color ?? '#888';
      for (const n of notes) {
        const x = xOf(n.start);
        const nw = Math.max(2, n.dur * ppt - 1);
        if (x > w || x + nw < KEYS_W) continue;
        const y = yOf(n.pitch);
        if (y > h || y + rowH < RULER_H) continue;
        const sel = s.selection.has(n.id);
        ctx.globalAlpha = ghost ? 0.35 : (0.45 + 0.55 * n.vel) * (n.start >= length ? 0.35 : 1);
        ctx.fillStyle = color;
        ctx.fillRect(x + 0.5, y + 1, nw, rowH - 2);
        ctx.globalAlpha = 1;
        if (ghost) {
          ctx.strokeStyle = color;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(x + 1, y + 1.5, nw - 1, rowH - 3);
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.5)';
          ctx.lineWidth = sel ? 1.5 : 1;
          ctx.strokeRect(x + 1, y + 1.5, nw - 1, rowH - 3);
          ctx.lineWidth = 1;
        }
        if (!drums && nw > 30 && rowH >= 11) {
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          ctx.font = '10px ui-sans-serif, system-ui';
          ctx.fillText(pitchLabel(n.pitch), x + 4, y + rowH / 2 + 3.5);
        }
      }

      if (ghost) {
        ctx.fillStyle = 'rgba(22,23,26,0.85)';
        ctx.fillRect(w - 330, RULER_H + 8, 322, 24);
        ctx.fillStyle = '#c9cdd2';
        ctx.font = '11px ui-sans-serif, system-ui';
        ctx.fillText('Code track: notes are read-only. Bake to edit in grid.', w - 322, RULER_H + 24);
      }

      const d = drag.current;
      if (d?.kind === 'marquee') {
        ctx.fillStyle = 'rgba(79,179,255,0.12)';
        ctx.strokeStyle = 'rgba(79,179,255,0.8)';
        const rx = Math.min(d.x0, d.x1);
        const ry = Math.min(d.y0, d.y1);
        ctx.fillRect(rx, ry, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        ctx.strokeRect(rx + 0.5, ry + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      }

      // hover position in draw mode
      if (s.draw && hover.current && !d && track?.mode === 'grid') {
        const { x, y } = hover.current;
        if (x > KEYS_W && y > RULER_H && y < RULER_H + gridH) {
          const p = lane.rows[Math.min(lane.rows.length - 1, Math.floor((y - RULER_H + scrollY) / rowH))];
          const t = snapTick(scrollTick + (x - KEYS_W) / ppt, s.snap, bars, 'floor');
          const len = newNoteLength(track, s.snap, bars, t, lastLen.current);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          if (p !== undefined) ctx.strokeRect(xOf(t) + 0.5, yOf(p) + 1.5, len * ppt - 1, rowH - 3);
        }
      }

      // playhead
      ctx.fillStyle = s.playing ? '#ffffff' : '#f5a524';
      ctx.fillRect(Math.round(xOf(pos)), RULER_H, 1, gridH + VEL_H);
      ctx.restore();

      // velocity lane
      const vy = h - VEL_H;
      ctx.fillStyle = '#1a1b1f';
      ctx.fillRect(0, vy, w, VEL_H);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, vy, w, 1);
      ctx.fillStyle = '#7d838b';
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillText('Velocity', 8, vy + 16);
      ctx.save();
      ctx.beginPath();
      ctx.rect(KEYS_W, vy + 1, w - KEYS_W, VEL_H - 1);
      ctx.clip();
      for (const n of notes) {
        const x = xOf(n.start);
        if (x < KEYS_W - 4 || x > w) continue;
        const top = vy + 6 + (1 - n.vel) * (VEL_H - 12);
        ctx.fillStyle = s.selection.has(n.id) ? '#fff' : color;
        ctx.globalAlpha = ghost ? 0.4 : 0.9;
        ctx.fillRect(x, top, 2, vy + VEL_H - 6 - top);
        ctx.fillRect(x - 2, top - 1, 6, 3);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // keys
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER_H, KEYS_W, gridH);
      ctx.clip();
      for (let i = iTop; i <= iBot && drums; i++) {
        const p = lane.rows[i];
        const y = yOf(p);
        ctx.fillStyle = i % 2 ? '#2a2c31' : '#30333a';
        ctx.fillRect(0, y, KEYS_W, rowH);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y + rowH - 1, KEYS_W, 1);
        ctx.fillStyle = '#c9cdd2';
        ctx.font = '11px ui-sans-serif, system-ui';
        ctx.fillText(drumByGm.get(p)?.name ?? '', 8, y + rowH / 2 + 4);
      }
      for (let i = iTop; i <= iBot && !drums; i++) {
        const p = lane.rows[i];
        const y = yOf(p);
        const black = isBlackKey(p);
        ctx.fillStyle = black ? '#2a2c31' : '#d9dce1';
        ctx.fillRect(0, y, black ? KEYS_W * 0.62 : KEYS_W, rowH);
        if (black) {
          ctx.fillStyle = '#c5c8cd';
          ctx.fillRect(KEYS_W * 0.62, y, KEYS_W * 0.38, rowH);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, y + rowH - 1, KEYS_W, 1);
        if (p % 12 === 0 && rowH >= 9) {
          ctx.fillStyle = '#3a3d44';
          ctx.font = '10px ui-sans-serif, system-ui';
          ctx.fillText(pitchLabel(p), KEYS_W - 28, y + rowH / 2 + 3.5);
        }
      }
      ctx.restore();

      // ruler
      ctx.fillStyle = '#1c1d21';
      ctx.fillRect(0, 0, w, RULER_H);
      ctx.fillStyle = '#25272c';
      ctx.fillRect(KEYS_W, 0, w, METER_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(KEYS_W, 0, w - KEYS_W, RULER_H);
      ctx.clip();
      if (s.loop.enabled) {
        const a = bars[Math.min(s.loop.startBar, bars.length - 1)];
        const b = bars[Math.min(s.loop.endBar, bars.length) - 1] ?? a;
        ctx.fillStyle = 'rgba(79,179,255,0.55)';
        ctx.fillRect(xOf(a.start), METER_H + 2, (b.start + b.length - a.start) * ppt, 5);
      }
      const labelEvery = Math.max(1, Math.ceil(36 / ((TPW) * ppt)));
      let prevMeter = '';
      for (const bar of bars) {
        const x = xOf(bar.start);
        const meter = `${bar.num}/${bar.den}`;
        if (bar.start <= t1 && bar.start + bar.length >= t0) {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillRect(Math.round(x), METER_H, 1, RULER_H - METER_H);
          if (bar.index % labelEvery === 0) {
            ctx.fillStyle = '#b8bcc2';
            ctx.font = '11px ui-sans-serif, system-ui';
            ctx.fillText(String(bar.index + 1), x + 4, RULER_H - 6);
          }
          const beat = TPW / bar.den;
          if (beat * ppt > 6) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            for (let t = bar.start + beat; t < bar.start + bar.length - 1; t += beat) ctx.fillRect(Math.round(xOf(t)), RULER_H - 6, 1, 6);
          }
          if (meter !== prevMeter) {
            ctx.fillStyle = '#f5a524';
            ctx.font = 'bold 11px ui-sans-serif, system-ui';
            ctx.fillText(meter, x + 4, 13);
            ctx.fillRect(Math.round(x), 0, 1, METER_H);
          }
        }
        prevMeter = meter;
      }
      // cursor marker
      const cx = xOf(pos);
      ctx.fillStyle = s.playing ? '#fff' : '#f5a524';
      ctx.beginPath();
      ctx.moveTo(cx - 5, RULER_H - 8);
      ctx.lineTo(cx + 5, RULER_H - 8);
      ctx.lineTo(cx, RULER_H);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#1c1d21';
      ctx.fillRect(0, 0, KEYS_W, RULER_H);
      ctx.fillStyle = '#7d838b';
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillText('Meter', 8, 13);
    };
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas.parentElement!);
    resize();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // --- interaction ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const v = view.current;

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const kw = () => v.lane.keysW;
    const tickAt = (x: number) => v.scrollTick + (x - kw()) / v.ppt;
    const rowAt = (y: number) => Math.max(0, Math.min(v.lane.rows.length - 1, Math.floor((y - RULER_H + v.scrollY) / v.rowH)));
    const pitchAt = (y: number) => v.lane.rows[rowAt(y)];
    const rowOf = (p: number) => v.lane.index.get(p) ?? -1000;
    const xOf = (t: number) => kw() + (t - v.scrollTick) * v.ppt;
    const yOf = (p: number) => RULER_H + rowOf(p) * v.rowH - v.scrollY;

    const hitNote = (x: number, y: number, notes: Note[]) => {
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        const nx = xOf(n.start);
        const nw = n.dur * v.ppt;
        const ny = yOf(n.pitch);
        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + v.rowH) {
          const edge = Math.min(EDGE, nw / 3);
          return { note: n, edge: x >= nx + nw - edge };
        }
      }
      return undefined;
    };

    const ctxState = () => {
      const s = useStore.getState();
      const track = selectedTrack(s);
      const info = songInfo(s.project.song);
      return { s, track, ...info };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x } = local(e);
      if (e.ctrlKey || e.metaKey) {
        const t = tickAt(x);
        v.ppt = Math.max(0.01, Math.min(4, v.ppt * Math.exp(-e.deltaY * 0.01)));
        v.scrollTick = Math.max(0, t - (x - kw()) / v.ppt);
      } else if (e.altKey) {
        const old = v.rowH;
        v.rowH = Math.max(6, Math.min(32, v.rowH * Math.exp(-e.deltaY * 0.01)));
        v.scrollY = (v.scrollY + v.h / 2) * (v.rowH / old) - v.h / 2;
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        v.scrollTick = Math.max(0, v.scrollTick + dx / v.ppt);
        v.scrollY += dy;
      }
      const maxY = Math.max(0, v.lane.rows.length * v.rowH - (v.h - RULER_H - VEL_H));
      v.scrollY = Math.max(0, Math.min(maxY, v.scrollY));
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      const { s, track, bars, length } = ctxState();
      if (!track) return;
      setMeterEdit(null);
      canvas.setPointerCapture(e.pointerId);
      const gridBottom = v.h - VEL_H;

      if (y < RULER_H) {
        if (x < kw()) return;
        const bar = barAtTick(bars, Math.min(length - 1, Math.max(0, tickAt(x))));
        if (y < METER_H) {
          setMeterEdit({ bar: bar.index, x: xOf(bar.start) });
          return;
        }
        drag.current = { kind: 'loop', bar0: bar.index, moved: false };
        return;
      }

      if (x < kw() && y < gridBottom) {
        const p = pitchAt(y);
        preview(track, p);
        drag.current = { kind: 'keys', lastPitch: p };
        return;
      }

      if (track.mode !== 'grid') return;
      const notes = track.notes;

      if (y >= gridBottom) {
        const near = notes.filter((n) => Math.abs(xOf(n.start) - x) <= 4);
        if (!near.length) return;
        const targets = near.some((n) => s.selection.has(n.id)) ? notes.filter((n) => s.selection.has(n.id)) : near;
        s.checkpoint();
        drag.current = { kind: 'vel', origs: targets, y0: y };
        return;
      }

      const hit = hitNote(x, y, notes);
      if (hit && s.draw && !hit.edge) {
        s.checkpoint();
        s.setNotes(track.id, notes.filter((n) => n.id !== hit.note.id), false);
        return;
      }
      if (hit && e.detail === 2 && !hit.edge) {
        s.setNotes(track.id, notes.filter((n) => n.id !== hit.note.id));
        return;
      }
      if (hit) {
        let sel = new Set(s.selection);
        if (e.shiftKey) {
          if (sel.has(hit.note.id)) sel.delete(hit.note.id);
          else sel.add(hit.note.id);
        } else if (!sel.has(hit.note.id)) sel = new Set([hit.note.id]);
        if (!sel.has(hit.note.id)) {
          s.select(sel);
          return;
        }
        s.checkpoint();
        let current = notes;
        let anchor = hit.note;
        if ((e.altKey || e.metaKey) && !hit.edge) {
          const copies = notes.filter((n) => sel.has(n.id)).map((n) => ({ ...n, id: uid(), _from: n.id }));
          anchor = copies.find((c) => c._from === hit.note.id)!;
          const clean = copies.map(({ _from, ...n }) => n);
          current = [...notes, ...clean];
          s.setNotes(track.id, current, false);
          sel = new Set(clean.map((n) => n.id));
        }
        s.select(sel);
        const origs = current.filter((n) => sel.has(n.id));
        lastLen.current = hit.note.dur;
        drag.current = hit.edge
          ? { kind: 'resize', anchor, origs, x0: x }
          : { kind: 'move', anchor, origs, x0: x, y0: y, lastPitch: anchor.pitch };
        if (!hit.edge) preview(track, anchor.pitch, anchor.vel);
        return;
      }

      if (s.draw || e.detail === 2) {
        const start = Math.max(0, snapTick(tickAt(x), s.snap, bars, 'floor'));
        const dur =
          track.kind === 'drums' || s.draw
            ? newNoteLength(track, s.snap, bars, start, lastLen.current)
            : Math.max(snapLength(s.snap, bars, start), lastLen.current);
        const n: Note = { id: uid(), pitch: pitchAt(y), start, dur, vel: 0.8 };
        s.checkpoint();
        s.setNotes(track.id, [...notes, n], false);
        s.select(new Set([n.id]));
        preview(track, n.pitch, n.vel);
        drag.current = { kind: 'resize', anchor: n, origs: [n], x0: xOf(start + dur) };
        return;
      }

      drag.current = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y, base: e.shiftKey ? new Set(s.selection) : new Set() };
      s.select(drag.current.base);
      const tick = snapTick(tickAt(x), s.snap, bars, 'round');
      if (!s.playing) s.set({ cursor: Math.max(0, Math.min(length, tick)) });
    };

    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      hover.current = { x, y };
      const d = drag.current;
      const { s, track, bars } = ctxState();
      if (!d) {
        if (!track) return;
        const hit = y > RULER_H && y < v.h - VEL_H && x > kw() && track.mode === 'grid' ? hitNote(x, y, track.notes) : undefined;
        canvas.style.cursor = hit?.edge ? 'ew-resize' : hit ? (s.draw ? 'not-allowed' : 'grab') : s.draw && x > kw() ? 'crosshair' : 'default';
        return;
      }
      if (!track) return;
      if (d.kind === 'keys') {
        const p = pitchAt(y);
        if (p !== d.lastPitch) {
          d.lastPitch = p;
          preview(track, p);
        }
        return;
      }
      if (d.kind === 'loop') {
        const bar = barAtTick(bars, Math.max(0, tickAt(x)));
        if (bar.index !== d.bar0 || d.moved) {
          d.moved = true;
          const a = Math.min(d.bar0, bar.index);
          const b = Math.max(d.bar0, bar.index) + 1;
          s.set({ loop: { enabled: true, startBar: a, endBar: b } });
        }
        return;
      }
      if (d.kind === 'marquee') {
        d.x1 = x;
        d.y1 = y;
        const ta = tickAt(Math.min(d.x0, d.x1));
        const tb = tickAt(Math.max(d.x0, d.x1));
        const ra = rowAt(Math.min(d.y0, d.y1));
        const rb = rowAt(Math.max(d.y0, d.y1));
        const sel = new Set(d.base);
        for (const n of track.notes) {
          const r = rowOf(n.pitch);
          if (n.start < tb && n.start + n.dur > ta && r >= ra && r <= rb) sel.add(n.id);
        }
        s.select(sel);
        return;
      }
      if (d.kind === 'vel') {
        const dv = (d.y0 - y) / (VEL_H - 12);
        const map = new Map(d.origs.map((n) => [n.id, Math.round(Math.max(0.01, Math.min(1, n.vel + dv)) * 100) / 100]));
        s.setNotes(track.id, track.notes.map((n) => (map.has(n.id) ? { ...n, vel: map.get(n.id)! } : n)), false);
        return;
      }
      const ids = new Set(d.origs.map((n) => n.id));
      const orig = new Map(d.origs.map((n) => [n.id, n]));
      if (d.kind === 'move') {
        const rawStart = d.anchor.start + (x - d.x0) / v.ppt;
        let dt = e.shiftKey ? Math.round(rawStart) - d.anchor.start : snapTick(rawStart, s.snap, bars, 'round') - d.anchor.start;
        const minStart = Math.min(...d.origs.map((n) => n.start));
        dt = Math.max(-minStart, dt);
        const rows = v.lane.rows;
        const lo = Math.min(...d.origs.map((n) => rowOf(n.pitch)));
        const hi = Math.max(...d.origs.map((n) => rowOf(n.pitch)));
        const dr = Math.max(-lo, Math.min(rows.length - 1 - hi, rowAt(y) - rowAt(d.y0)));
        const moved = (p: number) => rows[rowOf(p) + dr] ?? p;
        s.setNotes(
          track.id,
          track.notes.map((n) => (ids.has(n.id) ? { ...n, start: orig.get(n.id)!.start + dt, pitch: moved(orig.get(n.id)!.pitch) } : n)),
          false,
        );
        const np = moved(d.anchor.pitch);
        if (np !== d.lastPitch) {
          d.lastPitch = np;
          preview(track, np, d.anchor.vel);
        }
      } else if (d.kind === 'resize') {
        const origEnd = d.anchor.start + d.anchor.dur;
        const rawEnd = origEnd + (x - d.x0) / v.ppt;
        const end = e.shiftKey ? Math.round(rawEnd) : snapTick(rawEnd, s.snap, bars, 'round');
        const delta = end - origEnd;
        const minDur = e.shiftKey || s.snap === 1 ? 1 : snapLength(s.snap, bars, d.anchor.start);
        s.setNotes(
          track.id,
          track.notes.map((n) => (ids.has(n.id) ? { ...n, dur: Math.max(minDur, orig.get(n.id)!.dur + delta) } : n)),
          false,
        );
        lastLen.current = Math.max(minDur, d.anchor.dur + delta);
      }
    };

    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (d?.kind === 'loop' && !d.moved) {
        const { s, bars } = ctxState();
        const tick = bars[d.bar0].start;
        s.set({ cursor: tick });
        if (s.playing) {
          engine.stop();
          engine.play(tick / TPW, loopRange());
        }
      }
    };
    const onLeave = () => (hover.current = null);

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const fit = () => {
    const v = view.current;
    const { length } = songInfo(useStore.getState().project.song);
    v.ppt = (v.w - v.lane.keysW - 20) / length;
    v.scrollTick = 0;
  };

  return (
    <div className="roll">
      <canvas ref={canvasRef} />
      <button className="fit-btn" onClick={fit} title="Zoom to fit song">
        Fit
      </button>
      {meterEdit && <MeterPopover bar={meterEdit.bar} x={meterEdit.x} onClose={() => setMeterEdit(null)} />}
    </div>
  );
}
