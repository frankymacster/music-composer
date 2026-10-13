import { describe, expect, it } from 'vitest';
import { gridStep, toggleTriplet, TRANSFORMS } from './commands';
import { TPW } from './music/time';

describe('grid shortcuts', () => {
  it('steps finer and coarser within a family', () => {
    expect(gridStep(TPW / 16, true)).toBe(TPW / 32);
    expect(gridStep(TPW / 16, false)).toBe(TPW / 8);
    expect(gridStep(TPW / 32, true)).toBe(TPW / 32);
    expect(gridStep(0, false)).toBe(0);
    expect(gridStep(TPW / 12, true)).toBe(TPW / 24);
    expect(gridStep(1, true)).toBe(TPW / 16);
  });
  it('toggles triplets at the same resolution', () => {
    expect(toggleTriplet(TPW / 8)).toBe(TPW / 12);
    expect(toggleTriplet(TPW / 12)).toBe(TPW / 8);
    expect(toggleTriplet(TPW / 16)).toBe(TPW / 24);
    expect(toggleTriplet(TPW / 24)).toBe(TPW / 16);
  });
  it('every transform has a unique shortcut', () => {
    const combos = TRANSFORMS.map((t) => t.combo.label);
    expect(new Set(combos).size).toBe(combos.length);
  });
});
