import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { code2hash } from '@strudel/core';
import { useStore, selectedTrack, compileCached, trackPattern, type Track } from '../store';
import { engine } from '../strudel/engine';
import { songCode } from '../songCode';
import { download } from '../files';

const setActive = StateEffect.define<[number, number][]>();
const activeMark = Decoration.mark({ class: 'cm-active-hap' });
const activeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setActive)) {
        const len = tr.state.doc.length;
        deco = Decoration.set(
          e.value.filter(([a, b]) => a < b && b <= len).map(([a, b]) => activeMark.range(a, b)),
          true,
        );
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#141518', color: '#d7dae0', height: '100%', fontSize: '13px' },
    '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#f5a524' },
    '.cm-gutters': { backgroundColor: '#141518', color: '#555a62', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(79,179,255,0.25) !important' },
    '.cm-active-hap': { outline: '1.5px solid #f5a524', borderRadius: '2px', backgroundColor: 'rgba(245,165,36,0.18)' },
  },
  { dark: true },
);

const baseExtensions = [javascript(), theme, EditorView.lineWrapping];

function useHapHighlight(ref: React.RefObject<ReactCodeMirrorRef | null>, track: Track | undefined) {
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const view = ref.current?.view;
      if (!view || !track) return;
      let ranges: [number, number][] = [];
      const c = trackPattern(track);
      if (engine.playing && c && view.state.doc.toString() === track.code) {
        const pos = engine.position();
        try {
          for (const hap of c.pattern.queryArc(pos, pos + 1e-4)) {
            if (!hap.whole || hap.whole.begin.valueOf() > pos) continue;
            for (const loc of hap.context?.locations ?? []) ranges.push([loc.start, loc.end]);
          }
        } catch {
          ranges = [];
        }
        ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      }
      const key = ranges.map((r) => r.join(':')).join(',');
      if (key !== lastKey) {
        lastKey = key;
        view.dispatch({ effects: setActive.of(ranges) });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, track]);
}

function TrackEditor({ track }: { track: Track }) {
  const setCode = useStore((s) => s.setCode);
  const bake = useStore((s) => s.bake);
  const [doc, setDoc] = useState(track.code);
  const sent = useRef(track.code);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ref = useRef<ReactCodeMirrorRef>(null);
  useHapHighlight(ref, track);

  useEffect(() => {
    if (track.code !== sent.current) {
      sent.current = track.code;
      setDoc(track.code);
    }
  }, [track.code]);

  useEffect(() => {
    clearTimeout(timer.current);
    sent.current = track.code;
    setDoc(track.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const commit = (value: string) => {
    clearTimeout(timer.current);
    sent.current = value;
    setCode(track.id, value);
  };

  const compiled = compileCached(track.code);
  const pending = doc !== track.code;

  return (
    <div className="editor-wrap">
      <div className={`mode-banner ${track.mode}`}>
        {track.mode === 'grid' ? (
          <>
            <b>GRID</b> Generated from the piano roll. Edits that stay in <code>note / stack / velocity / slow</code> form stay
            editable in the grid.
          </>
        ) : (
          <>
            <b>CODE</b> Free Strudel code. The piano roll shows a read-only preview.
            <button
              onClick={() => {
                if (confirm('Bake this track into grid notes? Transformations are flattened; non-note events (e.g. drum samples) are dropped.'))
                  bake(track.id);
              }}
            >
              Bake to grid
            </button>
          </>
        )}
      </div>
      <div
        className="editor"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            commit(doc);
          }
        }}
      >
        <CodeMirror
          ref={ref}
          value={doc}
          height="100%"
          theme="none"
          extensions={[...baseExtensions, activeField]}
          basicSetup={{ foldGutter: false, highlightActiveLine: true }}
          onChange={(value) => {
            setDoc(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(value), 400);
          }}
        />
      </div>
      <div className={`status ${compiled.ok ? '' : 'error'}`}>
        {pending ? 'Editing… (⌘↵ to apply)' : compiled.ok ? '✓ Compiled' : `✗ ${compiled.error} (playing last valid version)`}
      </div>
    </div>
  );
}

function SongView() {
  const project = useStore((s) => s.project);
  const code = useMemo(() => songCode(project), [project]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="editor-wrap">
      <div className="mode-banner song">
        <span>The whole song as one Strudel program (read-only).</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => download('song.strudel.js', code, 'text/javascript')}>Export .js</button>
        <a className="btn" href={`https://strudel.cc/#${code2hash(code)}`} target="_blank" rel="noreferrer">
          Open in strudel.cc ↗
        </a>
      </div>
      <div className="editor">
        <CodeMirror value={code} height="100%" theme="none" editable={false} extensions={baseExtensions} basicSetup={{ foldGutter: false }} />
      </div>
    </div>
  );
}

export function CodePanel() {
  const track = useStore(selectedTrack);
  const [tab, setTab] = useState<'track' | 'song'>('track');
  return (
    <div className="code-panel">
      <div className="tabs">
        <button className={tab === 'track' ? 'active' : ''} onClick={() => setTab('track')}>
          {track ? track.name : 'Track'}
        </button>
        <button className={tab === 'song' ? 'active' : ''} onClick={() => setTab('song')}>
          Song
        </button>
      </div>
      {tab === 'track' ? track ? <TrackEditor track={track} /> : <div className="empty">No track selected</div> : <SongView />}
    </div>
  );
}
