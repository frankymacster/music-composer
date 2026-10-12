# Music Composer

Piano-roll + Strudel composer. Every track is Strudel code; the grid is one way of writing it.

```
npm install
npm run dev
npm test
```

Web MIDI needs Chrome, Edge or Firefox (not Safari).

## Model

- 1 Strudel cycle = 1 whole note. `setcpm(bpm/4)`; time signatures only move bar lines, so meter changes mid-song are free.
- **Grid track**: notes are the source; code is generated as `note(...)`/`stack(...)` + `.velocity()` + `.slow(songCycles)`.
  Editing that code keeps it a grid track as long as it stays in that shape (`src/music/canonical.ts`).
- **Code track**: anything else. The roll shows read-only notes from `pattern.queryArc`. **Bake to grid** flattens it into notes.
- Playback stacks all tracks, then `.ribbon(loopStart, loopLen)` for song/loop-region looping.

## Controls

| | |
|---|---|
| Space | play / stop (from cursor) |
| B | toggle draw mode |
| double-click empty / note | create / delete note |
| drag note, drag right edge | move, resize (Shift = no snap) |
| ⌥/⌘-drag note | duplicate |
| drag empty | marquee select (also sets cursor) |
| ↑/↓ (⇧ = octave), ←/→ | transpose, nudge by snap |
| ⌘A ⌘C ⌘X ⌘V ⌘D | select all, copy, cut, paste at cursor, duplicate |
| ⌘Z / ⇧⌘Z | undo / redo |
| wheel, ⇧-wheel, ⌘-wheel, ⌥-wheel | scroll, horizontal scroll, zoom time, zoom pitch |
| Meter strip (top of ruler) | click a bar to set its time signature |
| Bar-number strip | click = jump, drag = loop region |
| ⌘↵ in editor | apply code immediately |

Built on Strudel (AGPL-3.0-or-later), so this project is AGPL too.
