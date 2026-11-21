import { describe, expect, it } from 'vitest';
import { createBattle, type Battle, type BattleEvent } from './battle';
import { effectiveRange } from './beams';
import { designComponent, type Design, type LaserDesign } from './design';
import { fromAxisAngle, IDENTITY, multiply } from './quaternion';
import {
  armedTestDesign,
  armouredAllOver,
  duelSetup,
  FACING_BLUE,
  TEST_LASER,
  TEST_SENSOR,
  testDesign,
  testSetup,
  testSides,
  withSection,
} from './testing';
import { vec3 } from './vector';

const KM = 1000;

/** The test design with its reactor moved from the middle section into the forward section. */
const forwardReactorDesign = (): Design => {
  const design = testDesign();
  const reactor = designComponent(design, 'reactor');
  const middle = design.sections.find((s) => s.kind === 'middle');
  const moved = withSection(design, 'middle', {
    components: (middle?.components ?? []).filter((c) => c.type !== 'reactor'),
  });
  return withSection(moved, 'forward', { components: [reactor] });
};

/** Red turned side-on, so blue's beam lands on its middle section. */
const BROADSIDE = multiply(FACING_BLUE, fromAxisAngle(vec3(0, 0, 1), Math.PI / 2));

/** Steps until the battle ends, failing if it has not within an hour. */
const fightToTheEnd = (battle: Battle): BattleEvent[] => {
  const events: BattleEvent[] = [];
  while (!battle.outcome) {
    if (battle.time > 3_600) throw new Error('The battle never ended');
    events.push(...battle.advance(1));
  }
  return events;
};

const fireAtRed = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
};

/** Checks the battle is over for good: time stands still and orders change nothing. */
const expectFrozen = (battle: Battle) => {
  const time = battle.time;
  const before = { blue: battle.observe('blue'), red: battle.observe('red') };
  battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 600 });
  battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: 1_000 * KM });
  expect(battle.step()).toEqual([]);
  expect(battle.advance(60)).toEqual([]);
  expect(battle.time).toBe(time);
  expect(battle.observe('blue')).toStrictEqual(before.blue);
  expect(battle.observe('red')).toStrictEqual(before.red);
};

describe('battle outcomes', () => {
  it('is undecided while both ships can still fight', () => {
    const battle = createBattle(testSetup());
    expect(battle.advance(600)).toEqual([]);
    expect(battle.outcome).toBeNull();
    expect(battle.observe('blue').outcome).toBeNull();
  });

  it('destroys a ship whose reactor is breached, and the battle ends', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), forwardReactorDesign(), 20_000 * KM));
    fireAtRed(battle);
    const events = fightToTheEnd(battle);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'component-lost', side: 'red', component: 'reactor' }),
    );
    expect(events.some((e) => e.type === 'structural-failure')).toBe(false);
    expect(battle.outcome).toEqual({
      time: battle.time,
      winner: 'blue',
      sides: [
        { side: 'blue', loss: null, shipLost: false },
        {
          side: 'red',
          loss: { result: 'destroyed', cause: 'reactor-breach' },
          shipLost: true,
        },
      ],
    });
    expectFrozen(battle);
  });

  it('destroys a ship whose middle section fails structurally', () => {
    // The reactor is forward, out of the line of fire, so only the structure gives way.
    const battle = createBattle(
      duelSetup(armedTestDesign(), forwardReactorDesign(), 20_000 * KM, BROADSIDE),
    );
    fireAtRed(battle);
    const events = fightToTheEnd(battle);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'structural-failure', side: 'red', section: 'middle' }),
    );
    expect(battle.outcome?.winner).toBe('blue');
    expect(battle.outcome?.sides[1]).toEqual({
      side: 'red',
      loss: { result: 'destroyed', cause: 'structural-failure' },
      shipLost: true,
    });
    expectFrozen(battle);
  });

  it('disables a ship left adrift with nothing that can reach the enemy', () => {
    // Red faces away from blue, so the beam burns into its unarmoured engine section.
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 20_000 * KM, IDENTITY));
    fireAtRed(battle);
    const events = fightToTheEnd(battle);
    expect(events).toContainEqual({ type: 'adrift', time: battle.time, side: 'red' });
    const red = battle.observe('red').ownShip;
    expect(red.sections.find((s) => s.kind === 'engine')?.components[0]).toEqual({
      type: 'drive',
      integrity: 0,
    });
    expect(battle.outcome?.winner).toBe('blue');
    expect(battle.outcome?.sides[1]).toEqual({
      side: 'red',
      loss: { result: 'disabled', cause: 'no-working-drive' },
      shipLost: false,
    });
    expectFrozen(battle);
  });

  it('disables a ship with no working weapons', () => {
    // Red's only laser is on its unarmoured forward section, which faces blue.
    const battle = createBattle(duelSetup(armedTestDesign(), armedTestDesign(), 20_000 * KM));
    fireAtRed(battle);
    fightToTheEnd(battle);
    expect(battle.observe('red').ownShip.weapons.lasers.map((l) => l.integrity)).toEqual([0]);
    expect(battle.outcome?.winner).toBe('blue');
    expect(battle.outcome?.sides[1]).toEqual({
      side: 'red',
      loss: { result: 'disabled', cause: 'no-working-weapons' },
      shipLost: false,
    });
    expectFrozen(battle);
  });

  it('never disables an unarmed ship for want of weapons', () => {
    const battle = createBattle(duelSetup(testDesign(), testDesign(), 20_000 * KM));
    battle.advance(60);
    expect(battle.outcome).toBeNull();
  });

  it('declares no winner when both ships lose in the same step', () => {
    const design = withSection(forwardReactorDesign(), 'forward', {
      components: [designComponent(testDesign(), 'reactor')],
      mounts: [TEST_LASER],
    });
    const battle = createBattle(duelSetup(design, design, 20_000 * KM));
    fireAtRed(battle);
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    fightToTheEnd(battle);
    // The duel is symmetrical, so each beam breaches the other ship's reactor at the same moment.
    const breached = { result: 'destroyed', cause: 'reactor-breach' };
    expect(battle.outcome).toEqual({
      time: battle.time,
      winner: null,
      sides: [
        { side: 'blue', loss: breached, shipLost: true },
        { side: 'red', loss: breached, shipLost: true },
      ],
    });
  });

  it('tells every side with a battle-ended event and in its observations', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), forwardReactorDesign(), 20_000 * KM));
    fireAtRed(battle);
    const events = fightToTheEnd(battle);
    const ended = { type: 'battle-ended', time: battle.time, outcome: battle.outcome };
    expect(events.at(-1)).toEqual(ended);
    expect(events.filter((e) => e.type === 'battle-ended')).toHaveLength(1);
    for (const side of ['blue', 'red']) {
      const observation = battle.observe(side);
      expect(observation.outcome).toEqual(battle.outcome);
      expect(observation.events.at(-1)).toEqual(ended);
    }
  });
});

/** A laser with a quarter of the test laser's mirror, so it reaches a quarter as far. */
const SHORT_LASER: LaserDesign = { ...TEST_LASER, aperture: 1 };
const shortArmedDesign = (): Design =>
  withSection(testDesign(), 'forward', { mounts: [SHORT_LASER] });
/** Between the short laser's reach and the test laser's: blue reaches red, red cannot answer. */
const OUTRANGED = (effectiveRange(SHORT_LASER) + effectiveRange(TEST_LASER)) / 2;

/** Steps until red's drive is lost, failing if it has not been within an hour. */
const untilRedAdrift = (battle: Battle): BattleEvent[] => {
  const events: BattleEvent[] = [];
  while (!events.some((e) => e.type === 'adrift' && e.side === 'red')) {
    if (battle.outcome || battle.time > 3_600) throw new Error('Red never went adrift');
    events.push(...battle.advance(1));
  }
  return events;
};

describe('a ship with no working drive', () => {
  it('fights on adrift while the enemy is within its reach', () => {
    // Red faces away from blue, so blue's beam burns into its engine section; red's sensor is
    // forward, out of the way, and blue's armour holds red's beam off long enough to see red
    // fight on.
    const sensorForward = withSection(
      withSection(testDesign(), 'engine', { mounts: [] }),
      'forward',
      { mounts: [TEST_LASER, TEST_SENSOR] },
    );
    const battle = createBattle(
      duelSetup(armouredAllOver(armedTestDesign()), sensorForward, 20_000 * KM, IDENTITY),
    );
    fireAtRed(battle);
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    const events = untilRedAdrift(battle);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'component-lost', side: 'red', component: 'drive' }),
    );
    expect(battle.outcome).toBeNull();
    const red = battle.observe('red');
    expect(red.ownShip.adrift).toBe(true);
    expect(red.events).toContainEqual(expect.objectContaining({ type: 'adrift', side: 'red' }));
    expect(battle.observe('blue').events).toContainEqual(
      expect.objectContaining({ type: 'adrift', side: 'red' }),
    );
    // Red's beam keeps wearing blue's nose.
    const nose = () =>
      battle.observe('blue').ownShip.sections.find((s) => s.kind === 'forward')?.armour.remaining ??
      0;
    const before = nose();
    battle.advance(30);
    expect(battle.outcome).toBeNull();
    expect(nose()).toBeLessThan(before);
  });

  it('cannot withdraw once adrift', () => {
    const battle = createBattle(
      duelSetup(armedTestDesign(), armedTestDesign(), 20_000 * KM, IDENTITY),
    );
    fireAtRed(battle);
    untilRedAdrift(battle);
    expect(() => {
      battle.giveOrder('red', { type: 'withdraw' });
    }).toThrow(/no working drive/i);
    expect(battle.observe('red').ownShip.withdrawing).toBe(false);
  });

  it('is disabled at once when an enemy that outranges it is out of its reach', () => {
    const battle = createBattle(
      duelSetup(armedTestDesign(), shortArmedDesign(), OUTRANGED, IDENTITY),
    );
    fireAtRed(battle);
    const events = fightToTheEnd(battle);
    const adrift = events.find((e) => e.type === 'adrift');
    expect(adrift).toEqual({ type: 'adrift', time: battle.time, side: 'red' });
    expect(battle.observe('red').ownShip.weapons.lasers.map((l) => l.integrity)).toEqual([1]);
    expect(battle.outcome?.winner).toBe('blue');
    expect(battle.outcome?.sides[1]?.loss).toEqual({
      result: 'disabled',
      cause: 'no-working-drive',
    });
  });

  it('fights on while it drifts towards an enemy out of its reach', () => {
    const setup = duelSetup(armedTestDesign(), shortArmedDesign(), OUTRANGED, IDENTITY);
    const [blueStart, redStart] = setup.scenario.starts;
    if (!blueStart || !redStart) throw new Error('No starts');
    const battle = createBattle({
      ...setup,
      scenario: {
        ...setup.scenario,
        starts: [blueStart, { ...redStart, velocity: vec3(-1_000, 0, 0) }],
      },
    });
    fireAtRed(battle);
    untilRedAdrift(battle);
    expect(battle.outcome).toBeNull();
  });
});

describe('a battle time limit (test mode)', () => {
  it('ends the battle with no result once the time limit is reached', () => {
    const battle = createBattle(testSetup({ timeLimit: 60 }));
    const events = battle.advance(120);
    const outcome = {
      time: 60,
      winner: null,
      sides: [
        { side: 'blue', loss: null, shipLost: false },
        { side: 'red', loss: null, shipLost: false },
      ],
    };
    expect(battle.time).toBeCloseTo(60);
    expect(battle.outcome).toEqual({ ...outcome, time: battle.time });
    expect(events).toEqual([{ type: 'battle-ended', time: battle.time, outcome: battle.outcome }]);
    expect(battle.observe('red').outcome).toEqual(battle.outcome);
    expectFrozen(battle);
  });

  it('lets a battle decided before the time limit end as usual', () => {
    const setup = duelSetup(armedTestDesign(), forwardReactorDesign(), 20_000 * KM);
    const battle = createBattle({ ...setup, timeLimit: 3_600 });
    fireAtRed(battle);
    fightToTheEnd(battle);
    expect(battle.time).toBeLessThan(3_600);
    expect(battle.outcome?.winner).toBe('blue');
  });

  it('has no time limit unless one is set', () => {
    const battle = createBattle(testSetup());
    battle.advance(2 * 3_600);
    expect(battle.outcome).toBeNull();
  });

  it('must be a positive number of seconds', () => {
    for (const timeLimit of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createBattle(testSetup({ timeLimit }))).toThrow(/time limit/i);
    }
  });
});

describe('ending a battle', () => {
  it('is a forfeit for a player side: it loses and its ship is treated as destroyed', () => {
    const battle = createBattle(testSetup());
    battle.advance(10);
    const events = battle.endBattle('blue');
    const outcome = {
      time: battle.time,
      winner: 'red',
      sides: [
        { side: 'blue', loss: { result: 'forfeit' }, shipLost: true },
        { side: 'red', loss: null, shipLost: false },
      ],
    };
    expect(battle.outcome).toEqual(outcome);
    expect(events).toEqual([{ type: 'battle-ended', time: battle.time, outcome }]);
    expect(battle.observe('red').events.at(-1)).toEqual(events[0]);
    expectFrozen(battle);
  });

  it('ends with no result between computer sides', () => {
    const sides = testSides().map((side) => ({ ...side, commander: 'computer' as const }));
    const battle = createBattle(testSetup({ sides }));
    battle.advance(10);
    battle.endBattle('blue');
    expect(battle.outcome).toEqual({
      time: battle.time,
      winner: null,
      sides: [
        { side: 'blue', loss: null, shipLost: false },
        { side: 'red', loss: null, shipLost: false },
      ],
    });
    expectFrozen(battle);
  });

  it('is a forfeit for whichever player side chooses it when both sides are players', () => {
    const sides = testSides().map((side) => ({ ...side, commander: 'player' as const }));
    const battle = createBattle(testSetup({ sides }));
    battle.endBattle('red');
    expect(battle.outcome?.winner).toBe('blue');
    expect(battle.outcome?.sides[1]?.loss).toEqual({ result: 'forfeit' });
  });

  it('cannot be chosen by a computer side against a player, nor end a battle twice', () => {
    const battle = createBattle(testSetup());
    expect(() => battle.endBattle('red')).toThrow();
    expect(() => battle.endBattle('green')).toThrow();
    expect(battle.outcome).toBeNull();
    battle.endBattle('blue');
    const outcome = battle.outcome;
    battle.advance(5);
    expect(battle.endBattle('blue')).toEqual([]);
    expect(battle.outcome).toBe(outcome);
  });
});
