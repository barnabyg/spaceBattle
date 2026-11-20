import { describe, expect, it } from 'vitest';
import { createBattle, type SideObservation } from '../sim/battle';
import { TEST_LASER, testDesign, testSides, withSection } from '../sim/testing';
import { relativeMotion } from '../game/relativeMotion';
import { add, dot, length, normalize, scale, sub, type Vec3 } from '../sim/vector';
import { designReach } from '../sim/weapons';
import { HAND_MADE_DESIGNS, handMadeDesign } from './designs';
import {
  CROSSING,
  HEAD_ON,
  MIN_START_SEPARATION,
  PURSUIT,
  scenarioFor,
  START_REACH_MARGIN,
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
        const motion = relativeMotion(side.ownShip, contact);
        expect(length(sub(contact.position, side.ownShip.position))).toBeCloseTo(
          scenario.separation,
          -3, // to the nearest km
        );
        expect(motion.relativeSpeed).toBeCloseTo(scenario.relativeSpeed, 0); // to the nearest m/s
        expect(motion.closingSpeed).toBeCloseTo(scenario.closingSpeed, 0);
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

  describe('scaled to the ships', () => {
    /** The ships' separation at closest approach if left alone, m. */
    const passDistance = (scenario: StartingScenario) => {
      const [a, b] = scenario.starts;
      if (!a || !b) throw new Error('Two ships expected');
      const range = sub(b.position, a.position);
      const velocity = sub(b.velocity, a.velocity);
      const until = Math.max(0, -dot(range, velocity) / dot(velocity, velocity));
      return length(add(range, scale(velocity, until)));
    };

    const pairings = HAND_MADE_DESIGNS.flatMap((blue) =>
      HAND_MADE_DESIGNS.map((red) => [blue.name, red.name, blue, red] as const),
    );

    it.each(pairings)('%s against %s start just out of reach', (_, __, blue, red) => {
      const longest = Math.max(designReach(blue), designReach(red));
      for (const base of STARTING_SCENARIOS) {
        const scenario = scenarioFor(base, [blue, red]);
        const [a, b] = scenario.starts;
        if (!a || !b) throw new Error('Two ships expected');
        const separation = length(sub(b.position, a.position));
        expect(separation).toBeCloseTo(scenario.separation, -3);
        expect(separation).toBeGreaterThan(longest);
        expect(separation).toBeLessThanOrEqual(Math.max(MIN_START_SEPARATION, 1.5 * longest));
      }
    });

    it('never start further apart than the scenario sets them', () => {
      // A laser of extreme reach, far beyond any stock design's.
      const longReach = withSection(testDesign(), 'forward', {
        mounts: [{ ...TEST_LASER, wavelength: 25e-9 }],
      });
      expect(START_REACH_MARGIN * designReach(longReach)).toBeGreaterThan(HEAD_ON.separation);
      expect(scenarioFor(HEAD_ON, [longReach, testDesign()]).separation).toBe(HEAD_ON.separation);
    });

    it.each(STARTING_SCENARIOS.map((s) => [s.name, s] as const))(
      '%s keeps its motion and the shape of its geometry',
      (_, base) => {
        const scenario = scenarioFor(base, [handMadeDesign('torch'), handMadeDesign('sling')]);
        expect(scenario.separation).toBe(MIN_START_SEPARATION);
        expect(scenario.relativeSpeed).toBe(base.relativeSpeed);
        expect(scenario.closingSpeed).toBe(base.closingSpeed);
        scenario.starts.forEach((start, i) => {
          expect(start.velocity).toEqual(base.starts[i]?.velocity);
          expect(start.orientation).toEqual(base.starts[i]?.orientation);
        });
        expect(passDistance(scenario) / scenario.separation).toBeCloseTo(
          passDistance(base) / base.separation,
          6,
        );
        // The ships see each other as stated.
        const battle = createBattle({
          seed: 1,
          scenario,
          sides: testSides([handMadeDesign('torch'), handMadeDesign('sling')]),
        });
        const blue = battle.observe('blue');
        const motion = relativeMotion(blue.ownShip, contactOf(blue));
        expect(length(sub(contactOf(blue).position, blue.ownShip.position))).toBeCloseTo(
          scenario.separation,
          -3,
        );
        expect(motion.closingSpeed).toBeCloseTo(scenario.closingSpeed, 0);
      },
    );
  });
});
