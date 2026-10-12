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
- **Kit tracks** (`+ Kit`): one lane per sample, like a drum rack. Each lane has a name, a sample (`bd`, `cp:2`,
  `arpy:3`…), an optional drum-machine bank and a MIDI note, and is emitted as its own `s(...)[.bank(...)]` line in a `stack`.
  New kits start with the standard drum lanes; the track's *Kit* menu sets the bank of all of them at once.
  Typing a new sample into grid-shaped code adds a lane for it. Web MIDI sends each lane's note (default ch 10).
- Playback stacks all tracks, then `.ribbon(loopStart, loopLen)` for song/loop-region looping.

## Playing and recording

- **⌨ Keys** (M): the computer keyboard plays the selected track, Ableton-style. `A W S E D F T G Y H U J K O L P ;`
  are notes (kit tracks: lanes from the bottom up), `Z`/`X` octave, `C`/`V` velocity. **MIDI** enables Web MIDI out and
  keyboard/pad input.
- **● Rec** (F9) on the selected grid track:
  - stopped → *step input*: notes (or chords held together) are written at the cursor, which advances one grid step;
  - playing → *overdub*: held notes are recorded with their real length; each loop pass adds to the take (one undo step).
- **1 bar** count-in when starting to record, **♩ Click** metronome (follows meter changes), **Q in** quantizes recorded notes.
- **⤓ Capture**: play along without recording, then capture the last loop length of what you played into the track.
- Built-in sounds can't be released early in Strudel, so monitored notes ring for a fixed time; MIDI out monitors
  with real note-on/off. Recorded notes always get their held length (rounded to 1/128).

## Controls

| | |
|---|---|
| Space | play / stop (from cursor) |
| B | draw mode: click/drag paints grid-length notes on one row (⌥ = follow the pointer's pitch), drag over notes erases |
| Draw mode or ⌥ in the velocity lane | paint velocities |
| Fold | show only rows with notes (plus scale rows when a scale is set) |
| ⌘U / Quantize | quantize selection (or all) to the snap grid, with strength |
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
| Pane edges | drag to resize, double-click (or ‹ ›) to collapse |
| Kit lane ✎ / double-click, + Lane | edit lane (sample, bank, MIDI note, order), add lane |
| ⌘↵ in editor | apply code immediately |

Built on Strudel (AGPL-3.0-or-later), so this project is AGPL too.
