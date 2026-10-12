import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@strudel/core';
import { baseScope } from './strudel/scope';
import { compile, hapsToNotes } from './strudel/compile';
import { useStore, clipOf, songTimeline } from './store';
import { songCode } from './songCode';
import { TPW } from './music/time';

const collected: unknown[] = [];

beforeAll(async () => {
  await baseScope({ setcpm: () => core.silence });
  core.Pattern.prototype.p = function () {
    collected.push(this);
    return this;
  };
});

describe('song export', () => {
  it('lays out every section with arrange() and runs as Strudel code', () => {
    // the demo's Arp track uses tonal's scale(), which doesn't load under Node
    const full = useStore.getState().project;
    const project = { ...full, tracks: full.tracks.filter((t) => t.name !== 'Arp') };
    const code = songCode(project);
    expect(code).toContain('arrange(');
    expect(code).toMatch(/const keys_verse = /);

    collected.length = 0;
    const c = compile(code);
    if (!c.ok) throw new Error(c.error + '\n' + code);
    expect(collected).toHaveLength(project.tracks.length);

    const tl = songTimeline(project);
    const keys = project.tracks[0];
    const songNotes = hapsToNotes(collected[0], tl.length);
    for (const inst of tl.instances) {
      const expected = clipOf(keys, inst.section.id).notes.map((n) => [n.pitch, n.start + inst.start]).sort();
      const got = songNotes
        .filter((n) => n.start >= inst.start && n.start < inst.start + inst.length)
        .map((n) => [n.pitch, n.start])
        .sort();
      expect(got).toEqual(expected);
    }
    expect(tl.length).toBe(16 * TPW);
  });

  it('a duplicated section is independent', () => {
    const s = useStore.getState();
    const verse = s.project.sections[0].id;
    s.selectSection(verse);
    s.duplicateSection(verse);
    const st = useStore.getState();
    const copy = st.selectedSectionId;
    expect(copy).not.toBe(verse);
    expect(st.project.arrangement.filter((id) => id === copy)).toHaveLength(1);
    const keys = st.project.tracks[0];
    st.setNotes(keys.id, []);
    const after = useStore.getState().project.tracks[0];
    expect(clipOf(after, copy).notes).toHaveLength(0);
    expect(clipOf(after, verse).notes.length).toBeGreaterThan(0);
  });

  it('section length only affects that section', () => {
    const s = useStore.getState();
    const [verse, chorus] = s.project.sections;
    s.selectSection(chorus.id);
    s.setBars(2);
    const p = useStore.getState().project;
    expect(p.sections.find((x) => x.id === chorus.id)!.bars).toBe(2);
    expect(p.sections.find((x) => x.id === verse.id)!.bars).toBe(4);
    expect(clipOf(p.tracks[0], chorus.id).code).toContain('.slow(2)');
    expect(clipOf(p.tracks[0], verse.id).code).toContain('.slow(4)');
  });
});
