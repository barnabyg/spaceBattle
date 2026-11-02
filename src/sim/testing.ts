import type { BattleSetup, Scenario, SideSetup } from './battle';
import { parseDesign, type ComponentDesign, type ComponentType, type Design } from './design';
import { vec3 } from './vector';

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
