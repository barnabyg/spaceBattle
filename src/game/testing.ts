import { HAND_MADE_DESIGNS } from '../data/designs';
import { runBatch, type BatchSummary } from './batch';
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
      { battles: 1, seed, timeLimit: 12 * 3_600 },
    ),
  );
