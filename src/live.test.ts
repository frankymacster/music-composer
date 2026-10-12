import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const clock = { raw: undefined as number | undefined };
vi.mock('./strudel/engine', () => ({
  engine: {
    rawNow: () => clock.raw,
    songPos: (raw: number) => raw,
    tagAt: () => undefined,
    loop: { start: 0, len: 4 },
    preview: () => {},
    midiNoteOn: () => {},
    midiNoteOff: () => {},
  },
  listenMidiInputs: () => {},
}));

const { baseScope } = await import('./strudel/scope');
const { useStore, selectedTrack } = await import('./store');
const live = await import('./live');
const { TPW } = await import('./music/time');

beforeAll(async () => {
  await baseScope();
});

let trackId = '';
beforeEach(() => {
  const s = useStore.getState();
  s.addTrack('notes');
  trackId = useStore.getState().selectedTrackId;
  s.set({ armed: true, cursor: 0, snap: TPW / 16, inputQuantize: false });
  live.startTake();
  clock.raw = undefined;
});
const notes = () => selectedTrack(useStore.getState())!.notes.map(({ pitch, start, dur }) => ({ pitch, start, dur }));

describe('live input', () => {
  it('step input writes chords at the cursor and advances it', () => {
    live.noteOn('a', 60, 0.8);
    live.noteOn('b', 64, 0.8);
    live.noteOff('a');
    live.noteOff('b');
    live.noteOn('a', 62, 0.8);
    live.noteOff('a');
    expect(notes()).toEqual([
      { pitch: 60, start: 0, dur: 120 },
      { pitch: 64, start: 0, dur: 120 },
      { pitch: 62, start: 120, dur: 120 },
    ]);
    expect(useStore.getState().cursor).toBe(240);
  });

  it('records held notes in real time, with optional input quantize', () => {
    clock.raw = 0.26;
    live.noteOn('a', 60, 0.8);
    clock.raw = 0.5;
    live.noteOff('a');
    const grid = TPW / 128;
    expect(notes()).toEqual([{ pitch: 60, start: Math.round((0.26 * TPW) / grid) * grid, dur: Math.round((0.24 * TPW) / grid) * grid }]);

    useStore.getState().set({ inputQuantize: true });
    clock.raw = 1.02;
    live.noteOn('b', 67, 0.8);
    clock.raw = 1.1;
    live.noteOff('b');
    expect(notes()[1].start).toBe(TPW);
  });

  it('one undo step per take', () => {
    clock.raw = 0.1;
    live.noteOn('a', 60, 1);
    live.noteOff('a');
    live.noteOn('b', 62, 1);
    live.noteOff('b');
    expect(notes()).toHaveLength(2);
    useStore.getState().undo();
    expect(notes()).toHaveLength(0);
  });

  it('captures what was played without recording', () => {
    useStore.getState().set({ armed: false });
    clock.raw = 0.5;
    live.noteOn('a', 60, 0.8);
    clock.raw = 0.75;
    live.noteOff('a');
    expect(notes()).toHaveLength(0);
    expect(live.capturable()).toBe(1);
    expect(live.capture()).toBe(1);
    expect(notes()).toEqual([{ pitch: 60, start: TPW / 2, dur: TPW / 4 }]);
    expect(live.capturable()).toBe(0);
  });
});

describe('quantize', () => {
  it('moves note starts toward the grid by the strength', () => {
    const s = useStore.getState();
    s.setNotes(trackId, [{ id: 'q', pitch: 60, start: 100, dur: 120, vel: 1 }]);
    s.set({ quantizeStrength: 0.5 });
    s.quantize(trackId, new Set());
    expect(notes()[0].start).toBe(110);
  });
});
