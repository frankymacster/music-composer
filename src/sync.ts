import { useStore, trackPattern, songInfo } from './store';
import { engine, applyOutput, stack, silence } from './strudel/engine';
import { cpsFromBpm, TPW } from './music/time';

export function loopRange() {
  const { project, loop } = useStore.getState();
  const { bars, length } = songInfo(project.song);
  if (!loop.enabled) return { start: 0, len: length / TPW };
  const a = bars[Math.min(loop.startBar, bars.length - 1)];
  const b = bars[Math.min(Math.max(loop.endBar, loop.startBar + 1), bars.length) - 1];
  return { start: a.start / TPW, len: (b.start + b.length - a.start) / TPW };
}

function rebuild() {
  const { project } = useStore.getState();
  const anySolo = project.tracks.some((t) => t.solo);
  const pats = project.tracks
    .filter((t) => !t.mute && (!anySolo || t.solo))
    .map((t) => {
      const c = trackPattern(t);
      if (!c) return undefined;
      try {
        return applyOutput(c.pattern, t.output, t.gain);
      } catch (e) {
        console.warn(`track ${t.name}:`, e);
        return undefined;
      }
    })
    .filter(Boolean);
  engine.setPattern(pats.length ? stack(...pats) : silence);
  engine.setCps(cpsFromBpm(project.song.bpm));
}

export function startSync() {
  rebuild();
  useStore.subscribe((s, prev) => {
    if (s.project !== prev.project) rebuild();
    if (s.project.song !== prev.project.song || s.loop !== prev.loop) engine.setLoop(loopRange());
  });
}
