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

## Sections and arrangement

- **Sections** (Verse, Chorus…) each have their own length and time signatures; every track has one clip per section.
  The piano roll and code editor work on the selected section. **+ Section**, **⧉ Duplicate** (copies all clips),
  double-click a chip to rename, **+** on a chip appends it to the song.
- **Song** strip: the arrangement, blocks sized by length; drag to reorder, × to remove.
- **Section** play mode loops the section being edited; clicking another section while playing launches it at the next
  bar (scene-style). **Song** mode plays the arrangement; **Follow** keeps the editor on the section being heard.
- Export: each track becomes `const track_section = …` per section and `arrange([4, verse], [4, chorus], …)`.

## Writing faster

- **Chords…** (instrument tracks): type `Am F C G`, `Dm7 G7 Cmaj7` or Roman numerals `vi IV I V` (in the Scale's key);
  chords are voice-led, repeated to fill the section, optionally with a bass line written to another track.
- **Chord** stamp: drawn notes become triads/7ths/sus4 — diatonic when a Scale is set.
- **Transform…** on the selection (or all notes): reverse, invert, double/half speed, legato, strum, humanize, arpeggiate ↑↓↕.
- **Euclid…**: a Euclidean rhythm (Strudel's `x(k,n)`) on a lane or pitch across the section.
- **Modifiers** (per track, live, all sections): swing 8ths/16ths, drop notes, stutter, octave jumps, reverse every N
  bars, echo, filter sweep — appended as Strudel code (`.swingBy(…)`, `.degradeBy(…)`, …) and visible in the export.
- **Ghosts**: other instrument tracks' notes shown faintly in the roll. With a Scale set, ↑/↓ move notes by scale step.

## Key and scale

**Key** (roll toolbar) sets a root and scale (major/minor modes, pentatonics, blues, harmonic major, phrygian dominant,
whole tone, hirajoshi…). It shades in-key rows, makes the chord stamp diatonic, sets the key for Roman numerals,
makes ↑/↓ move by scale step, and keeps generated melodies in key. With **In key** on (default): drawn and dragged
notes snap to the scale, the computer keyboard plays consecutive scale notes (every key is "right"), MIDI input snaps
to the nearest scale note, and Invert mirrors by scale degree.

## Chords, generators, chance, variations

- **Chord lane** (row under the bar numbers): the section's harmony. Click empty space to add a chord, click a chord to
  change or delete it; **Chords…** can fill it from a progression. Chord tones are tinted in the roll, and
  **Chord tones** (⌥T) snaps drawn notes to them.
- **🎲 Generate…** (⌥G): bass (groove, roots, pulse, root–fifth, octaves, walking), arpeggio, pads (sustained,
  off-beat, Charleston, stabs), melody, and drum grooves (house, hip-hop, rock, breakbeat, optional fill/crash). Parts
  follow the chord lane and the key: change a chord and generated parts update. **Reroll** (⌥⇧G) tries a new seed;
  editing the notes by hand freezes the part.
- **Chance**: the bottom lane's *Chance* tab sets per-note probability; it becomes Strudel's `?` (`c4?0.3` = dropped
  30% of the time) and stays grid-editable.
- **Clip variations**: **+** (⌥=) copies the clip into a new version; **A B C…** (⌥1–⌥9) switch between them — while
  playing, on the next bar. ⌥-click a chip to delete it.

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

Press **?** in the app for the full shortcut list. Highlights for drawing and transforms:

| | |
|---|---|
| `,` / `.` · `/` · `\` | finer / coarser grid · triplet ↔ straight · snap on/off |
| `⌥C` | cycle chord stamp (off → triad → 7th → sus4) |
| `⇧←/→` · `⌥↑/↓` · `⌥←/→` | note length ± grid · velocity ± 10% · nudge 1/128 |
| `⌥R` `⌥I` `⌥D` `⌥⇧D` `⌥L` `⌥S` `⌥H` | reverse, invert, double / half speed, legato, strum, humanize |
| `⌥A` `⌥⇧A` `⌥U` | arpeggiate ↑ ↓ ↕ |
| `⌥K` · `⌥E` | Chords… · Euclid… |
| click a piano key / lane name | select that whole row (⇧ adds, drag for several) — then ↑↓ / Delete |


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
