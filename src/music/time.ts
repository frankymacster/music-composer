// 1 Strudel cycle = 1 whole note. All positions are integer ticks.
export const TPW = 1920;
export const TPQ = TPW / 4;

export interface MeterChange {
  bar: number;
  num: number;
  den: number;
}

export interface Song {
  bpm: number;
  bars: number;
  meters: MeterChange[];
}

export interface Bar {
  index: number;
  start: number;
  length: number;
  num: number;
  den: number;
}

export function meterAt(meters: MeterChange[], bar: number): MeterChange {
  let m = meters[0];
  for (const c of meters) if (c.bar <= bar) m = c;
  return m;
}

export function computeBars(song: Song): Bar[] {
  const bars: Bar[] = [];
  let start = 0;
  for (let i = 0; i < song.bars; i++) {
    const { num, den } = meterAt(song.meters, i);
    const length = (num * TPW) / den;
    bars.push({ index: i, start, length, num, den });
    start += length;
  }
  return bars;
}

export function songLength(bars: Bar[]): number {
  const last = bars[bars.length - 1];
  return last ? last.start + last.length : 0;
}

export function barAtTick(bars: Bar[], tick: number): Bar {
  for (let i = bars.length - 1; i >= 0; i--) if (tick >= bars[i].start) return bars[i];
  return bars[0];
}

export const cpsFromBpm = (bpm: number) => bpm / 60 / 4;

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export const SNAPS: { label: string; ticks: number }[] = [
  { label: '1 bar', ticks: 0 },
  { label: '1/2', ticks: TPW / 2 },
  { label: '1/4', ticks: TPW / 4 },
  { label: '1/8', ticks: TPW / 8 },
  { label: '1/8T', ticks: TPW / 12 },
  { label: '1/16', ticks: TPW / 16 },
  { label: '1/16T', ticks: TPW / 24 },
  { label: '1/32', ticks: TPW / 32 },
  { label: 'Off', ticks: 1 },
];

export function snapTick(tick: number, snap: number, bars: Bar[], mode: 'round' | 'floor' = 'round'): number {
  if (snap === 1) return Math.round(tick);
  if (snap === 0) {
    const bar = barAtTick(bars, tick);
    if (mode === 'floor') return bar.start;
    return tick - bar.start < bar.length / 2 ? bar.start : bar.start + bar.length;
  }
  const bar = barAtTick(bars, Math.max(0, tick));
  const rel = tick - bar.start;
  const q = mode === 'floor' ? Math.floor(rel / snap) : Math.round(rel / snap);
  return bar.start + q * snap;
}
