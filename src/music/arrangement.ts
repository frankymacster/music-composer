import { computeBars, songLength, type Bar, type MeterChange } from './time';

/** A part of the song (Verse, Chorus…) with its own length and meters; every track has one clip per section. */
export interface Section {
  id: string;
  name: string;
  color: string;
  bars: number;
  meters: MeterChange[];
}

export interface Instance {
  section: Section;
  /** Position in the arrangement. */
  index: number;
  /** Song tick where this instance starts. */
  start: number;
  length: number;
}

export interface Timeline {
  instances: Instance[];
  /** Song bars (instances laid end to end). */
  bars: Bar[];
  length: number;
}

export function sectionInfo(section: Section) {
  const bars = computeBars(section);
  return { bars, length: songLength(bars) };
}

export function timeline(sections: Section[], arrangement: string[]): Timeline {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const instances: Instance[] = [];
  const bars: Bar[] = [];
  let start = 0;
  for (const id of arrangement) {
    const section = byId.get(id);
    if (!section) continue;
    const info = sectionInfo(section);
    for (const b of info.bars) bars.push({ ...b, index: bars.length, start: b.start + start });
    instances.push({ section, index: instances.length, start, length: info.length });
    start += info.length;
  }
  return { instances, bars, length: start };
}

/** Instance playing at a song tick, and the tick inside it. */
export function locate(tl: Timeline, tick: number): { instance: Instance; tick: number } | undefined {
  for (const instance of tl.instances) {
    if (tick < instance.start + instance.length) return { instance, tick: Math.max(0, tick - instance.start) };
  }
  return undefined;
}
