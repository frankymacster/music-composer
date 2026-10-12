import { beforeAll, describe, expect, it } from 'vitest';
import { baseScope } from './strudel/scope';
import { migrate, useStore, type Project } from './store';

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
    const after = useStore.getState().project.tracks.find((x) => x.id === t.id)!;
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
    const kick = useStore.getState().project.tracks.find((x) => x.id === t.id)!.lanes!.find((l) => l.sample === 'bd')!;
    expect(s.updateLane(t.id, { ...kick, note: 38 })).toMatch(/used by another lane/);
    expect(s.updateLane(t.id, { ...kick, note: 35, bank: 'RolandTR808' })).toBeUndefined();
    const after = useStore.getState().project.tracks.find((x) => x.id === t.id)!;
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
    } as unknown as Project;
    const t = migrate(old).tracks[0];
    expect(t.kind).toBe('kit');
    expect(t.output).toEqual({ type: 'kit' });
    expect(t.code).toBe('s(`bd ~@15`).bank("RolandTR909")');
  });
});
