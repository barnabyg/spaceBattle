import { describe, expect, it } from 'vitest';
import { parseDesign } from '../sim/design';
import { HAND_MADE_DESIGNS } from './designs';

describe('hand-made designs', () => {
  it('are valid designs with unique ids', () => {
    expect(HAND_MADE_DESIGNS.length).toBeGreaterThanOrEqual(2);
    expect(new Set(HAND_MADE_DESIGNS.map((d) => d.id)).size).toBe(HAND_MADE_DESIGNS.length);
  });

  it('carry armour on every section and at least one weapon', () => {
    for (const design of HAND_MADE_DESIGNS) {
      for (const section of design.sections) expect(section.armour.thickness).toBeGreaterThan(0);
      expect(
        design.sections
          .flatMap((s) => s.mounts)
          .some((m) => m.type === 'laser' || m.type === 'kinetic-gun'),
      ).toBe(true);
    }
  });

  it('include one carrying kinetic guns and a magazine for them', () => {
    const gunned = HAND_MADE_DESIGNS.find((d) =>
      d.sections.some((s) => s.mounts.some((m) => m.type === 'kinetic-gun')),
    );
    expect(gunned?.sections.flatMap((s) => s.components).some((c) => c.type === 'magazine')).toBe(
      true,
    );
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

  it('reads armour and lasers, and leaves a section without armour unarmoured', () => {
    const laser = {
      type: 'laser',
      mass: 1,
      beamPower: 1,
      efficiency: 0.4,
      aperture: 1,
      wavelength: 1e-7,
    };
    const armour = { type: 'ablative', thickness: 0.05 };
    const design = parseDesign({ ...valid, sections: [{ ...forward, armour }, middle, engine] });
    expect(design.sections[0]?.armour).toEqual(armour);
    expect(design.sections[1]?.armour).toEqual({ type: 'heavy', thickness: 0 });
    expect(parseDesign(withMiddle([thrusters, reactor], [laser])).sections[1]?.mounts).toEqual([
      laser,
    ]);
    expect(() => parseDesign(withMiddle([thrusters, reactor, laser]))).toThrow(/mount/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...laser, efficiency: 1.5 }])),
    ).toThrow(/efficiency/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...laser, aperture: 0 }])),
    ).toThrow(/aperture/);
    expect(() =>
      parseDesign({
        ...valid,
        sections: [{ ...forward, armour: { type: 'cardboard', thickness: 1 } }, middle, engine],
      }),
    ).toThrow(/type/);
    expect(() =>
      parseDesign({
        ...valid,
        sections: [{ ...forward, armour: { type: 'heavy', thickness: -1 } }, middle, engine],
      }),
    ).toThrow(/thickness/);
  });

  it('reads kinetic guns on mounts and magazines inside, and needs a magazine for the guns', () => {
    const gun = {
      type: 'kinetic-gun',
      mass: 1,
      slugMass: 1,
      muzzleVelocity: 1,
      efficiency: 0.5,
      rateOfFire: 1,
    };
    const magazine = { type: 'magazine', mass: 1, slugs: 10 };
    const design = parseDesign(withMiddle([thrusters, reactor, magazine], [gun]));
    expect(design.sections[1]?.components[2]).toEqual(magazine);
    expect(design.sections[1]?.mounts).toEqual([gun]);
    expect(() => parseDesign(withMiddle([thrusters, reactor], [gun]))).toThrow(/magazine/);
    expect(() => parseDesign(withMiddle([thrusters, reactor, magazine, gun]))).toThrow(/mount/);
    expect(() => parseDesign(withMiddle([thrusters, reactor], [magazine]))).toThrow(
      /inside a section/,
    );
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor, magazine], [{ ...gun, efficiency: 0 }])),
    ).toThrow(/efficiency/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor, magazine], [{ ...gun, muzzleVelocity: -1 }])),
    ).toThrow(/muzzleVelocity/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor, { ...magazine, slugs: 2.5 }], [gun])),
    ).toThrow(/slugs/);
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
