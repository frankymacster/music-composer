import { beforeAll, describe, expect, it } from 'vitest';
import { baseScope } from './strudel/scope';
import { migrate, selectedTrack, trackView, useStore } from './store';

beforeAll(async () => {
  await baseScope();
});

const kitTrack = () => {
  const s = useStore.getState();
  s.addTrack('kit');
  return useStore.getState().project.tracks.at(-1)!;
};

describe('kit tracks', () => {
  it('typing a new sample in grid-shaped code adds a lane', () => {
    const t = kitTrack();
    useStore.getState().setCode(t.id, 's("bd arpy:2 ~ bd").slow(4)');
    const after = selectedTrack(useStore.getState())!;
    expect(after.mode).toBe('grid');
    const arpy = after.lanes!.find((l) => l.sample === 'arpy:2')!;
    expect(arpy).toBeDefined();
    expect(after.lanes![0]).toBe(arpy);
    expect(after.notes.filter((n) => n.pitch === arpy.note)).toHaveLength(1);
    expect(after.notes.filter((n) => n.pitch === 36)).toHaveLength(2);
  });

  it('changing a lane note moves its hits and rejects duplicates', () => {
    const t = kitTrack();
    const s = useStore.getState();
    s.setCode(t.id, 's("bd sd")');
    const kick = selectedTrack(useStore.getState())!.lanes!.find((l) => l.sample === 'bd')!;
    expect(s.updateLane(t.id, { ...kick, note: 38 })).toMatch(/used by another lane/);
    expect(s.updateLane(t.id, { ...kick, note: 35, bank: 'RolandTR808' })).toBeUndefined();
    const after = selectedTrack(useStore.getState())!;
    expect([...new Set(after.notes.map((n) => n.pitch))].sort()).toEqual([35, 38]);
    expect(after.code).toContain('.bank("RolandTR808")');
  });

  it('migrates old drum tracks with a track-level bank', () => {
    const old = {
      version: 1,
      song: { bpm: 120, bars: 1, meters: [{ bar: 0, num: 4, den: 4 }] },
      tracks: [
        {
          id: 'd', name: 'Drums', color: '#fff', kind: 'drums', code: '', mode: 'grid', gain: 1, mute: false, solo: false,
          output: { type: 'kit', bank: 'RolandTR909' },
          notes: [{ id: 'n', pitch: 36, start: 0, dur: 120, vel: 1 }],
        },
      ],
    };
    const p = migrate(old);
    const t = p.tracks[0];
    expect(p.version).toBe(2);
    expect(p.sections).toHaveLength(1);
    expect(p.arrangement).toEqual([p.sections[0].id]);
    expect(t.kind).toBe('kit');
    expect(t.output).toEqual({ type: 'kit' });
    expect(t.clips[p.sections[0].id].code).toBe('s(`bd ~@15`).bank("RolandTR909")');
  });
});

describe('variations', () => {
  it('euclid fill writes one lane across the section', async () => {
    const t = kitTrack();
    const s = useStore.getState();
    s.euclidFill(t.id, 36, 3, 8, 0, 240);
    const view = selectedTrack(useStore.getState())!;
    const starts = view.notes.filter((n) => n.pitch === 36).map((n) => n.start % 1920);
    expect([...new Set(starts)].sort((a, b) => a - b)).toEqual([0, 720, 1440]);
    expect(view.code).toContain('s(`bd');
  });

  it('transforms replace only the selection', () => {
    const s = useStore.getState();
    s.addTrack('notes');
    const id = useStore.getState().selectedTrackId;
    s.setNotes(id, [
      { id: 'a', pitch: 60, start: 0, dur: 120, vel: 1 },
      { id: 'b', pitch: 64, start: 480, dur: 120, vel: 1 },
    ]);
    s.select(new Set(['b']));
    s.transformNotes(id, (ns) => ns.map((n) => ({ ...n, pitch: n.pitch + 1 })));
    const pitches = selectedTrack(useStore.getState())!.notes.map((n) => n.pitch).sort();
    expect(pitches).toEqual([60, 65]);
  });

  it('modifiers are appended to the exported track', async () => {
    const { songCode } = await import('./songCode');
    const s = useStore.getState();
    const id = s.selectedTrackId;
    s.addModifier(id, 'swing16');
    const code = songCode(useStore.getState().project);
    expect(code).toContain('.swingBy(0.12, 8)');
  });
});

describe('chord progressions', () => {
  it('writes voice-led chords and a bass line, one per bar', () => {
    const s = useStore.getState();
    s.addTrack('notes');
    const chordsId = useStore.getState().selectedTrackId;
    s.addTrack('notes');
    const bassId = useStore.getState().selectedTrackId;
    useStore.getState().set({ selectedTrackId: chordsId });
    s.setBars(4);
    expect(s.writeProgression(chordsId, 'Am F C G', { bars: 1 }, true, bassId)).toBeUndefined();
    const st = useStore.getState();
    const view = selectedTrack(st)!;
    const starts = [...new Set(view.notes.map((n) => n.start))];
    expect(starts).toEqual([0, 1920, 3840, 5760]);
    const bass = trackView(st.project.tracks.find((t) => t.id === bassId)!, st.selectedSectionId).notes;
    expect(bass.map((n) => n.pitch % 12)).toEqual([9, 5, 0, 7]);
    expect(s.writeProgression(chordsId, 'Am Xq', { bars: 1 }, true)).toMatch(/Can't read chord/);
  });
});
