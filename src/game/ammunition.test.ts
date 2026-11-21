import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { createBattle } from '../sim/battle';
import { duelSetup, gunnedTestDesign, testDesign } from '../sim/testing';
import { ammunitionStocks } from './ammunition';

const KM = 1000;

const stocksOf = (design: Parameters<typeof duelSetup>[0]) =>
  ammunitionStocks(
    createBattle(duelSetup(design, testDesign(), 1_000 * KM)).observe('blue').ownShip,
  );

describe('ammunition stocks', () => {
  it('lists only the kinds of ammunition a design carries', () => {
    expect(stocksOf(handMadeDesign('sling')).map((s) => s.name)).toEqual(['Slugs']);
    expect(stocksOf(handMadeDesign('quiver')).map((s) => s.name)).toEqual(['Missiles']);
    expect(stocksOf(handMadeDesign('bulwark')).map((s) => s.name)).toEqual([
      'Missiles',
      'Anti-missile missiles',
    ]);
    expect(stocksOf(handMadeDesign('rampart')).map((s) => s.name)).toEqual([
      'Point defence rounds',
    ]);
    expect(stocksOf(handMadeDesign('lance'))).toEqual([]);
  });

  it('is plentiful, then low at a quarter of a load or less, then empty', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(8), testDesign(), 100 * KM));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const levels: string[] = [];
    while (levels.at(-1) !== 'empty' && battle.time < 60) {
      battle.advance(1);
      const [slugs] = ammunitionStocks(battle.observe('blue').ownShip);
      if (slugs && slugs.level !== levels.at(-1)) levels.push(slugs.level);
    }
    expect(levels).toEqual(['ok', 'low', 'empty']);
    expect(ammunitionStocks(battle.observe('blue').ownShip)[0]).toMatchObject({
      left: 0,
      capacity: 8,
    });
  });
});
