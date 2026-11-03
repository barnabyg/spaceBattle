import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { effectiveRange } from './beams';
import { createBattle, type Battle, type BattleSetup, type CaptainSkill } from './battle';
import { withComputerCaptains } from './command';
import type { Design } from './design';
import {
  armedTestDesign,
  duelSetup,
  TEST_LASER,
  testDesign,
  withComponent,
  withSection,
} from './testing';
import { dot, normalize, sub } from './vector';

const KM = 1000;
const MINUTE = 60;
const HOUR = 3_600;

/** Red commanded by the computer at a skill, against a player in blue who gives no orders. */
const againstIdlePlayer = (setup: BattleSetup, skill: CaptainSkill): Battle =>
  withComputerCaptains(
    createBattle({
      ...setup,
      sides: setup.sides.map((side) =>
        side.id === 'red' ? { ...side, commander: 'computer' as const, skill } : side,
      ),
    }),
  );

/** How squarely red's nose points at blue: 1 straight at it, −1 straight away. */
const noseTowardsBlue = (battle: Battle): number => {
  const red = battle.observe('red').ownShip;
  const blue = battle.observe('blue').ownShip;
  return dot(red.nose, normalize(sub(blue.position, red.position)));
};

describe('computer captain skill', () => {
  it('at high skill turns its thickest armour towards the enemy', () => {
    // Red's engine section carries its armour, too heavy to leave any delta-v for a reserve; blue
    // is unarmed, so red holds where it can fire.
    const red: Design = {
      ...withSection(armedTestDesign(), 'engine', { armour: { type: 'heavy', thickness: 0.5 } }),
      reserve: 0,
    };
    const at = 0.95 * effectiveRange(TEST_LASER);
    const high = againstIdlePlayer(duelSetup(testDesign(), red, at), 'high');
    const medium = againstIdlePlayer(duelSetup(testDesign(), red, at), 'medium');
    high.advance(10 * MINUTE);
    medium.advance(10 * MINUTE);
    expect(noseTowardsBlue(high)).toBeLessThan(-0.95);
    expect(noseTowardsBlue(medium)).toBeGreaterThan(-0.5);
    expect(high.observe('red').ownShip.weapons.lasers[0]?.firing).toBe(true);
  });

  it.each(['low', 'medium', 'high'] as const)(
    'at %s skill withdraws from a battle it cannot win',
    (skill) => {
      // With no slugs its guns are no use against the Lance.
      const empty = withComponent(handMadeDesign('sling'), 'magazine', { slugs: 0 });
      const battle = againstIdlePlayer(
        duelSetup(handMadeDesign('lance'), empty, 100_000 * KM),
        skill,
      );
      battle.advance(10);
      expect(battle.observe('red').ownShip.withdrawing).toBe(true);
    },
  );

  it('withdraws at its reserve rather than run dry', () => {
    // Red holds a reserve of most of its delta-v, so closing in soon spends the rest.
    const design = { ...armedTestDesign(), reserve: 75e3 };
    const battle = againstIdlePlayer(duelSetup(testDesign(), design, 300_000 * KM), 'low');
    let red = battle.observe('red').ownShip;
    expect(red.withdrawing).toBe(false);
    while (!red.withdrawing) {
      if (battle.time > 12 * HOUR) throw new Error('Red never withdrew');
      battle.advance(MINUTE);
      red = battle.observe('red').ownShip;
    }
    expect(red.deltaV).toBeLessThanOrEqual(red.reserve);
    expect(red.deltaV).toBeGreaterThan(0.9 * red.reserve);
  }, 20_000);

  it('reconsiders its plan less often at low skill', () => {
    /** How long red's captain takes to take back a target the player took off it, s. */
    const retargets = (skill: CaptainSkill) => {
      const battle = againstIdlePlayer(
        duelSetup(testDesign(), armedTestDesign(), 200_000 * KM),
        skill,
      );
      battle.advance(5);
      battle.giveOrder('red', { type: 'weapons', target: null, mode: 'hold-fire' });
      const from = battle.time;
      while (battle.observe('red').ownShip.weapons.target === null) battle.advance(1);
      return battle.time - from;
    };
    expect(retargets('high')).toBeLessThanOrEqual(1);
    expect(retargets('medium')).toBeLessThanOrEqual(1);
    expect(retargets('low')).toBeGreaterThan(10);
  });
});
