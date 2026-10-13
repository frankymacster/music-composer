export interface Scale {
  root: number;
  mode: string;
}

export const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  'harmonic major': [0, 2, 4, 5, 7, 8, 11],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  'hungarian minor': [0, 2, 3, 6, 7, 8, 11],
  'whole tone': [0, 2, 4, 6, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
};

export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function inScale(scale: Scale | undefined, pitch: number): boolean {
  if (!scale) return true;
  return (MODES[scale.mode] ?? MODES.major).includes((((pitch - scale.root) % 12) + 12) % 12);
}

export const isRoot = (scale: Scale | undefined, pitch: number) => !!scale && (((pitch - scale.root) % 12) + 12) % 12 === 0;

/** Nearest in-scale pitch (ties go down). */
export function snapToScale(pitch: number, scale: Scale | undefined): number {
  if (!scale) return pitch;
  for (let d = 0; d <= 6; d++) {
    if (pitch - d >= 0 && inScale(scale, pitch - d)) return pitch - d;
    if (pitch + d <= 127 && inScale(scale, pitch + d)) return pitch + d;
  }
  return pitch;
}

/** Signed number of scale steps from `a` to `b` (both snapped to the scale). */
export function scaleDistance(a: number, b: number, scale: Scale): number {
  const from = snapToScale(a, scale);
  const to = snapToScale(b, scale);
  let steps = 0;
  const dir = Math.sign(to - from);
  for (let p = from; p !== to; p += dir) if (inScale(scale, p + dir)) steps += dir;
  return steps;
}

/** The `index`-th scale note counting up from the root at or below `pitch` (index 0 = that root). */
export function scaleDegree(index: number, rootFrom: number, scale: Scale): number {
  let p = rootFrom - ((((rootFrom - scale.root) % 12) + 12) % 12);
  for (let i = 0; i < index; ) {
    p++;
    if (inScale(scale, p)) i++;
  }
  return p;
}
