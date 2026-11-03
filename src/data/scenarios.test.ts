import { describe, expect, it } from 'vitest';
import { createBattle, type SideObservation } from '../sim/battle';
import { testSides } from '../sim/testing';
import { add, dot, length, normalize, scale, sub, type Vec3 } from '../sim/vector';
import { handMadeDesign } from './designs';
import {
  CROSSING,
  HEAD_ON,
  PURSUIT,
  STARTING_SCENARIOS,
  startingScenario,
  type StartingScenario,
} from './scenarios';

/** Blue's Lance and Red's Bastion, set up in a scenario, before any time passes. */
const startIn = (scenario: StartingScenario) => {
  const battle = createBattle({
    seed: 1,
    scenario,
    sides: testSides([handMadeDesign('lance'), handMadeDesign('bastion')]),
  });
  return { blue: battle.observe('blue'), red: battle.observe('red') };
};

/** The enemy as a side sees it. */
const contactOf = (observation: SideObservation) => {
  const contact = observation.contacts[0];
  if (!contact) throw new Error('No contact');
  return contact;
};

/** The unit vector from a side's own ship towards its contact. */
const towardsContact = (observation: SideObservation): Vec3 =>
  normalize(sub(contactOf(observation).position, observation.ownShip.position));

/** Expects two unit vectors to point the same way, to within a fiftieth of a degree. */
const alongside = (a: Vec3, b: Vec3) => {
  expect(dot(a, b)).toBeCloseTo(1, 7);
};

describe('starting scenarios', () => {
  it('offer the opening pass first, then head-on, crossing and pursuit starts, by unique id', () => {
    expect(STARTING_SCENARIOS.map((s) => s.name)).toEqual([
      'Opening pass',
      'Head-on',
      'Crossing',
      'Pursuit',
    ]);
    expect(new Set(STARTING_SCENARIOS.map((s) => s.id)).size).toBe(STARTING_SCENARIOS.length);
    expect(startingScenario('pursuit')).toBe(PURSUIT);
    expect(() => startingScenario('nonesuch')).toThrow(/nonesuch/);
  });

  it.each(STARTING_SCENARIOS.map((s) => [s.name, s] as const))(
    '%s places the ships at its stated separation and relative velocity',
    (_, scenario) => {
      for (const side of Object.values(startIn(scenario))) {
        const contact = contactOf(side);
        const range = sub(contact.position, side.ownShip.position);
        const relativeVelocity = sub(contact.velocity, side.ownShip.velocity);
        expect(length(range)).toBeCloseTo(scenario.separation, -3); // to the nearest km
        expect(length(relativeVelocity)).toBeCloseTo(scenario.relativeSpeed, 0); // to the nearest m/s
        // The rate the range falls at.
        expect(-dot(normalize(range), relativeVelocity)).toBeCloseTo(scenario.closingSpeed, 0);
      }
    },
  );

  it.each(STARTING_SCENARIOS.map((s) => [s.name, s] as const))(
    '%s starts the ships a few hundred thousand km apart, closing',
    (_, scenario) => {
      expect(scenario.separation).toBeGreaterThanOrEqual(200_000e3);
      expect(scenario.separation).toBeLessThanOrEqual(500_000e3);
      expect(scenario.closingSpeed).toBeGreaterThan(0);
    },
  );

  it('head-on: the ships fly straight at each other, nose to nose', () => {
    const { blue, red } = startIn(HEAD_ON);
    for (const side of [blue, red]) {
      alongside(side.ownShip.nose, towardsContact(side));
      alongside(normalize(side.ownShip.velocity), towardsContact(side));
    }
    expect(HEAD_ON.closingSpeed).toBeCloseTo(HEAD_ON.relativeSpeed);
  });

  it('crossing: the ships fly on courses at right angles, each nose along its course', () => {
    const { blue, red } = startIn(CROSSING);
    expect(dot(normalize(blue.ownShip.velocity), normalize(red.ownShip.velocity))).toBeCloseTo(0);
    for (const side of [blue, red]) {
      alongside(side.ownShip.nose, normalize(side.ownShip.velocity));
    }
    // Neither is on a collision course: left alone, they pass each other tens of thousands of km
    // apart.
    const range = sub(red.ownShip.position, blue.ownShip.position);
    const relativeVelocity = sub(red.ownShip.velocity, blue.ownShip.velocity);
    const untilClosest = -dot(range, relativeVelocity) / dot(relativeVelocity, relativeVelocity);
    expect(length(add(range, scale(relativeVelocity, untilClosest)))).toBeGreaterThan(10_000e3);
  });

  it('pursuit: Blue chases Red along the same course, faster, Red running nose away', () => {
    const { blue, red } = startIn(PURSUIT);
    alongside(normalize(blue.ownShip.velocity), normalize(red.ownShip.velocity));
    alongside(blue.ownShip.nose, towardsContact(blue));
    alongside(normalize(blue.ownShip.velocity), towardsContact(blue));
    alongside(red.ownShip.nose, normalize(red.ownShip.velocity));
    expect(length(blue.ownShip.velocity)).toBeGreaterThan(length(red.ownShip.velocity));
  });
});
