import { useStore } from '../store';
import { SHORTCUTS } from '../commands';

export function ShortcutsOverlay() {
  const open = useStore((s) => s.showShortcuts);
  const set = useStore((s) => s.set);
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => set({ showShortcuts: false })}>
      <div className="shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <b>Keyboard shortcuts</b>
          <span className="hint">Single keys are off while ⌨ Keys is on · ? or Esc to close</span>
        </div>
        <div className="shortcuts-grid">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h4>{g.group}</h4>
              {g.items.map(([keys, what]) => (
                <div key={keys + what} className="sc">
                  <kbd>{keys}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
