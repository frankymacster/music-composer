import { useStore, trackPattern, trackView, selectedSection, songTimeline, findSection, type Project, type Track } from './store';
import { engine, applyOutput, stack, silence } from './strudel/engine';
import { compile, kitPitch, type Pattern } from './strudel/compile';
import { barAtTick, cpsFromBpm, TPW, type Bar } from './music/time';
import { generateTrackCode } from './music/codegen';
import { locate, sectionInfo, type Section } from './music/arrangement';
import * as core from '@strudel/core';
import { modifiersCode } from './music/modifiers';

const state = () => useStore.getState();

/** What loops: the selected section (or its loop region) in section mode, the whole arrangement in song mode. */
export function loopRange() {
  const s = state();
  if (s.playMode === 'song') return { start: 0, len: Math.max(songTimeline(s.project).length, 1) / TPW };
  const { bars, length } = sectionInfo(selectedSection(s));
  if (!s.loop.enabled) return { start: 0, len: length / TPW };
  const a = bars[Math.min(s.loop.startBar, bars.length - 1)];
  const b = bars[Math.min(Math.max(s.loop.endBar, s.loop.startBar + 1), bars.length) - 1];
  return { start: a.start / TPW, len: (b.start + b.length - a.start) / TPW };
}

/** Where playback starts (cycles): the cursor in the selected section — its first instance in song mode. */
export function startPosition(): number {
  const s = state();
  if (s.playMode === 'section') return s.cursor / TPW;
  const inst = songTimeline(s.project).instances.find((i) => i.section.id === s.selectedSectionId);
  return ((inst?.start ?? 0) + s.cursor) / TPW;
}

/** Section and tick inside it for a raw time from engine.rawNow(). */
export function locateRaw(raw: number): { sectionId: string; tick: number } | undefined {
  const s = state();
  const tick = engine.songPos(raw) * TPW;
  if (s.playMode === 'section') return { sectionId: engine.tagAt(raw) ?? s.selectedSectionId, tick };
  const loc = locate(songTimeline(s.project), tick);
  return loc && { sectionId: loc.instance.section.id, tick: loc.tick };
}

/** What is being heard right now, or undefined when stopped. */
export function playhead(): { sectionId: string; tick: number } | undefined {
  const raw = engine.rawNow();
  return raw === undefined ? undefined : locateRaw(raw);
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
  if (!length) return silence;
  const c = compile(generateTrackCode(notes, bars, length));
  return c.ok ? c.pattern.s('sine').decay(0.05).sustain(0).release(0.02).gain(0.6) : silence;
}

const clickCache = new Map<unknown, Pattern>();
function cachedClick(key: unknown, make: () => Pattern): Pattern {
  if (!clickCache.has(key)) {
    if (clickCache.size > 50) clickCache.clear();
    clickCache.set(key, make());
  }
  return clickCache.get(key)!;
}

const sectionClick = (section: Section) =>
  cachedClick(section, () => {
    const { bars, length } = sectionInfo(section);
    return clickPattern(bars, length);
  });

/** One bar of clicks in the meter where playback starts, played before the song. */
export function countIn(): { cycles: number; pattern: Pattern } {
  const s = state();
  const bars = s.playMode === 'song' ? songTimeline(s.project).bars : sectionInfo(selectedSection(s)).bars;
  const bar = barAtTick(bars, startPosition() * TPW);
  return { cycles: bar.length / TPW, pattern: clickPattern([{ ...bar, index: 0, start: 0 }], bar.length) };
}

const audible = (p: Project) => {
  const anySolo = p.tracks.some((t) => t.solo);
  return p.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
};

const clipPattern = (t: Track, sectionId: string): Pattern => trackPattern(trackView(t, sectionId))?.pattern ?? silence;

const chains = new Map<string, (p: Pattern) => Pattern>();
/** Applies a Strudel method chain (e.g. `.swingBy(0.1, 8)`) to a pattern; Strudel's functions are global after evalScope. */
function chain(code: string): (p: Pattern) => Pattern {
  let fn = chains.get(code);
  if (!fn) {
    fn = new Function('p', `"use strict"; return p${code};`) as (p: Pattern) => Pattern;
    chains.set(code, fn);
  }
  return fn;
}

function withOutput(t: Track, pattern: Pattern): Pattern | undefined {
  try {
    const mods = modifiersCode(t.modifiers, state().project.bpm);
    if (mods) pattern = chain(mods)(pattern);
    return applyOutput(pattern, t.output, t.gain, t.kind === 'kit' ? kitPitch(t.lanes ?? []) : undefined);
  } catch (e) {
    console.warn(`track ${t.name}:`, e);
    return undefined;
  }
}

const combine = (pats: (Pattern | undefined)[]) => {
  const ok = pats.filter((p): p is Pattern => !!p);
  return ok.length ? stack(...ok) : silence;
};

/** Every track's clip for one section, plus the metronome. */
function sectionPattern(sectionId: string): Pattern {
  const { project, metronome } = state();
  const pats = audible(project).map((t) => withOutput(t, clipPattern(t, sectionId)));
  if (metronome) pats.push(sectionClick(findSection(project, sectionId)));
  return combine(pats);
}

/** Every track's clips laid out with Strudel's arrange(), plus the metronome. */
function songPattern(): Pattern {
  const { project, metronome } = state();
  const tl = songTimeline(project);
  if (!tl.instances.length) return silence;
  const pats = audible(project).map((t) =>
    withOutput(t, core.arrange(...tl.instances.map((i) => [i.length / TPW, clipPattern(t, i.section.id)]))),
  );
  if (metronome) pats.push(cachedClick(project.sections.length + project.arrangement.join(), () => clickPattern(tl.bars, tl.length)));
  return combine(pats);
}

const currentPattern = () => (state().playMode === 'song' ? songPattern() : sectionPattern(state().selectedSectionId));

function rebuild() {
  engine.setPattern(currentPattern());
  engine.setCps(cpsFromBpm(state().project.bpm));
}

export async function play() {
  const s = state();
  engine.setPattern(currentPattern());
  await engine.play(startPosition(), loopRange(), s.armed && s.countIn ? countIn() : undefined, s.selectedSectionId);
}

/** Section mode while playing: the newly selected section starts at the next bar of the one playing. */
function launchSelected() {
  const s = state();
  const playingId = engine.tag() ?? s.selectedSectionId;
  const loop = engine.loop;
  const bounds = sectionInfo(findSection(s.project, playingId))
    .bars.map((b) => b.start / TPW)
    .filter((b) => b >= loop.start && b < loop.start + loop.len);
  engine.switchAt(bounds.length ? bounds : [loop.start], sectionPattern(s.selectedSectionId), loopRange(), s.selectedSectionId);
}

/** A clip variation was switched while playing: the new music starts on the next bar, the position carries on. */
function switchOnNextBar() {
  const s = state();
  const bars = s.playMode === 'song' ? songTimeline(s.project).bars : sectionInfo(findSection(s.project, engine.tag() ?? s.selectedSectionId)).bars;
  engine.switchAt(
    bars.map((b) => b.start / TPW),
    currentPattern(),
    engine.loop,
    undefined,
    true,
  );
}

export function startSync() {
  rebuild();
  useStore.subscribe((s, prev) => {
    if (s.playMode !== prev.playMode && s.playing) {
      engine.stop();
      play();
      return;
    }
    if (s.selectedSectionId !== prev.selectedSectionId && s.playMode === 'section' && s.playing) {
      launchSelected();
      return;
    }
    if (s.variationSwitch !== prev.variationSwitch && s.playing) {
      switchOnNextBar();
      return;
    }
    const contentChanged =
      s.project !== prev.project ||
      s.metronome !== prev.metronome ||
      (s.playMode === 'section' && s.selectedSectionId !== prev.selectedSectionId);
    if (contentChanged) rebuild();
    const lengthChanged =
      s.loop !== prev.loop ||
      s.project.sections !== prev.project.sections ||
      s.project.arrangement !== prev.project.arrangement ||
      s.selectedSectionId !== prev.selectedSectionId;
    if (lengthChanged) engine.setLoop(loopRange());
  });

  // song mode: keep the editor on the section being played
  const follow = () => {
    requestAnimationFrame(follow);
    const s = state();
    if (!s.playing || s.playMode !== 'song' || !s.follow) return;
    const at = playhead();
    if (at && at.sectionId !== s.selectedSectionId) s.selectSection(at.sectionId);
  };
  requestAnimationFrame(follow);
}
