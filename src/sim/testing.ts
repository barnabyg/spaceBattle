import type { BattleSetup, Scenario, SideSetup } from './battle';
import {
  KILOTON,
  parseDesign,
  type ChargedParticleBeamDesign,
  type ComponentDesign,
  type ComponentType,
  type Design,
  type KineticGunDesign,
  type LaserDesign,
  type LauncherDesign,
  type MagazineDesign,
  type MissileDesign,
  type MountedComponentDesign,
  type NeutralParticleBeamDesign,
  type PointDefenceDesign,
  type SectionDesign,
  type SectionKind,
} from './design';
import { fromAxisAngle, type Quat } from './quaternion';
import { vec3, ZERO } from './vector';

/** Test helpers for building battles. Not used by the game itself. */

/**
 * A frigate with a drive, thrusters, a reactor, a capacitor and a radiator, and nothing else.
 * Its reactor covers the drive at full throttle and its radiator sheds that heat even when
 * retracted, so power and heat never hold it back unless a test changes them.
 */
export const testDesign = (overrides: Partial<Design> = {}): Design => ({
  ...parseDesign({
    id: 'test',
    name: 'Test',
    hullSize: 'frigate',
    propellantMass: 300e3,
    sections: [
      { kind: 'forward', components: [] },
      {
        kind: 'middle',
        components: [
          { type: 'thrusters', mass: 20e3, torque: 8e6 },
          { type: 'reactor', mass: 10e3, output: 2e9, efficiency: 0.75 },
          { type: 'capacitor', mass: 5e3, capacity: 20e9, maxCharge: 0.5e9, maxDischarge: 5e9 },
        ],
        mounts: [
          {
            type: 'radiator',
            mass: 5e3,
            deployedArea: 40e3,
            retractedArea: 20e3,
            emissivity: 0.9,
          },
        ],
      },
      {
        kind: 'engine',
        components: [
          {
            type: 'drive',
            mass: 80e3,
            thrust: 2e6,
            exhaustVelocity: 150e3,
            power: 1.5e9,
            wasteHeatFraction: 0.1,
          },
        ],
      },
    ],
  }),
  ...overrides,
});

/** A design with some numbers of every component of one type changed. */
export const withComponent = <T extends ComponentType>(
  design: Design,
  type: T,
  changes: Partial<Omit<Extract<ComponentDesign, { type: T }>, 'type'>>,
): Design => {
  const change = <C extends ComponentDesign>(component: C): C =>
    component.type === type ? { ...component, ...changes } : component;
  return {
    ...design,
    sections: design.sections.map((section) => ({
      ...section,
      components: section.components.map(change),
      mounts: section.mounts.map(change),
    })),
  };
};

/** A section of a design changed. */
export const withSection = (
  design: Design,
  kind: SectionKind,
  changes: Partial<Omit<SectionDesign, 'kind'>>,
): Design => ({
  ...design,
  sections: design.sections.map((section) =>
    section.kind === kind ? { ...section, ...changes } : section,
  ),
});

/** A laser for test designs: a 400 MW ultraviolet beam from a 4 m mirror. */
export const TEST_LASER: LaserDesign = {
  type: 'laser',
  mass: 20e3,
  beamPower: 400e6,
  efficiency: 0.4,
  aperture: 4,
  wavelength: 250e-9,
};

/** The test design with the test laser on a forward mount. */
export const armedTestDesign = (): Design =>
  withSection(testDesign(), 'forward', { mounts: [TEST_LASER] });

/** Joules in an electronvolt. */
const ELECTRONVOLT = 1.602176634e-19;

/**
 * A charged particle beam for test designs: 400 MW of 20 GeV protons from a 1 m emitter, spreading
 * at 0.1 µrad before its own charge pushes it apart.
 */
export const TEST_CHARGED_BEAM: ChargedParticleBeamDesign = {
  type: 'charged-particle-beam',
  mass: 30e3,
  beamPower: 400e6,
  efficiency: 0.5,
  aperture: 1,
  divergence: 1e-7,
  particleEnergy: 20e9 * ELECTRONVOLT,
};

/** A neutral particle beam for test designs, from the same accelerator as the charged one. */
export const TEST_NEUTRAL_BEAM: NeutralParticleBeamDesign = {
  type: 'neutral-particle-beam',
  mass: 30e3,
  beamPower: 400e6,
  efficiency: 0.5,
  aperture: 1,
  divergence: 1e-7,
};

/** The test design with a weapon, such as a particle beam, on a forward mount. */
export const withForwardWeapon = (weapon: MountedComponentDesign): Design =>
  withSection(testDesign(), 'forward', { mounts: [weapon] });

/**
 * A kinetic gun for test designs: 1 kg slugs at 20 km/s, one a second. Each shot takes
 * ½mv²/efficiency = 400 MJ, so it draws 400 MW while it fires.
 */
export const TEST_KINETIC_GUN: KineticGunDesign = {
  type: 'kinetic-gun',
  mass: 20e3,
  slugMass: 1,
  muzzleVelocity: 20e3,
  efficiency: 0.5,
  rateOfFire: 1,
};

/** A magazine for test designs holding `slugs` slugs. */
export const testMagazine = (slugs: number): MagazineDesign => ({
  type: 'magazine',
  mass: 5e3,
  slugs,
  rounds: 0,
  missiles: 0,
  missile: null,
});

/** The test design with the test kinetic gun on a forward mount and a magazine of `slugs`. */
export const gunnedTestDesign = (slugs: number): Design =>
  withSection(testDesign(), 'forward', {
    components: [testMagazine(slugs)],
    mounts: [TEST_KINETIC_GUN],
  });

/**
 * A missile for test designs: 2 t at launch, half of it propellant, with a 50 kN drive at 20 km/s
 * exhaust velocity, so 25–50 m/s² and a delta-v of 20 km/s × ln 2 ≈ 13.9 km/s over a 400 s burn.
 */
export const TEST_MISSILE: MissileDesign = {
  name: 'Test missile',
  dryMass: 1e3,
  propellantMass: 1e3,
  thrust: 50e3,
  exhaustVelocity: 20e3,
  warhead: { type: 'kinetic' },
};

/**
 * The test missile with a 10 kt nuclear warhead, whose proximity fuse sets it off 2 km from its
 * target's centre of mass.
 */
export const TEST_NUCLEAR_MISSILE: MissileDesign = {
  ...TEST_MISSILE,
  name: 'Test nuclear missile',
  warhead: { type: 'nuclear', yield: 10 * KILOTON, detonationDistance: 2_000 },
};

/** A launcher for test designs that takes 10 s to reload. */
export const TEST_LAUNCHER: LauncherDesign = { type: 'launcher', mass: 5e3, reloadTime: 10 };

/** A magazine for test designs holding `missiles` missiles of a design. */
export const missileMagazine = (
  missiles: number,
  missile: MissileDesign = TEST_MISSILE,
): MagazineDesign => ({
  type: 'magazine',
  mass: 5e3 + missiles * (missile.dryMass + missile.propellantMass),
  slugs: 0,
  rounds: 0,
  missiles,
  missile,
});

/**
 * The test design with `launchers` test launchers on forward mounts and a magazine of `missiles`
 * missiles of a design.
 */
export const launchingTestDesign = (
  missiles: number,
  { missile = TEST_MISSILE, launchers = 1 }: { missile?: MissileDesign; launchers?: number } = {},
): Design =>
  withSection(testDesign(), 'forward', {
    components: [missileMagazine(missiles, missile)],
    mounts: Array.from({ length: launchers }, () => TEST_LAUNCHER),
  });

/**
 * A point defence gun for test designs: bursts of 20 rounds of 50 g at 5 km/s, five bursts a
 * second, spreading 2 mrad. Each burst takes 20 × ½mv² / 0.5 = 25 MJ, so it draws 125 MW while it
 * fires, and it reaches 5 km/s × 5 s = 25 km.
 */
export const TEST_POINT_DEFENCE: PointDefenceDesign = {
  type: 'point-defence',
  mass: 10e3,
  roundMass: 0.05,
  muzzleVelocity: 5e3,
  efficiency: 0.5,
  roundsPerBurst: 20,
  burstRate: 5,
  dispersion: 2e-3,
};

/** A magazine for test designs holding `rounds` point defence rounds. */
export const roundsMagazine = (rounds: number): MagazineDesign => ({
  type: 'magazine',
  mass: 5e3,
  slugs: 0,
  rounds,
  missiles: 0,
  missile: null,
});

/**
 * The test design with `mounts` test point defence guns on middle mounts beside its radiator, and
 * a magazine of `rounds` rounds for them in the forward section.
 */
export const defendedTestDesign = ({
  mounts = 1,
  rounds = 10_000,
}: { mounts?: number; rounds?: number } = {}): Design => {
  const design = testDesign();
  const middle = design.sections.find((s) => s.kind === 'middle');
  return withSection(
    withSection(design, 'middle', {
      mounts: [
        ...(middle?.mounts ?? []),
        ...Array.from({ length: mounts }, () => TEST_POINT_DEFENCE),
      ],
    }),
    'forward',
    { components: [roundsMagazine(rounds)] },
  );
};

/** Turns red's nose (+x) to point back along −x, at blue. */
export const FACING_BLUE: Quat = fromAxisAngle(vec3(0, 0, 1), Math.PI);

/**
 * Two ships at rest `range` metres apart: blue at the origin, red out along +x. Red faces blue
 * nose-on unless given another orientation.
 */
export const duelSetup = (
  blue: Design,
  red: Design,
  range: number,
  redOrientation: Quat = FACING_BLUE,
): BattleSetup => ({
  seed: 1,
  scenario: {
    name: 'Duel',
    starts: [
      { position: ZERO, velocity: ZERO },
      { position: vec3(range, 0, 0), velocity: ZERO, orientation: redOrientation },
    ],
  },
  sides: testSides([blue, red]),
});

export const testScenario: Scenario = {
  name: 'Test',
  starts: [
    { position: vec3(-100_000e3, 0, 0), velocity: vec3(1_000, 500, 0) },
    { position: vec3(100_000e3, 0, 0), velocity: vec3(-1_000, 0, 250) },
  ],
};

export const testSides = (designs: readonly [Design, Design] = [testDesign(), testDesign()]) =>
  [
    { id: 'blue', name: 'Blue', commander: 'player', design: designs[0] },
    { id: 'red', name: 'Red', commander: 'computer', design: designs[1] },
  ] satisfies SideSetup[];

export const testSetup = (overrides: Partial<BattleSetup> = {}): BattleSetup => ({
  seed: 1,
  scenario: testScenario,
  sides: testSides(),
  ...overrides,
});
