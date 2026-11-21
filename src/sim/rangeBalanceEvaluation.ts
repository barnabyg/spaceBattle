import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { STARTING_SCENARIOS } from '../data/scenarios';
import { createBattle, type BattleEvent } from './battle';
import { withComputerCaptains } from './command';
import { duelSetup } from './testing';
import { distance } from './vector';

/** Test helpers for the range balance evaluation. Not used by the game itself. */

const KM = 1_000;
const HOUR = 3_600;

const PAIRS = [
  ['lance', 'sling'],
  ['lance', 'lance'],
  ['sling', 'sling'],
  ['lance', 'quiver'],
  ['lance', 'torch'],
  ['quiver', 'quiver'],
  ['lance', 'needle'],
] as const;

const CASES = PAIRS.flatMap(([blue, red]) =>
  STARTING_SCENARIOS.flatMap((scenario) => [1, 7].map((seed) => ({ blue, red, scenario, seed }))),
);

/** One battle of the evaluation, as the balance report records it. */
export interface RangeBalanceRecord {
  readonly blue: string;
  readonly red: string;
  readonly scenario: string;
  readonly seed: number;
  readonly time: number;
  readonly winner: string | null;
  readonly losses: readonly (string | null)[];
  readonly first: Readonly<Record<string, number>>;
  readonly minimumKm: number;
  readonly hitKm: readonly number[];
  readonly withdrawals: readonly BattleEvent[];
}

/**
 * A repeatable evaluation at the same observation boundary as the range balance regressions:
 * computer captains fight hand-made duels in every starting scenario from two seeds. Its
 * battles are split into `parts` parts, for test files that each fight one part, so the test
 * runner fights them in parallel. `report` receives a record of every battle.
 */
export const describeRangeBalanceEvaluation = (
  part: number,
  parts: number,
  report?: (record: RangeBalanceRecord) => void,
) => {
  describe(`range balance evaluation, part ${part + 1}`, () => {
    it.each(CASES.filter((_, i) => i % parts === part))(
      '$blue / $red: $scenario.id, seed $seed',
      ({ blue, red, scenario, seed }) => {
        const setup = duelSetup(handMadeDesign(blue), handMadeDesign(red), scenario.separation);
        const battle = withComputerCaptains(
          createBattle({
            ...setup,
            seed,
            scenario,
            timeLimit: 12 * HOUR,
            sides: setup.sides.map((side) => ({ ...side, commander: 'computer' })),
          }),
        );
        const first: Record<string, number> = {};
        const hitRanges: number[] = [];
        const withdrawals: BattleEvent[] = [];
        let minimumRange = Infinity;
        while (!battle.outcome) {
          const events = battle.advance(10);
          const observation = battle.observe('red');
          const contact = observation.contacts[0];
          if (contact)
            minimumRange = Math.min(
              minimumRange,
              distance(observation.ownShip.position, contact.position),
            );
          for (const event of events) {
            if (event.type === 'hit') hitRanges.push(event.range / KM);
            if (event.type === 'hit' || event.type === 'impact' || event.type === 'launch')
              first[event.attacker] ??= event.time;
            if (event.type === 'withdrawal') withdrawals.push(event);
          }
        }
        report?.({
          blue,
          red,
          scenario: scenario.id,
          seed,
          time: battle.time,
          winner: battle.outcome.winner,
          losses: battle.outcome.sides.map((side) => side.loss?.result ?? null),
          first,
          minimumKm: Math.round(minimumRange / KM),
          hitKm: hitRanges.length
            ? [Math.round(Math.min(...hitRanges)), Math.round(Math.max(...hitRanges))]
            : [],
          withdrawals,
        });
        expect(battle.outcome.sides.some((side) => side.loss !== null)).toBe(true);
        if (blue === red) {
          expect(first.blue).toBeDefined();
          expect(first.red).toBeDefined();
        }
        // The Sling presses into its guns' reach: it wins there or withdraws, and is not lost.
        if (red === 'sling' && blue === 'lance') {
          expect(battle.outcome.sides[1]?.shipLost).toBe(false);
        }
      },
      120_000, // Simulates hours of battle; takes up to about 8 s under full-suite load.
    );
  });
};
