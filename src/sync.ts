import { useStore, trackPattern, songInfo } from './store';
import { engine, applyOutput, stack, silence } from './strudel/engine';
import { kitPitch } from './strudel/compile';
import { barAtTick, cpsFromBpm, TPW, type Bar } from './music/time';
import { generateTrackCode } from './music/codegen';
import { compile, type Pattern } from './strudel/compile';
import type { Song } from './music/time';

export function loopRange() {
  const { project, loop } = useStore.getState();
  const { bars, length } = songInfo(project.song);
  if (!loop.enabled) return { start: 0, len: length / TPW };
  const a = bars[Math.min(loop.startBar, bars.length - 1)];
  const b = bars[Math.min(Math.max(loop.endBar, loop.startBar + 1), bars.length) - 1];
  return { start: a.start / TPW, len: (b.start + b.length - a.start) / TPW };
}

/** Clicks on every beat of `bars`, accented downbeats. */
function clickPattern(bars: Bar[], length: number): Pattern {
  const notes = bars.flatMap((bar) =>
    Array.from({ length: bar.num }, (_, i) => ({
      id: '',
      pitch: i === 0 ? 96 : 84,
      start: bar.start + (i * TPW) / bar.den,
      dur: TPW / 32,
      vel: i === 0 ? 1 : 0.6,
    })),
  );
  const c = compile(generateTrackCode(notes, bars, length));
  return c.ok ? c.pattern.s('sine').decay(0.05).sustain(0).release(0.02).gain(0.6) : silence;
}

let metronomeCache: { song: Song; pattern: Pattern } | undefined;
function metronome(song: Song): Pattern {
  if (metronomeCache?.song !== song) {
    const { bars, length } = songInfo(song);
    metronomeCache = { song, pattern: clickPattern(bars, length) };
  }
  return metronomeCache.pattern;
}

/** One bar of clicks in the meter at `tick`, played before the song starts. */
export function countIn(tick: number): { cycles: number; pattern: Pattern } {
  const bar = barAtTick(songInfo(useStore.getState().project.song).bars, tick);
  const one = { ...bar, index: 0, start: 0 };
  return { cycles: bar.length / TPW, pattern: clickPattern([one], bar.length) };
}

function rebuild() {
  const { project, metronome: click } = useStore.getState();
  const anySolo = project.tracks.some((t) => t.solo);
  const pats = project.tracks
    .filter((t) => !t.mute && (!anySolo || t.solo))
    .map((t) => {
      const c = trackPattern(t);
      if (!c) return undefined;
      try {
        return applyOutput(c.pattern, t.output, t.gain, t.kind === 'kit' ? kitPitch(t.lanes ?? []) : undefined);
      } catch (e) {
        console.warn(`track ${t.name}:`, e);
        return undefined;
      }
    })
    .filter(Boolean);
  if (click) pats.push(metronome(project.song));
  engine.setPattern(pats.length ? stack(...pats) : silence);
  engine.setCps(cpsFromBpm(project.song.bpm));
}

export function startSync() {
  rebuild();
  useStore.subscribe((s, prev) => {
    if (s.project !== prev.project || s.metronome !== prev.metronome) rebuild();
    if (s.project.song !== prev.project.song || s.loop !== prev.loop) engine.setLoop(loopRange());
  });
}
