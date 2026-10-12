import { useEffect, useRef, useState } from 'react';
import { useStore, songTimeline } from '../store';
import { engine } from '../strudel/engine';
import { playhead } from '../sync';
import { locate } from '../music/arrangement';
import { TPW } from '../music/time';

/** Which section is sounding (section mode) and which arrangement block (song mode), updated every frame. */
function usePlaying() {
  const [playing, setPlaying] = useState<{ sectionId?: string; index?: number; progress: number }>({ progress: 0 });
  const last = useRef('');
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = useStore.getState();
      let next: { sectionId?: string; index?: number; progress: number } = { progress: 0 };
      if (s.playing) {
        const ph = playhead();
        if (s.playMode === 'song') {
          const tl = songTimeline(s.project);
          const loc = locate(tl, engine.position() * TPW);
          if (loc) next = { sectionId: loc.instance.section.id, index: loc.instance.index, progress: loc.tick / loc.instance.length };
        } else if (ph) next = { sectionId: ph.sectionId, progress: 0 };
      }
      const key = `${next.sectionId}|${next.index}|${Math.round(next.progress * 50)}`;
      if (key !== last.current) {
        last.current = key;
        setPlaying(next);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return playing;
}

export function ArrangementBar() {
  const s = useStore();
  const { sections, arrangement } = s.project;
  const tl = songTimeline(s.project);
  const playing = usePlaying();
  const [renaming, setRenaming] = useState<string>();
  const dragFrom = useRef<number>(undefined);
  const selected = s.selectedSectionId;

  return (
    <div className="arrangement">
      <div className="arr-row">
        <span className="arr-label">Sections</span>
        {sections.map((sec) => {
          const isPlaying = s.playing && playing.sectionId === sec.id;
          const queued = s.playing && s.playMode === 'section' && sec.id === selected && !isPlaying;
          return (
            <span
              key={sec.id}
              className={`chip ${sec.id === selected ? 'selected' : ''} ${isPlaying ? 'playing' : ''} ${queued ? 'queued' : ''}`}
              style={{ '--sc': sec.color } as React.CSSProperties}
              onClick={() => s.selectSection(sec.id)}
              onDoubleClick={() => setRenaming(sec.id)}
              title={
                s.playMode === 'section' && s.playing
                  ? 'Click to launch at the next bar · double-click to rename'
                  : 'Click to edit · double-click to rename'
              }
            >
              {isPlaying && <span className="dot">▶</span>}
              {renaming === sec.id ? (
                <input
                  autoFocus
                  defaultValue={sec.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    s.renameSection(sec.id, e.target.value);
                    setRenaming(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(undefined);
                  }}
                />
              ) : (
                <span>{sec.name}</span>
              )}
              <span className="meta">{sec.bars}</span>
              {queued && <span className="meta">next</span>}
              <button
                className="mini"
                title={`Add ${sec.name} to the end of the arrangement`}
                onClick={(e) => {
                  e.stopPropagation();
                  s.arrangeAppend(sec.id);
                }}
              >
                +
              </button>
            </span>
          );
        })}
        <button onClick={s.addSection} title="New empty section (added to the arrangement)">
          + Section
        </button>
        <button onClick={() => s.duplicateSection(selected)} title="Copy the selected section with all its clips">
          ⧉ Duplicate
        </button>
        <button
          disabled={sections.length < 2}
          onClick={() => {
            const sec = sections.find((x) => x.id === selected);
            if (sec && confirm(`Delete section "${sec.name}" and its clips on every track?`)) s.removeSection(selected);
          }}
          title="Delete the selected section"
        >
          Delete
        </button>
      </div>
      <div className="arr-row timeline">
        <span className="arr-label">Song</span>
        <div className="arr-blocks">
          {tl.instances.map((inst) => (
            <div
              key={inst.index}
              className={`block ${inst.section.id === selected ? 'selected' : ''} ${
                s.playing && s.playMode === 'song' && playing.index === inst.index ? 'playing' : ''
              }`}
              style={{ flexGrow: inst.length, '--sc': inst.section.color } as React.CSSProperties}
              draggable
              onDragStart={() => (dragFrom.current = inst.index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom.current !== undefined && dragFrom.current !== inst.index) s.arrangeMove(dragFrom.current, inst.index);
                dragFrom.current = undefined;
              }}
              onClick={() => s.selectSection(inst.section.id)}
              title={`${inst.section.name} · drag to reorder`}
            >
              {s.playing && s.playMode === 'song' && playing.index === inst.index && (
                <span className="progress" style={{ width: `${playing.progress * 100}%` }} />
              )}
              <span className="name">{inst.section.name}</span>
              <button
                className="mini remove"
                title="Remove from the arrangement"
                onClick={(e) => {
                  e.stopPropagation();
                  s.arrangeRemove(inst.index);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {!tl.instances.length && <span className="hint">Empty — use + on a section to add it</span>}
        </div>
        <span className="meta">{arrangement.length} parts</span>
      </div>
    </div>
  );
}
