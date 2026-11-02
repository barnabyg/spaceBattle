import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { createBattle, type Battle } from './battle';
import { designComponent, type Design } from './design';
import { testDesign, testSetup, testSides } from './testing';
import { distance, length, sub, vec3 } from './vector';

const KM = 1000;
const HOUR = 3_600;
/** How close to the ordered range a settled ship keeps. */
const TOLERANCE = 5 * KM;

const separation = (battle: Battle): number => {
  const { ownShip, contacts } = battle.observe('blue');
  return distance(ownShip.position, contacts[0]?.position ?? ownShip.position);
};

const relativeSpeed = (battle: Battle): number => {
  const { ownShip, contacts } = battle.observe('blue');
  return length(sub(ownShip.velocity, contacts[0]?.velocity ?? ownShip.velocity));
};

/** The largest gap between the separation and `range` over the next `seconds`. */
const worstRangeError = (battle: Battle, range: number, seconds: number): number => {
  let worst = 0;
  const end = battle.time + seconds;
  while (battle.time < end) {
    battle.step();
    worst = Math.max(worst, Math.abs(separation(battle) - range));
  }
  return worst;
};

const battleWith = (blue: Design = testDesign(), red: Design = testDesign()) =>
  createBattle(testSetup({ sides: testSides([blue, red]) }));

describe('manoeuvre orders', () => {
  it('holds a range against a drifting enemy', () => {
    const battle = battleWith();
    const range = 150_000 * KM;
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'hold', range });
    battle.advance(4 * HOUR);
    expect(worstRangeError(battle, range, 4 * HOUR)).toBeLessThan(TOLERANCE);
  });

  it('holds a range against an enemy accelerating across and away', () => {
    const battle = battleWith();
    const range = 150_000 * KM;
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'hold', range });
    battle.advance(4 * HOUR);
    battle.giveOrder('red', { type: 'attitude', mode: 'direction', direction: vec3(0.6, 0.8, 0) });
    battle.advance(120);
    battle.giveOrder('red', { type: 'burn', throttle: 0.3, duration: HOUR });
    expect(worstRangeError(battle, range, 2 * HOUR)).toBeLessThan(TOLERANCE);
  });

  it('holds a range in a heavy cruiser against a nimble frigate', () => {
    const battle = battleWith(handMadeDesign('bastion'), handMadeDesign('lance'));
    const range = 100_000 * KM;
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'hold', range });
    battle.advance(6 * HOUR);
    battle.giveOrder('red', { type: 'attitude', mode: 'away' });
    battle.advance(300);
    battle.giveOrder('red', { type: 'burn', throttle: 0.3, duration: HOUR / 2 });
    expect(worstRangeError(battle, range, 2 * HOUR)).toBeLessThan(TOLERANCE);
  });

  it('closes to a range and stays there', () => {
    const battle = battleWith();
    const range = 50_000 * KM;
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range });
    battle.advance(7 * HOUR);
    expect(worstRangeError(battle, range, HOUR)).toBeLessThan(TOLERANCE);
  });

  it('opens the range out to the ordered range', () => {
    const battle = battleWith();
    const range = 300_000 * KM;
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'open', range });
    battle.advance(6 * HOUR);
    expect(worstRangeError(battle, range, HOUR)).toBeLessThan(TOLERANCE);
  });

  it('matches the enemy’s velocity', () => {
    const battle = battleWith();
    expect(relativeSpeed(battle)).toBeGreaterThan(2_000);
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'match-velocity' });
    battle.advance(HOUR / 2);
    expect(relativeSpeed(battle)).toBeLessThan(0.1);
    battle.advance(HOUR);
    expect(relativeSpeed(battle)).toBeLessThan(0.1);
  });

  it('never uses more torque or thrust than the ship has', () => {
    const design = testDesign();
    const battle = battleWith(design);
    const { torque } = designComponent(design, 'thrusters');
    const { thrust } = designComponent(design, 'drive');
    const orders = [
      { type: 'manoeuvre', goal: 'close', range: 20_000 * KM },
      { type: 'manoeuvre', goal: 'open', range: 300_000 * KM },
      { type: 'manoeuvre', goal: 'match-velocity' },
      { type: 'manoeuvre', goal: 'hold', range: 100_000 * KM },
    ] as const;
    let burned = 0;
    for (const order of orders) {
      battle.giveOrder('blue', order);
      for (let i = 0; i < 6_000; i++) {
        battle.step();
        const ship = battle.observe('blue').ownShip;
        expect(length(ship.torque)).toBeLessThanOrEqual(torque * (1 + 1e-9));
        expect(ship.thrust).toBeLessThanOrEqual(thrust * (1 + 1e-9));
        burned += ship.thrust > 0 ? 1 : 0;
      }
    }
    expect(burned).toBeGreaterThan(0);
  });

  it('shows the active goal and its planned burns', () => {
    const battle = battleWith();
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: 50_000 * KM });
    const { manoeuvre } = battle.observe('blue').ownShip;
    expect(manoeuvre?.goal).toBe('close');
    expect(manoeuvre?.range).toBe(50_000 * KM);
    expect(manoeuvre?.rangeError).toBeCloseTo(150_000 * KM, -3);
    // Speed up towards the enemy, then turn and brake on arrival.
    expect(manoeuvre?.plannedBurns.length).toBeGreaterThanOrEqual(2);
    const [first, brake] = manoeuvre?.plannedBurns ?? [];
    expect(first?.direction.x).toBeGreaterThan(0);
    expect(brake?.direction.x).toBeLessThan(0);
    expect(brake?.start).toBeGreaterThan((first?.start ?? 0) + (first?.duration ?? 0));
  });

  it('hands control back when the captain gives an attitude or burn order', () => {
    const battle = battleWith();
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'match-velocity' });
    battle.advance(60);
    battle.giveOrder('blue', { type: 'attitude', mode: 'enemy' });
    expect(battle.observe('blue').ownShip.manoeuvre).toBeNull();

    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'match-velocity' });
    expect(battle.observe('blue').ownShip.attitude).toBeNull();
    battle.giveOrder('blue', { type: 'burn', throttle: 0, duration: 0 });
    expect(battle.observe('blue').ownShip.manoeuvre).toBeNull();

    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'hold', range: 100_000 * KM });
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'none' });
    expect(battle.observe('blue').ownShip.manoeuvre).toBeNull();
    const v = battle.observe('blue').ownShip.velocity;
    battle.advance(600);
    expect(battle.observe('blue').ownShip.velocity).toStrictEqual(v);
  });

  it('rejects a range goal without a positive range', () => {
    const battle = battleWith();
    expect(() => {
      battle.giveOrder('blue', { type: 'manoeuvre', goal: 'hold', range: -1 });
    }).toThrow();
    expect(() => {
      battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: Number.NaN });
    }).toThrow();
  });
});
