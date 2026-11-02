import type { BattleSetup, Scenario, SideSetup } from './battle';
import { parseDesign, type Design } from './design';
import { vec3 } from './vector';

/** Test helpers for building battles. Not used by the game itself. */

/** A frigate with a drive and thrusters and nothing else. */
export const testDesign = (overrides: Partial<Design> = {}): Design => ({
  ...parseDesign({
    id: 'test',
    name: 'Test',
    hullSize: 'frigate',
    propellantMass: 300e3,
    sections: [
      { kind: 'forward', components: [] },
      { kind: 'middle', components: [{ type: 'thrusters', mass: 20e3, torque: 8e6 }] },
      {
        kind: 'engine',
        components: [{ type: 'drive', mass: 80e3, thrust: 2e6, exhaustVelocity: 150e3 }],
      },
    ],
  }),
  ...overrides,
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
