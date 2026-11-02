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
  const radiator = {
    type: 'radiator',
    mass: 1,
    deployedArea: 2,
    retractedArea: 1,
    emissivity: 0.9,
  };
  const reactor = { type: 'reactor', mass: 1, output: 1, efficiency: 0.5 };
  const thrusters = { type: 'thrusters', mass: 1, torque: 1 };
  const valid = {
    id: 'x',
    name: 'X',
    hullSize: 'frigate',
    propellantMass: 1000,
    sections: [
      { kind: 'forward', components: [] },
      {
        kind: 'middle',
        components: [
          { type: 'thrusters', mass: 1, torque: 1 },
          { type: 'reactor', mass: 1, output: 1, efficiency: 0.5 },
          { type: 'capacitor', mass: 1, capacity: 1, maxCharge: 1, maxDischarge: 1 },
        ],
        mounts: [radiator],
      },
      {
        kind: 'engine',
        components: [
          { type: 'drive', mass: 1, thrust: 1, exhaustVelocity: 1, power: 1, wasteHeatFraction: 0 },
        ],
      },
    ],
  };
  const [forward, middle, engine] = valid.sections;
  /** The valid design with the middle section's components and mounts replaced. */
  const withMiddle = (components: unknown[], mounts: unknown[] = []) => ({
    ...valid,
    sections: [forward, { ...middle, components, mounts }, engine],
  });

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

  it('reads mounts, which may be left out', () => {
    const design = parseDesign(valid);
    expect(design.sections[1]?.mounts).toEqual([radiator]);
    expect(design.sections[0]?.mounts).toEqual([]);
  });

  it('needs exactly one reactor, inside a section, and radiators on mounts', () => {
    expect(() => parseDesign(withMiddle([thrusters]))).toThrow(/reactor/);
    expect(() => parseDesign(withMiddle([thrusters, reactor, reactor]))).toThrow(/reactor/);
    expect(() => parseDesign(withMiddle([thrusters, reactor, radiator]))).toThrow(/mount/);
    expect(() => parseDesign(withMiddle([thrusters], [reactor]))).toThrow(/inside a section/);
  });

  it('rejects power and heat numbers outside their range', () => {
    expect(() => parseDesign(withMiddle([thrusters, { ...reactor, efficiency: 1.2 }]))).toThrow(
      /efficiency/,
    );
    expect(() => parseDesign(withMiddle([thrusters, { ...reactor, output: 0 }]))).toThrow(/output/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...radiator, retractedArea: 3 }])),
    ).toThrow(/retractedArea/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...radiator, emissivity: 0 }])),
    ).toThrow(/emissivity/);
    const drive = engine?.components[0];
    expect(() =>
      parseDesign({
        ...valid,
        sections: [
          forward,
          middle,
          { ...engine, components: [{ ...drive, wasteHeatFraction: -0.1 }] },
        ],
      }),
    ).toThrow(/wasteHeatFraction/);
  });
});
