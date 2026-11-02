import { describe, expect, it } from 'vitest';
import { createBattle, type Battle } from './battle';
import { designComponent, type Design } from './design';
import { testDesign, testSetup, testSides } from './testing';
import { dot, length, sub, type Vec3 } from './vector';

const angleBetween = (a: Vec3, b: Vec3) =>
  Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (length(a) * length(b)))));

/** Seconds until blue's nose points away from red and its rotation has settled. */
const timeToTurnAway = (battle: Battle): number => {
  battle.giveOrder('blue', { type: 'attitude', mode: 'away' });
  for (let i = 0; i < 100_000; i++) {
    battle.step();
    const { ownShip, contacts } = battle.observe('blue');
    const away = sub(ownShip.position, contacts[0]?.position ?? ownShip.position);
    if (angleBetween(ownShip.nose, away) < 0.01 && length(ownShip.angularVelocity) < 1e-3) {
      return battle.time;
    }
  }
  throw new Error('Never finished turning');
};

const battleWith = (blue: Design) =>
  createBattle(testSetup({ sides: testSides([blue, testDesign()]) }));

describe('attitude orders', () => {
  it('turns a ship to point at the enemy', () => {
    const battle = battleWith(testDesign());
    battle.giveOrder('blue', {
      type: 'attitude',
      mode: 'direction',
      direction: { x: 0, y: 1, z: 0 },
    });
    battle.advance(300);
    battle.giveOrder('blue', { type: 'attitude', mode: 'enemy' });
    battle.advance(300);
    const { ownShip, contacts } = battle.observe('blue');
    const towards = sub(contacts[0]?.position ?? ownShip.position, ownShip.position);
    expect(angleBetween(ownShip.nose, towards)).toBeLessThan(0.01);
  });

  it('takes a larger hull longer to turn through 180° with the same thrusters', () => {
    const frigate = timeToTurnAway(battleWith(testDesign({ hullSize: 'frigate' })));
    const cruiser = timeToTurnAway(battleWith(testDesign({ hullSize: 'cruiser' })));
    expect(cruiser).toBeGreaterThan(frigate * 1.5);
  });

  it('never applies more torque than the thrusters have', () => {
    const design = testDesign();
    const battle = battleWith(design);
    battle.giveOrder('blue', { type: 'attitude', mode: 'away' });
    for (let i = 0; i < 2_000; i++) {
      battle.step();
      expect(length(battle.observe('blue').ownShip.torque)).toBeLessThanOrEqual(
        designComponent(design, 'thrusters').torque * (1 + 1e-9),
      );
    }
  });
});

describe('burn orders', () => {
  it('spends delta-v as the rocket equation predicts', () => {
    const design = testDesign();
    const battle = battleWith(design);
    const before = battle.observe('blue').ownShip;
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 600 });
    battle.advance(600);
    const after = battle.observe('blue').ownShip;
    const expected =
      designComponent(design, 'drive').exhaustVelocity * Math.log(before.mass / after.mass);
    expect(length(sub(after.velocity, before.velocity))).toBeCloseTo(expected, 3);
    expect(before.deltaV - after.deltaV).toBeCloseTo(expected, 3);
    expect(after.mass).toBeLessThan(before.mass);
  });

  it('pushes along the nose at the ordered throttle', () => {
    const design = testDesign();
    const battle = battleWith(design);
    const before = battle.observe('blue').ownShip;
    battle.giveOrder('blue', { type: 'burn', throttle: 0.5, duration: 10 });
    battle.step();
    const after = battle.observe('blue').ownShip;
    expect(after.thrust).toBeCloseTo(0.5 * designComponent(design, 'drive').thrust);
    expect(angleBetween(sub(after.velocity, before.velocity), before.nose)).toBeLessThan(1e-9);
  });

  it('stops burning when the ordered duration is up', () => {
    const battle = battleWith(testDesign());
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 10 });
    battle.advance(10);
    const v = battle.observe('blue').ownShip.velocity;
    battle.advance(10);
    expect(battle.observe('blue').ownShip.velocity).toStrictEqual(v);
    expect(battle.observe('blue').ownShip.thrust).toBe(0);
  });

  it('produces no thrust once propellant is exhausted', () => {
    const design = testDesign({ propellantMass: 1_000 });
    const battle = battleWith(design);
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 1e6 });
    battle.advance(600);
    const empty = battle.observe('blue').ownShip;
    expect(empty.propellantMass).toBe(0);
    expect(empty.deltaV).toBe(0);
    battle.advance(60);
    const later = battle.observe('blue').ownShip;
    expect(later.thrust).toBe(0);
    expect(later.velocity).toStrictEqual(empty.velocity);
  });

  it('accepts orders while the battle is not advancing', () => {
    const battle = battleWith(testDesign());
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 5 });
    expect(battle.observe('blue').ownShip.burn).toEqual({ throttle: 1, remaining: 5 });
  });
});
