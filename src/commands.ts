import { uid } from './store';
import { TPW } from './music/time';
import { arpeggiate, humanize, invert, legato, reverse, stretch, strum } from './music/transforms';
import type { Note } from './music/codegen';
import type { ChordStamp } from './music/chords';

/** A key combination, matched on `KeyboardEvent.code` so ⌥ (which changes `key` on macOS) works. */
export interface Combo {
  code: string;
  alt?: boolean;
  shift?: boolean;
  label: string;
}

export const matches = (e: KeyboardEvent, c: Combo) =>
  e.code === c.code && !!c.alt === e.altKey && !!c.shift === e.shiftKey && !e.metaKey && !e.ctrlKey;

export const stepTicks = (snap: number) => (snap > 1 ? snap : TPW / 16);

export interface Transform {
  label: string;
  combo: Combo;
  run: (notes: Note[], snap: number) => Note[];
}

const alt = (letter: string, shift = false): Combo => ({
  code: `Key${letter}`,
  alt: true,
  shift,
  label: `⌥${shift ? '⇧' : ''}${letter}`,
});

export const TRANSFORMS: Transform[] = [
  { label: 'Reverse', combo: alt('R'), run: (n) => reverse(n) },
  { label: 'Invert', combo: alt('I'), run: (n) => invert(n) },
  { label: 'Double speed', combo: alt('D'), run: (n) => stretch(n, 0.5) },
  { label: 'Half speed', combo: alt('D', true), run: (n) => stretch(n, 2) },
  { label: 'Legato', combo: alt('L'), run: (n) => legato(n) },
  { label: 'Strum', combo: alt('S'), run: (n) => strum(n, TPW / 96) },
  { label: 'Humanize', combo: alt('H'), run: (n) => humanize(n, TPW / 128, 0.08) },
  { label: 'Arpeggiate ↑', combo: alt('A'), run: (n, snap) => arpeggiate(n, stepTicks(snap), 'up', uid) },
  { label: 'Arpeggiate ↓', combo: alt('A', true), run: (n, snap) => arpeggiate(n, stepTicks(snap), 'down', uid) },
  { label: 'Arpeggiate ↕', combo: alt('U'), run: (n, snap) => arpeggiate(n, stepTicks(snap), 'updown', uid) },
];

export const OPEN_CHORDS = alt('K');
export const OPEN_EUCLID = alt('E');
export const CYCLE_CHORD = alt('C');

export const CHORD_STAMPS: ChordStamp[] = ['off', 'triad', 'seventh', 'sus4'];

const STRAIGHT = [0, TPW / 2, TPW / 4, TPW / 8, TPW / 16, TPW / 32];
const TRIPLET = [TPW / 6, TPW / 12, TPW / 24, TPW / 48];

/** Next grid size in the same family (straight or triplet): `finer` halves the step. */
export function gridStep(snap: number, finer: boolean): number {
  if (snap === 1) return TPW / 16;
  const family = TRIPLET.includes(snap) ? TRIPLET : STRAIGHT;
  const i = family.indexOf(snap);
  return family[Math.max(0, Math.min(family.length - 1, i + (finer ? 1 : -1)))];
}

/** Same resolution in the other family: 1/8 ↔ 1/8T, 1/16 ↔ 1/16T… */
export function toggleTriplet(snap: number): number {
  if (TRIPLET.includes(snap)) return STRAIGHT[TRIPLET.indexOf(snap) + 2];
  const i = STRAIGHT.indexOf(snap);
  return i >= 2 ? TRIPLET[Math.min(i - 2, TRIPLET.length - 1)] : TPW / 24;
}

/** Everything listed in the `?` overlay. */
export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Draw',
    items: [
      ['B', 'Draw mode: drag paints notes, drag over notes erases (⌥ = follow pitch)'],
      [', / .', 'Finer / coarser grid'],
      ['/', 'Triplet ↔ straight grid'],
      ['\\', 'Snap on / off'],
      [CYCLE_CHORD.label, 'Cycle chord stamp: off → triad → 7th → sus4'],
      ['Double-click', 'Add note (select mode) · delete note'],
      ['Click a key', 'Select its whole row (⇧ adds, drag for several rows)'],
    ],
  },
  {
    group: 'Edit selection',
    items: [
      ['↑ / ↓', 'Transpose (scale step when a Scale is set) · ⇧ = octave'],
      ['← / →', 'Move by one grid step'],
      ['⇧← / ⇧→', 'Shorter / longer by one grid step'],
      ['⌥← / ⌥→', 'Nudge by 1/128'],
      ['⌥↑ / ⌥↓', 'Velocity ± 10%'],
      ['⌘A ⌘C ⌘X ⌘V ⌘D', 'Select all, copy, cut, paste at cursor, duplicate'],
      ['⌘U', 'Quantize'],
      ['Delete', 'Delete'],
    ],
  },
  {
    group: 'Transform (selection, or all notes)',
    items: [
      ...TRANSFORMS.map((t): [string, string] => [t.combo.label, t.label]),
      [OPEN_CHORDS.label, 'Chords…'],
      [OPEN_EUCLID.label, 'Euclid…'],
    ],
  },
  {
    group: 'Play',
    items: [
      ['Space', 'Play / stop'],
      ['M', 'Computer keyboard plays notes (A–; notes, Z/X octave, C/V velocity)'],
      ['F9', 'Record'],
      ['⌘Z / ⇧⌘Z', 'Undo / redo'],
      ['?', 'This list'],
    ],
  },
];
