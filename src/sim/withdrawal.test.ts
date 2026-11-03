import { describe, expect, it } from 'vitest';
import { createBattle, type Battle } from './battle';
import { withComputerCaptains } from './command';
import { pointDefenceRange } from './pointDefence';
import {
  armedTestDesign,
  defendedTestDesign,
  duelSetup,
  launchingTestDesign,
  TEST_POINT_DEFENCE,
  testDesign,
} from './testing';
import { distance } from './vector';

const KM = 1000;
const MINUTE = 60;

const separation = (battle: Battle) =>
  distance(battle.observe('blue').ownShip.position, battle.observe('red').ownShip.position);

/** Runs the battle until it ends, failing if it has not within `limit` seconds. */
const toTheEnd = (battle: Battle, limit: number) => {
  while (!battle.outcome) {
    if (battle.time > limit) throw new Error('The battle never ended');
    battle.step();
  }
  return battle.outcome;
};

describe('withdrawal', () => {
  it('is gone once out of reach of every enemy weapon, a loss in which the ship survives', () => {
    // Blue's point defence reaches 25 km; red starts 20 km off and leaves.
    const battle = createBattle(duelSetup(defendedTestDesign(), testDesign(), 20 * KM));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.giveOrder('blue', { type: 'point-defence', priority: 'missiles-then-ship' });
    battle.giveOrder('red', { type: 'withdraw' });
    expect(battle.observe('red').ownShip.withdrawing).toBe(true);

    const outcome = toTheEnd(battle, 30 * MINUTE);
    expect(outcome.time).toBeLessThan(5 * MINUTE);
    expect(separation(battle)).toBeGreaterThan(pointDefenceRange(TEST_POINT_DEFENCE));
    expect(outcome.winner).toBe('blue');
    expect(outcome.sides).toEqual([
      { side: 'blue', loss: null, shipLost: false },
      { side: 'red', loss: { result: 'withdrawn' }, shipLost: false },
    ]);
  });

  it('is gone after 30 minutes when the enemy outranges the ship for longer', () => {
    // Blue's laser reaches some 148,000 km, far beyond where red can get in half an hour.
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 50_000 * KM));
    battle.advance(MINUTE);
    battle.giveOrder('red', { type: 'withdraw' });
    const events = battle.advance(MINUTE);
    expect(events).toContainEqual({ type: 'withdrawal', time: MINUTE, side: 'red' });
    // It turns and burns away from the enemy.
    expect(separation(battle)).toBeGreaterThan(50_000 * KM);
    const outcome = toTheEnd(battle, 2 * 30 * MINUTE);
    expect(outcome.time).toBeCloseTo(MINUTE + 30 * MINUTE, 0);
    expect(outcome.sides[1]).toEqual({
      side: 'red',
      loss: { result: 'withdrawn' },
      shipLost: false,
    });
  });

  it('lets the enemy keep firing and launching, but not pursue', () => {
    const battle = createBattle(duelSetup(launchingTestDesign(4), testDesign(), 10_000 * KM));
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: 1_000 * KM });
    battle.giveOrder('red', { type: 'withdraw' });
    battle.step();
    // Its standing order to close is called off, and no order to pursue is taken.
    expect(battle.observe('blue').ownShip.manoeuvre).toBeNull();
    for (const goal of ['close', 'hold'] as const) {
      expect(() => {
        battle.giveOrder('blue', { type: 'manoeuvre', goal, range: 1_000 * KM });
      }).toThrow(/pursue/);
    }
    expect(() => {
      battle.giveOrder('blue', { type: 'manoeuvre', goal: 'match-velocity' });
    }).toThrow(/pursue/);
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'open', range: 20_000 * KM });
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 2 });
    const events = battle.advance(MINUTE);
    expect(events.filter((e) => e.type === 'launch' && e.attacker === 'blue')).toHaveLength(2);
    // The withdrawing ship takes no new course of its own either.
    expect(() => {
      battle.giveOrder('red', { type: 'manoeuvre', goal: 'close', range: 1_000 * KM });
    }).toThrow(/withdraw/);
  });
});

describe('the reserve', () => {
  it('warns as the delta-v left comes down towards the reserve', () => {
    const battle = createBattle(duelSetup(testDesign(), testDesign(), 10_000 * KM));
    const red = () => battle.observe('red').ownShip;
    expect(red().reserve).toBe(testDesign().reserve);
    expect(red().reserveWarning).toBe(false);
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 10 * 3_600 });
    while (!red().reserveWarning) {
      if (battle.time > 10 * 3_600) throw new Error('No warning');
      battle.advance(MINUTE);
    }
    expect(red().deltaV).toBeGreaterThan(red().reserve);
  });
});

describe('stranding', () => {
  it('loses the ship that runs out of propellant without withdrawing', () => {
    const battle = createBattle(
      duelSetup(testDesign(), { ...testDesign(), propellantMass: 2e3 }, 10_000 * KM),
    );
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
    const outcome = toTheEnd(battle, 3_600);
    expect(outcome.winner).toBe('blue');
    expect(outcome.sides[1]).toEqual({ side: 'red', loss: { result: 'stranded' }, shipLost: true });
  });

  it('spares a ship that runs dry while withdrawing', () => {
    const battle = createBattle(
      duelSetup(armedTestDesign(), { ...testDesign(), propellantMass: 2e3 }, 50_000 * KM),
    );
    battle.giveOrder('red', { type: 'withdraw' });
    const outcome = toTheEnd(battle, 3_600);
    expect(battle.observe('red').ownShip.deltaV).toBe(0);
    expect(outcome.sides[1]?.loss).toEqual({ result: 'withdrawn' });
  });
});

describe('a computer captain facing a withdrawal', () => {
  it('keeps firing at the withdrawing enemy but never pursues it', () => {
    const setup = duelSetup(testDesign(), armedTestDesign(), 20_000 * KM);
    const battle = withComputerCaptains(createBattle(setup));
    battle.advance(MINUTE);
    expect(battle.observe('red').ownShip.manoeuvre?.goal).toBe('hold');
    battle.giveOrder('blue', { type: 'withdraw' });
    const events = battle.advance(10 * MINUTE);
    expect(battle.observe('red').ownShip.manoeuvre).toBeNull();
    expect(events.some((e) => e.type === 'hit' && e.attacker === 'red')).toBe(true);
  });
});
