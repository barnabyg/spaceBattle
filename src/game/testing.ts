import { tierOf } from '../campaign/campaign';
import { HAND_MADE_DESIGNS } from '../data/designs';
import { OPPONENTS, type Opponent } from '../data/opponents';
import { startingScenario } from '../data/scenarios';
import { DEFAULT_TIME_LIMIT, runBatch, type BatchSummary } from './batch';
import { freeBattleBatch } from './freeBattle';

/** Test helpers for the game around the simulation. Not used by the game itself. */

/** Every pair of hand-made designs once, by id, each design against itself too. */
export const HAND_MADE_PAIRS: readonly (readonly [string, string])[] = HAND_MADE_DESIGNS.flatMap(
  (blue, i) => HAND_MADE_DESIGNS.slice(i).map((red) => [blue.id, red.id] as const),
);

/**
 * The pairs of hand-made designs split into `parts` parts, for test files that each fight one
 * part, so the test runner fights them in parallel.
 */
export const handMadePairsPart = (part: number, parts: number): (readonly [string, string])[] =>
  HAND_MADE_PAIRS.filter((_, i) => i % parts === part);

/** A test mode batch run of one free battle between two hand-made designs, as test mode runs it. */
export const handMadeBatch = (blue: string, red: string, seed = 1): BatchSummary =>
  runBatch(
    freeBattleBatch(
      {
        sides: [
          { designId: blue, commander: 'computer' },
          { designId: red, commander: 'computer' },
        ],
      },
      { battles: 1, seed, timeLimit: DEFAULT_TIME_LIMIT },
    ),
  );

const skillOf = (opponent: Opponent) => tierOf(opponent.tier).skill;

/**
 * Every opponent of a tier against every opponent of the tier below, the computer commanding
 * both at their tiers' skill, head-on, each taking each side once: how many battles the higher
 * tier won and lost.
 */
export const tierBatch = (tier: number): { wins: number; losses: number } => {
  let wins = 0;
  let losses = 0;
  for (const higher of OPPONENTS.filter((o) => o.tier === tier)) {
    for (const lower of OPPONENTS.filter((o) => o.tier === tier - 1)) {
      for (const [blue, red] of [
        [higher, lower],
        [lower, higher],
      ] as const) {
        const summary = runBatch({
          sides: [
            {
              id: 'blue',
              name: 'Blue',
              commander: 'computer',
              design: blue.design,
              skill: skillOf(blue),
            },
            {
              id: 'red',
              name: 'Red',
              commander: 'computer',
              design: red.design,
              skill: skillOf(red),
            },
          ],
          scenario: startingScenario('head-on'),
          battles: 1,
          seed: 11,
          timeLimit: DEFAULT_TIME_LIMIT,
        });
        const [first, second] = summary.sides.map((side) => side.wins);
        wins += (blue === higher ? first : second) ?? 0;
        losses += (blue === higher ? second : first) ?? 0;
      }
    }
  }
  return { wins, losses };
};
