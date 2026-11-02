import { createBattle, type Scenario, type SideId, type SideSetup } from '../sim/battle';
import { withComputerCaptains } from '../sim/command';
import type { BattleOutcome, Loss } from '../sim/outcome';
import { createRandom } from '../sim/random';

/**
 * A test mode batch run: the same two sides fight `battles` battles, each commanded by the
 * computer, without graphics. Every battle ends by the time limit at the latest.
 */
export interface BatchSetup {
  /** The sides as for a battle; the computer commands each, whoever the setup names. */
  readonly sides: readonly SideSetup[];
  readonly scenario: Scenario;
  /** How many battles to fight. */
  readonly battles: number;
  /** The batch's seed, from which each battle's own seed is derived. */
  readonly seed: number;
  /** Each battle ends with no result once this much simulated time has passed, s. */
  readonly timeLimit: number;
}

/** One battle of a batch: its place in the batch, the seed it was fought from and its outcome. */
export interface BatchBattle {
  readonly index: number;
  readonly seed: number;
  readonly outcome: BattleOutcome;
}

/** One side's record over a batch. */
export interface BatchSideSummary {
  readonly side: SideId;
  readonly name: string;
  readonly designName: string;
  readonly wins: number;
  /** How the side lost, each way it did with the number of times; most frequent first. */
  readonly losses: readonly { readonly loss: Loss; readonly count: number }[];
}

/** What a batch run came to: how often each side won, and how the battles ended. */
export interface BatchSummary {
  readonly battles: number;
  /** Each side, in the battle's order. */
  readonly sides: readonly BatchSideSummary[];
  /** Battles in which every side lost in the same step. */
  readonly draws: number;
  /** Battles that reached the time limit with no side lost. */
  readonly noResults: number;
  /** The mean battle time of battles with a result (a win or a draw), s; null if none had one. */
  readonly meanTimeToResult: number | null;
}

const checkBatch = (batch: BatchSetup) => {
  if (!(Number.isInteger(batch.battles) && batch.battles > 0)) {
    throw new Error('A batch needs a whole number of battles, at least one');
  }
  if (!(batch.timeLimit > 0 && Number.isFinite(batch.timeLimit))) {
    throw new Error('A batch needs a time limit of a positive number of seconds');
  }
};

/** The seed battle `index` of a batch is fought from: the same for the same batch seed. */
export const batchBattleSeed = (batchSeed: number, index: number): number =>
  Math.floor(createRandom((batchSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0)() * 2 ** 32);

/** Fights battle `index` of a batch to its end, with every side commanded by the computer. */
export const runBatchBattle = (batch: BatchSetup, index: number): BatchBattle => {
  checkBatch(batch);
  const seed = batchBattleSeed(batch.seed, index);
  const battle = withComputerCaptains(
    createBattle({
      seed,
      scenario: batch.scenario,
      sides: batch.sides.map((side) => ({ ...side, commander: 'computer' })),
      timeLimit: batch.timeLimit,
    }),
  );
  let outcome = battle.outcome;
  while (!outcome) {
    battle.step();
    outcome = battle.outcome;
  }
  return { index, seed, outcome };
};

const lossKey = (loss: Loss) => ('cause' in loss ? `${loss.result}:${loss.cause}` : loss.result);

/** Sums up a batch's battles, which may be given in any order. */
export const summariseBatch = (
  batch: BatchSetup,
  battles: readonly BatchBattle[],
): BatchSummary => {
  const ordered = [...battles].sort((a, b) => a.index - b.index);
  const decided = ordered.filter(({ outcome }) => outcome.sides.some((s) => s.loss));
  const sides = batch.sides.map((side): BatchSideSummary => {
    const losses = new Map<string, { loss: Loss; count: number }>();
    for (const { outcome } of ordered) {
      const loss = outcome.sides.find((s) => s.side === side.id)?.loss;
      if (!loss) continue;
      const counted = losses.get(lossKey(loss));
      if (counted) counted.count += 1;
      else losses.set(lossKey(loss), { loss, count: 1 });
    }
    return {
      side: side.id,
      name: side.name,
      designName: side.design.name,
      wins: ordered.filter(({ outcome }) => outcome.winner === side.id).length,
      losses: [...losses.values()].sort((a, b) => b.count - a.count),
    };
  });
  return {
    battles: ordered.length,
    sides,
    draws: decided.filter(({ outcome }) => outcome.winner === null).length,
    noResults: ordered.length - decided.length,
    meanTimeToResult:
      decided.length > 0
        ? decided.reduce((total, { outcome }) => total + outcome.time, 0) / decided.length
        : null,
  };
};

/**
 * Fights every battle of a batch in turn, telling `onBattle` of each as it ends, and sums them up.
 * The same batch gives the same battles and summary every time.
 */
export const runBatch = (
  batch: BatchSetup,
  onBattle?: (battle: BatchBattle) => void,
): BatchSummary => {
  checkBatch(batch);
  const battles: BatchBattle[] = [];
  for (let index = 0; index < batch.battles; index++) {
    const battle = runBatchBattle(batch, index);
    battles.push(battle);
    onBattle?.(battle);
  }
  return summariseBatch(batch, battles);
};
