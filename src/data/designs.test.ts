import { describe, expect, it } from 'vitest';
import { parseDesign } from '../sim/design';
import { HAND_MADE_DESIGNS } from './designs';

describe('hand-made designs', () => {
  it('are valid designs with unique ids', () => {
    expect(HAND_MADE_DESIGNS.length).toBeGreaterThanOrEqual(2);
    expect(new Set(HAND_MADE_DESIGNS.map((d) => d.id)).size).toBe(HAND_MADE_DESIGNS.length);
  });
});

describe('parseDesign', () => {
  it('rejects data that is not a design', () => {
    expect(() => parseDesign(null)).toThrow();
    expect(() => parseDesign({ id: 'x', name: 'X', hullSize: 'dreadnought' })).toThrow(/hull size/);
    expect(() => parseDesign({ id: 'x', hullSize: 'frigate' })).toThrow(/name/);
  });
});
