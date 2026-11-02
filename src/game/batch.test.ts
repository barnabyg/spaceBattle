import { describe, expect, it } from 'vitest';
import { IDENTITY } from '../sim/quaternion';
import { armedTestDesign, duelSetup, testDesign, testScenario, testSides } from '../sim/testing';
import {
  batchBattleSeed,
  runBatch,
  runBatchBattle,
  summariseBatch,
  type BatchBattle,
  type BatchSetup,
} from './batch';

const KM = 1000;

/** Two unarmed ships far apart: neither can lose, so every battle runs to the time limit. */
const noResultSetup: BatchSetup = {
  sides: testSides(),
  scenario: testScenario,
  battles: 3,
  seed: 5,
  timeLimit: 60,
};

/** Blue's laser against unarmed red, which shows blue its unarmoured engine section. */
const rout: BatchSetup = {
  sides: testSides([armedTestDesign(), testDesign()]),
  scenario: duelSetup(armedTestDesign(), testDesign(), 20_000 * KM, IDENTITY).scenario,
  battles: 2,
  seed: 5,
  timeLimit: 3_600,
};

describe('batch run', () => {
  it('reports an outcome for every battle, with no result at the time limit', () => {
    const reported: BatchBattle[] = [];
    const summary = runBatch(noResultSetup, (battle) => reported.push(battle));
    expect(reported.map((b) => b.index)).toEqual([0, 1, 2]);
    for (const { outcome } of reported) {
      expect(outcome.time).toBeCloseTo(60);
      expect(outcome.winner).toBeNull();
      expect(outcome.sides.map((s) => s.loss)).toEqual([null, null]);
    }
    expect(summary).toMatchObject({ battles: 3, draws: 0, noResults: 3, meanTimeToResult: null });
    expect(summary.sides.map((s) => [s.side, s.wins, s.losses])).toEqual([
      ['blue', 0, []],
      ['red', 0, []],
    ]);
  });

  it('counts each side’s wins, and how the other side lost', () => {
    const summary = runBatch(rout);
    expect(summary).toMatchObject({ battles: 2, draws: 0, noResults: 0 });
    expect(summary.meanTimeToResult).toBeGreaterThan(0);
    expect(summary.meanTimeToResult).toBeLessThan(3_600);
    const [blue, red] = summary.sides;
    expect(blue).toMatchObject({ side: 'blue', name: 'Blue', designName: 'Test', wins: 2 });
    expect(blue?.losses).toEqual([]);
    expect(red?.wins).toBe(0);
    expect(red?.losses).toEqual([
      { loss: { result: 'destroyed', cause: 'reactor-breach' }, count: 2 },
    ]);
  }, 20_000);

  it('commands both sides by computer, whatever the setup says', () => {
    // Blue is the player's in the test sides; left to a player, its laser would never fire.
    expect(runBatchBattle(rout, 0).outcome.winner).toBe('blue');
  }, 20_000);

  it('fights each battle from its own seed, derived from the batch’s, so it can be replayed', () => {
    const seeds = [0, 1, 2, 3].map((i) => batchBattleSeed(5, i));
    expect(new Set(seeds).size).toBe(4);
    expect(batchBattleSeed(6, 0)).not.toBe(seeds[0]);
    const battles: BatchBattle[] = [];
    runBatch(noResultSetup, (battle) => battles.push(battle));
    expect(battles.map((b) => b.seed)).toEqual(seeds.slice(0, 3));
    // Any one battle of a batch can be fought again on its own, with the same outcome.
    expect(runBatchBattle(noResultSetup, 2)).toStrictEqual(battles[2]);
  });

  it('summarises battles reported in any order', () => {
    const battles: BatchBattle[] = [];
    runBatch(noResultSetup, (battle) => battles.push(battle));
    expect(summariseBatch(noResultSetup, [...battles].reverse())).toStrictEqual(
      summariseBatch(noResultSetup, battles),
    );
  });

  it('needs at least one battle and a time limit', () => {
    expect(() => runBatch({ ...noResultSetup, battles: 0 })).toThrow(/battle/);
    expect(() => runBatch({ ...noResultSetup, timeLimit: 0 })).toThrow(/time limit/i);
  });
});
