import { describe, expect, it } from 'vitest';
import { KILOTON, parseDesign } from '../sim/design';
import { HAND_MADE_DESIGNS } from './designs';

describe('hand-made designs', () => {
  it('are valid designs with unique ids', () => {
    expect(HAND_MADE_DESIGNS.length).toBeGreaterThanOrEqual(2);
    expect(new Set(HAND_MADE_DESIGNS.map((d) => d.id)).size).toBe(HAND_MADE_DESIGNS.length);
  });

  it('carry armour on every section and at least one weapon', () => {
    for (const design of HAND_MADE_DESIGNS) {
      for (const section of design.sections) expect(section.armour.thickness).toBeGreaterThan(0);
      expect(design.sections.flatMap((s) => s.mounts).some((m) => m.type !== 'radiator')).toBe(
        true,
      );
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

  it.each(['charged-particle-beam', 'neutral-particle-beam'] as const)(
    'include one carrying a %s',
    (type) => {
      expect(
        HAND_MADE_DESIGNS.some((d) =>
          d.sections.some((s) => s.mounts.some((m) => m.type === type)),
        ),
      ).toBe(true);
    },
  );

  it('include one carrying launchers and a magazine of missiles with kinetic warheads', () => {
    const launching = HAND_MADE_DESIGNS.find((d) =>
      d.sections.some((s) => s.mounts.some((m) => m.type === 'launcher')),
    );
    const magazines = launching?.sections
      .flatMap((s) => s.components)
      .flatMap((c) => (c.type === 'magazine' && c.missile ? [c.missile] : []));
    expect(magazines?.map((missile) => missile.warhead.type)).toContain('kinetic');
  });

  it('include one carrying missiles with nuclear warheads, kept out of its middle section', () => {
    const nuclear = HAND_MADE_DESIGNS.find((d) =>
      d.sections.some((s) =>
        s.components.some((c) => c.type === 'magazine' && c.missile?.warhead.type === 'nuclear'),
      ),
    );
    expect(nuclear).toBeDefined();
    // A magazine of nuclear missiles that blows up takes its section with it.
    const middle = nuclear?.sections.find((s) => s.kind === 'middle');
    expect(middle?.components.some((c) => c.type === 'magazine')).toBe(false);
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

  it('reads charged and neutral particle beams on mounts', () => {
    const neutral = {
      type: 'neutral-particle-beam',
      mass: 1,
      beamPower: 1,
      efficiency: 0.5,
      aperture: 1,
      divergence: 1e-7,
    };
    const charged = { ...neutral, type: 'charged-particle-beam', particleEnergy: 3e-9 };
    const design = parseDesign(withMiddle([thrusters, reactor], [charged, neutral]));
    expect(design.sections[1]?.mounts).toEqual([charged, neutral]);
    expect(() => parseDesign(withMiddle([thrusters, reactor, neutral]))).toThrow(/mount/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...charged, particleEnergy: undefined }])),
    ).toThrow(/particleEnergy/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...neutral, divergence: 0 }])),
    ).toThrow(/divergence/);
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor], [{ ...neutral, efficiency: 1.5 }])),
    ).toThrow(/efficiency/);
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
    const magazine = { type: 'magazine', mass: 100, slugs: 10 };
    const design = parseDesign(withMiddle([thrusters, reactor, magazine], [gun]));
    expect(design.sections[1]?.components[2]).toEqual({ ...magazine, missiles: 0, missile: null });
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
    // A magazine weighs more than the slugs it holds.
    expect(() =>
      parseDesign(withMiddle([thrusters, reactor, magazine], [{ ...gun, slugMass: 10 }])),
    ).toThrow(/mass/);
  });

  it('reads launchers on mounts and magazines of missiles, and needs missiles for the launchers', () => {
    const launcher = { type: 'launcher', mass: 1, reloadTime: 10 };
    const missile = {
      name: 'Dart',
      dryMass: 1_000,
      propellantMass: 1_000,
      thrust: 50e3,
      exhaustVelocity: 20e3,
      warhead: { type: 'kinetic' },
    };
    const magazine = { type: 'magazine', mass: 10e3, missiles: 4, missile };
    const design = parseDesign(withMiddle([thrusters, reactor, magazine], [launcher]));
    expect(design.sections[1]?.components[2]).toEqual({ ...magazine, slugs: 0 });
    expect(design.sections[1]?.mounts).toEqual([launcher]);
    const slugs = { type: 'magazine', mass: 100, slugs: 10 };
    const launching = (...components: unknown[]) =>
      parseDesign(withMiddle([thrusters, reactor, ...components], [launcher]));
    expect(() => launching()).toThrow(/launchers need a magazine of missiles/);
    expect(() => launching(slugs)).toThrow(/launchers need a magazine of missiles/);
    expect(() => launching({ ...magazine, slugs: 10 })).toThrow(/not both/);
    expect(() => launching({ ...magazine, missile: undefined })).toThrow(/missile/);
    expect(() => launching({ ...magazine, mass: 8_000 })).toThrow(/mass/);
    expect(() => launching({ ...magazine, missiles: 1.5 })).toThrow(/missiles/);
    expect(() => launching({ ...magazine, missile: { ...missile, thrust: 0 } })).toThrow(/thrust/);
    expect(() =>
      launching({ ...magazine, missile: { ...missile, warhead: { type: 'antimatter' } } }),
    ).toThrow(/type/);
    expect(() => launching({ type: 'magazine', mass: 100 })).toThrow(/slugs or missiles/);
    expect(() => parseDesign(withMiddle([thrusters, reactor, launcher]))).toThrow(/mount/);
  });

  it('reads nuclear warheads of up to 10 kt, with a detonation distance', () => {
    const launcher = { type: 'launcher', mass: 1, reloadTime: 10 };
    const warhead = { type: 'nuclear', yield: 10 * KILOTON, detonationDistance: 2_000 };
    const armed = (nuclear: unknown) =>
      parseDesign(
        withMiddle(
          [
            thrusters,
            reactor,
            {
              type: 'magazine',
              mass: 10e3,
              missiles: 4,
              missile: {
                name: 'Ember',
                dryMass: 1_000,
                propellantMass: 1_000,
                thrust: 50e3,
                exhaustVelocity: 20e3,
                warhead: nuclear,
              },
            },
          ],
          [launcher],
        ),
      );
    const magazine = armed(warhead).sections[1]?.components[2];
    expect(magazine?.type === 'magazine' && magazine.missile?.warhead).toEqual(warhead);
    expect(() => armed({ ...warhead, yield: 10.01 * KILOTON })).toThrow(/yield.*10 kt/);
    expect(() => armed({ ...warhead, yield: 0 })).toThrow(/yield/);
    expect(() => armed({ ...warhead, yield: undefined })).toThrow(/yield/);
    expect(armed({ ...warhead, detonationDistance: 0 })).toBeDefined();
    expect(() => armed({ ...warhead, detonationDistance: -1 })).toThrow(/detonationDistance/);
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
