import { describe, expect, it } from 'vitest';
import { createBattle, TIME_STEP } from './battle';
import { duelSetup, TEST_LASER, TEST_SENSOR, testDesign, testSetup, withSection } from './testing';
import { distance } from './vector';

describe('battle simulation', () => {
  it('gives identical observations from the same seed and inputs after many steps', () => {
    const a = createBattle(testSetup({ seed: 42 }));
    const b = createBattle(testSetup({ seed: 42 }));
    for (const battle of [a, b]) {
      battle.giveOrder('blue', { type: 'manoeuvre', goal: 'hold', range: 150_000e3 });
      battle.giveOrder('red', { type: 'manoeuvre', goal: 'close', range: 100_000e3 });
      battle.advance(3_600);
    }
    for (const side of ['blue', 'red']) {
      expect(a.observe(side)).toStrictEqual(b.observe(side));
    }
  });

  it('gives identical damage from the same seed when lasers fire', () => {
    // Nothing armoured, so beams soon reach components and the seeded chance of which is struck.
    const design = withSection(testDesign(), 'engine', { mounts: [TEST_LASER, TEST_SENSOR] });
    const run = () => {
      const battle = createBattle({ ...duelSetup(design, design, 20_000e3), seed: 7 });
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
      battle.giveOrder('red', { type: 'manoeuvre', goal: 'open', range: 25_000e3 });
      const events = battle.advance(900);
      return { events, blue: battle.observe('blue'), red: battle.observe('red') };
    };
    const a = run();
    const b = run();
    expect(a.events.some((e) => e.type === 'component-lost')).toBe(true);
    expect(a).toStrictEqual(b);
  });

  it('advances in whole fixed time steps', () => {
    const battle = createBattle(testSetup());
    battle.step();
    expect(battle.time).toBeCloseTo(TIME_STEP);
    battle.advance(10);
    expect(battle.time).toBeCloseTo(10 + TIME_STEP);
  });

  it('lets ships drift in straight lines at constant velocity', () => {
    const battle = createBattle(testSetup());
    const start = battle.observe('blue').ownShip;
    battle.advance(1_000);
    const later = battle.observe('blue').ownShip;
    expect(later.velocity).toStrictEqual(start.velocity);
    expect(later.position.x - start.position.x).toBeCloseTo(1_000 * start.velocity.x, 3);
    expect(later.position.y - start.position.y).toBeCloseTo(1_000 * start.velocity.y, 3);
    expect(later.position.z - start.position.z).toBeCloseTo(1_000 * start.velocity.z, 3);
  });

  it('shows each side the other ship as a contact with its position and motion', () => {
    const battle = createBattle(testSetup());
    battle.advance(100);
    const blue = battle.observe('blue');
    const red = battle.observe('red');
    expect(blue.contacts).toHaveLength(1);
    expect(blue.contacts[0]?.position).toStrictEqual(red.ownShip.position);
    expect(blue.contacts[0]?.velocity).toStrictEqual(red.ownShip.velocity);
    expect(distance(blue.ownShip.position, red.ownShip.position)).toBeGreaterThan(0);
  });

  it('rejects a scenario without a start for every side', () => {
    const setup = testSetup();
    expect(() =>
      createBattle({
        ...setup,
        scenario: { name: 'x', starts: setup.scenario.starts.slice(0, 1) },
      }),
    ).toThrow();
  });
});
