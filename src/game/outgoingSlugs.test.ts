import { describe, expect, it } from 'vitest';
import { createBattle, type Battle, type BattleEvent } from '../sim/battle';
import { duelSetup, gunnedTestDesign, testDesign } from '../sim/testing';
import { fromAxisAngle, type Quat } from '../sim/quaternion';
import { vec3 } from '../sim/vector';
import { createSlugTracker } from './outgoingSlugs';

const KM = 1000;

/** Blue fires its slugs at an idle red `range` apart, at long range. */
const firing = (range: number, slugs = 3, redOrientation?: Quat): Battle => {
  const battle = createBattle(
    duelSetup(gunnedTestDesign(slugs), testDesign(), range, redOrientation),
  );
  battle.giveOrder('blue', {
    type: 'weapons',
    target: 'red',
    mode: 'fire-freely',
    longRangeSlugs: true,
  });
  return battle;
};

describe('our slugs', () => {
  it('shows nothing before a slug is fired', () => {
    const battle = firing(1_000 * KM);
    const tracker = createSlugTracker('blue');
    expect(tracker.update(battle.observe('blue'), [])).toBeNull();
  });

  it('counts down to the first and last arrival, then counts what hit', () => {
    // The test gun fires 20 km/s slugs, one a second: three slugs at 1,000 km take about 50 s.
    const battle = firing(1_000 * KM);
    const tracker = createSlugTracker('blue');
    const events: BattleEvent[] = [];
    let slugs = tracker.update(battle.observe('blue'), []);
    while (slugs?.inFlight !== 3) {
      const step = battle.advance(1);
      events.push(...step);
      slugs = tracker.update(battle.observe('blue'), step);
    }
    expect(slugs.firstIn).toBeGreaterThan(40);
    expect(slugs.firstIn).toBeLessThan(55);
    expect(slugs.lastIn).toBeGreaterThan(slugs.firstIn ?? Infinity);
    const before = slugs.firstIn ?? 0;
    const step = battle.advance(10);
    slugs = tracker.update(battle.observe('blue'), step);
    expect(slugs?.firstIn).toBeCloseTo(before - 10, 0);
    while (slugs?.inFlight !== 0) {
      const next = battle.advance(10);
      slugs = tracker.update(battle.observe('blue'), next);
    }
    // An idle target does not dodge: all three strike it.
    expect(slugs).toMatchObject({ inFlight: 0, hits: 3, misses: 0 });
  });

  it('counts a slug that passes its target as a miss', () => {
    // Red side-on, so its drive pushes it across the line of fire.
    const battle = firing(1_000 * KM, 1, fromAxisAngle(vec3(0, 0, 1), Math.PI / 2));
    const tracker = createSlugTracker('blue');
    let slugs = tracker.update(battle.observe('blue'), []);
    while (slugs?.inFlight !== 1) slugs = tracker.update(battle.observe('blue'), battle.advance(1));
    // Red pushes out of the slug's path.
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
    while (slugs?.inFlight !== 0)
      slugs = tracker.update(battle.observe('blue'), battle.advance(10));
    expect(slugs).toMatchObject({ hits: 0, misses: 1 });
  });
});
