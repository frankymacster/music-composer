import { useState } from 'react';
import { useStore, COLORS, type Track } from '../store';
import { SOUNDFONTS, SYNTHS, soundLabel } from '../sounds';
import { enableMidi } from '../strudel/engine';
import { DRUM_BANKS } from '../music/drums';

function OutputSelect({ track }: { track: Track }) {
  const update = useStore((s) => s.updateTrack);
  const midiPorts = useStore((s) => s.midiPorts);
  const set = useStore((s) => s.set);
  const out = track.output;
  const value = out.type === 'synth' ? `synth:${out.sound}` : out.type === 'kit' ? `kit:${out.bank}` : out.type;
  const drums = track.kind === 'drums';

  const onChange = async (v: string) => {
    if (v.startsWith('synth:')) update(track.id, { output: { type: 'synth', sound: v.slice(6) } });
    else if (v.startsWith('kit:')) update(track.id, { output: { type: 'kit', bank: v.slice(4) } });
    else if (v === 'code') update(track.id, { output: { type: 'code' } });
    else if (v === 'midi') {
      let ports = midiPorts;
      if (!ports.length) {
        try {
          ports = await enableMidi();
          set({ midiPorts: ports });
        } catch (e) {
          alert(`Web MIDI unavailable: ${e instanceof Error ? e.message : e}`);
          return;
        }
      }
      update(track.id, { output: { type: 'midi', port: ports[0] ?? 'IAC', channel: drums ? 10 : 1 } });
    }
  };

  return (
    <div className="output">
      <select value={value} onChange={(e) => onChange(e.target.value)} onClick={(e) => e.stopPropagation()}>
        {drums ? (
          <optgroup label="Drum kits">
            <option value="kit:">Default kit</option>
            {DRUM_BANKS.map((b) => (
              <option key={b} value={`kit:${b}`}>
                {b}
              </option>
            ))}
          </optgroup>
        ) : (
          <>
            <optgroup label="Built-in synths">
              {SYNTHS.map((s) => (
                <option key={s} value={`synth:${s}`}>
                  {s}
                </option>
              ))}
            </optgroup>
            <optgroup label="General MIDI soundfonts">
              {SOUNDFONTS.map((s) => (
                <option key={s} value={`synth:${s}`}>
                  {soundLabel(s)}
                </option>
              ))}
            </optgroup>
          </>
        )}
        <optgroup label="Other">
          <option value="midi">Web MIDI out…</option>
          <option value="code">Defined in code</option>
        </optgroup>
      </select>
      {out.type === 'midi' && (
        <div className="row" onClick={(e) => e.stopPropagation()}>
          <select value={out.port} onChange={(e) => update(track.id, { output: { ...out, port: e.target.value } })}>
            {!midiPorts.includes(out.port) && <option value={out.port}>{out.port} (offline)</option>}
            {midiPorts.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={out.channel} onChange={(e) => update(track.id, { output: { ...out, channel: +e.target.value } })} title="MIDI channel">
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                ch {i + 1}
              </option>
            ))}
          </select>
        </div>
      )}
      {out.type !== 'midi' && (
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={track.gain}
          title={`Volume ${Math.round(track.gain * 100)}%`}
          onPointerDown={() => useStore.getState().checkpoint()}
          onChange={(e) => update(track.id, { gain: +e.target.value }, false)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

function TrackRow({ track, selected }: { track: Track; selected: boolean }) {
  const update = useStore((s) => s.updateTrack);
  const remove = useStore((s) => s.removeTrack);
  const set = useStore((s) => s.set);
  const [editing, setEditing] = useState(false);

  return (
    <div className={`track ${selected ? 'selected' : ''}`} onClick={() => set({ selectedTrackId: track.id })} style={{ '--c': track.color } as React.CSSProperties}>
      <div className="track-head">
        <button
          className="swatch"
          title="Change colour"
          onClick={(e) => {
            e.stopPropagation();
            update(track.id, { color: COLORS[(COLORS.indexOf(track.color) + 1) % COLORS.length] });
          }}
        />
        {editing ? (
          <input
            className="name-input"
            autoFocus
            defaultValue={track.name}
            onBlur={(e) => {
              update(track.id, { name: e.target.value || track.name });
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="name" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {track.name}
          </span>
        )}
        {track.kind === 'drums' && <span className="badge drums">drums</span>}
        <span className={`badge ${track.mode}`}>{track.mode}</span>
        <button
          className={`toggle ${track.mute ? 'on mute' : ''}`}
          title="Mute"
          onClick={(e) => {
            e.stopPropagation();
            update(track.id, { mute: !track.mute });
          }}
        >
          M
        </button>
        <button
          className={`toggle ${track.solo ? 'on solo' : ''}`}
          title="Solo"
          onClick={(e) => {
            e.stopPropagation();
            update(track.id, { solo: !track.solo });
          }}
        >
          S
        </button>
        <button
          className="toggle del"
          title="Delete track"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete track "${track.name}"?`)) remove(track.id);
          }}
        >
          ×
        </button>
      </div>
      <OutputSelect track={track} />
    </div>
  );
}

export function TrackList({ onCollapse }: { onCollapse: () => void }) {
  const tracks = useStore((s) => s.project.tracks);
  const selectedId = useStore((s) => s.selectedTrackId);
  const addTrack = useStore((s) => s.addTrack);
  return (
    <div className="track-list">
      <div className="panel-title">
        Tracks
        <span className="spacer" />
        <button onClick={() => addTrack('notes')} title="Add an instrument track">
          + Inst
        </button>
        <button onClick={() => addTrack('drums')} title="Add a drum track">
          + Drums
        </button>
        <button className="icon" onClick={onCollapse} title="Collapse tracks">
          ‹
        </button>
      </div>
      {tracks.map((t) => (
        <TrackRow key={t.id} track={t} selected={t.id === selectedId} />
      ))}
    </div>
  );
}
