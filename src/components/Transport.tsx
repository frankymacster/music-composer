import { useEffect, useRef, useState } from 'react';
import { useStore, songInfo, migrate, type Project } from '../store';
import { engine, enableMidi, onMidiChange } from '../strudel/engine';
import { loopRange, countIn } from '../sync';
import * as live from '../live';
import { ROOTS } from '../music/scale';
import { TPW, barAtTick } from '../music/time';
import { songCode } from '../songCode';
import { download, openFile } from '../files';

export async function togglePlay() {
  const s = useStore.getState();
  if (s.playing) {
    live.releaseAll();
    engine.stop();
    s.set({ playing: false });
  } else {
    live.startTake();
    await engine.play(s.cursor / TPW, loopRange(), s.armed && s.countIn ? countIn(s.cursor) : undefined);
    s.set({ playing: true });
  }
}

function LiveControls() {
  const s = useStore();
  const track = s.project.tracks.find((t) => t.id === s.selectedTrackId);
  const [count, setCount] = useState(live.capturable());
  useEffect(() => live.onLiveChange(() => setCount(live.capturable())), []);
  useEffect(() => setCount(live.capturable()), [s.selectedTrackId]);
  const canRecord = track?.mode === 'grid';
  return (
    <div className="group">
      <button
        className={`rec ${s.armed ? 'on' : ''} ${s.armed && s.playing ? 'live' : ''}`}
        onClick={() => s.set({ armed: !s.armed })}
        disabled={!canRecord && !s.armed}
        title={
          canRecord
            ? 'Record (F9). Playing: overdub into the selected track. Stopped: step input at the cursor.'
            : 'Code tracks can\'t be recorded into — Bake to grid first'
        }
      >
        ● Rec
      </button>
      <button className={`toggle-btn ${s.countIn ? 'on' : ''}`} onClick={() => s.set({ countIn: !s.countIn })} title="One-bar count-in when starting to record">
        1 bar
      </button>
      <button className={`toggle-btn ${s.metronome ? 'on' : ''}`} onClick={() => s.set({ metronome: !s.metronome })} title="Metronome">
        ♩ Click
      </button>
      <button className={`toggle-btn ${s.inputQuantize ? 'on' : ''}`} onClick={() => s.set({ inputQuantize: !s.inputQuantize })} title="Quantize recorded notes to the snap grid">
        Q in
      </button>
      <button
        onClick={() => live.capture()}
        disabled={!count || !canRecord}
        title="Capture: turn what you just played (without recording) into notes on the selected track"
      >
        ⤓ Capture{count ? ` (${count})` : ''}
      </button>
      <button
        className={`toggle-btn ${s.keyboard ? 'on' : ''}`}
        onClick={() => {
          live.releaseAll();
          s.set({ keyboard: !s.keyboard });
        }}
        title="Computer keyboard plays notes (M). A–; = notes, Z/X = octave, C/V = velocity"
      >
        ⌨ Keys{s.keyboard ? ` ${track?.kind === 'kit' ? 'kit' : ROOTS[0] + s.octave} · vel ${Math.round(s.velocity * 127)}` : ''}
      </button>
    </div>
  );
}

function NumberField({ value, min, max, onCommit, width = 52 }: { value: number; min: number; max: number; onCommit: (v: number) => void; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= min && v <= max && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      type="number"
      style={{ width }}
      min={min}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Position() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = useStore.getState();
      const { bars } = songInfo(s.project.song);
      const t = s.playing ? engine.position() * TPW : s.cursor;
      const bar = barAtTick(bars, t);
      const beatLen = TPW / bar.den;
      const beat = Math.floor((t - bar.start) / beatLen) + 1;
      const sixteenth = Math.floor(((t - bar.start) % beatLen) / (TPW / 16)) + 1;
      if (ref.current)
        ref.current.textContent = engine.countingIn() ? 'count-in…' : `${bar.index + 1}.${beat}.${sixteenth}  ${bar.num}/${bar.den}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span className="position" ref={ref} />;
}

export function Transport() {
  const s = useStore();
  const { song } = s.project;
  const [midiState, setMidiState] = useState<'off' | 'on' | 'error'>('off');

  const enable = async () => {
    try {
      const ports = await enableMidi();
      s.set({ midiPorts: ports });
      live.listenMidi();
      setMidiState('on');
      onMidiChange((p) => useStore.getState().set({ midiPorts: p }));
    } catch (e) {
      setMidiState('error');
      alert(`Web MIDI unavailable: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="transport">
      <div className="group">
        <button className={`play ${s.playing ? 'on' : ''}`} onClick={togglePlay} title="Play / Stop (Space)">
          {s.playing ? '■' : '▶'}
        </button>
        <button
          className={`toggle-btn ${s.loop.enabled ? 'on' : ''}`}
          onClick={() => {
            const { bars } = songInfo(song);
            const endBar = Math.min(s.loop.endBar, bars.length);
            s.set({ loop: { ...s.loop, enabled: !s.loop.enabled, endBar: Math.max(endBar, s.loop.startBar + 1) } });
          }}
          title="Loop region (drag in the ruler to set)"
        >
          ⟳ Loop
        </button>
        <Position />
      </div>
      <LiveControls />
      <div className="group">
        <label>
          BPM <NumberField value={song.bpm} min={20} max={400} onCommit={s.setBpm} />
        </label>
        <label>
          Bars <NumberField value={song.bars} min={1} max={512} onCommit={s.setBars} width={46} />
        </label>
        <span className="hint">Time signatures: click the Meter strip above the bars</span>
      </div>
      <div className="group">
        <button onClick={s.undo} disabled={!s.past.length} title="Undo (⌘Z)">
          ↶
        </button>
        <button onClick={s.redo} disabled={!s.future.length} title="Redo (⇧⌘Z)">
          ↷
        </button>
      </div>
      <div className="group right">
        <button className={`toggle-btn ${midiState === 'on' ? 'on' : ''}`} onClick={enable} title="Enable Web MIDI output">
          MIDI {midiState === 'on' ? `· ${s.midiPorts.length} out` : midiState === 'error' ? '✗' : 'off'}
        </button>
        <button onClick={() => confirm('Start a new empty project? (Undo can bring it back.)') && s.newProject()}>New</button>
        <button
          onClick={async () => {
            try {
              const p = JSON.parse(await openFile('.json,application/json')) as Project;
              if (p?.version !== 1 || !Array.isArray(p.tracks)) throw new Error('Not a Music Composer project');
              s.setProject(migrate(p));
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Open
        </button>
        <button onClick={() => download('song.composer.json', JSON.stringify(s.project, null, 2), 'application/json')}>Save</button>
        <button onClick={() => download('song.strudel.js', songCode(s.project), 'text/javascript')}>Export</button>
      </div>
    </div>
  );
}
