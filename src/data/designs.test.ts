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
  const valid = {
    id: 'x',
    name: 'X',
    hullSize: 'frigate',
    propellantMass: 1000,
    sections: [
      { kind: 'forward', components: [] },
      { kind: 'middle', components: [{ type: 'thrusters', mass: 1, torque: 1 }] },
      { kind: 'engine', components: [{ type: 'drive', mass: 1, thrust: 1, exhaustVelocity: 1 }] },
    ],
  };

  it('accepts a complete design', () => {
    expect(parseDesign(valid).name).toBe('X');
  });

  it('rejects data that is not a design', () => {
    expect(() => parseDesign(null)).toThrow();
    expect(() => parseDesign({ ...valid, hullSize: 'dreadnought' })).toThrow(/hullSize/);
    expect(() => parseDesign({ ...valid, name: undefined })).toThrow(/name/);
    expect(() => parseDesign({ ...valid, propellantMass: -1 })).toThrow(/propellantMass/);
  });

  it('needs every section in order and exactly one drive, in the engine section', () => {
    expect(() => parseDesign({ ...valid, sections: valid.sections.slice(1) })).toThrow(/sections/);
    const [forward, middle, engine] = valid.sections;
    expect(() => parseDesign({ ...valid, sections: [forward, middle, forward] })).toThrow();
    expect(() =>
      parseDesign({ ...valid, sections: [forward, { ...middle, components: [] }, engine] }),
    ).toThrow(/thrusters/);
    expect(() =>
      parseDesign({
        ...valid,
        sections: [
          { ...forward, components: engine?.components },
          middle,
          { ...engine, components: [] },
        ],
      }),
    ).toThrow(/engine section/);
  });
});
