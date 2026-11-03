import { handMadeDesign } from '../data/designs';
import { OPENING_PASS, startingScenario, type StartingScenario } from '../data/scenarios';
import { createBattle, type Commander, type SideSetup } from '../sim/battle';
import type { BatchSetup } from './batch';
import { createBattleRunner, type BattleRunner } from './battleRunner';
import type { RecordedAction } from './orderLog';

/** One side of a free battle as chosen on the setup screen. */
export interface FreeBattleSide {
  /** A hand-made design's id. */
  readonly designId: string;
  readonly commander: Commander;
}

/** The choices for a free battle: always two sides, Blue then Red, and where they start. */
export interface FreeBattleSetup {
  readonly sides: readonly [FreeBattleSide, FreeBattleSide];
  /** A starting scenario's id; the opening pass if left out. */
  readonly scenarioId?: string;
}

/** The two sides' fixed identities, in battle order. */
export const FREE_BATTLE_SIDES = [
  { id: 'blue', name: 'Blue' },
  { id: 'red', name: 'Red' },
] as const;

/** What the setup screen offers first: the player's frigate against a computer cruiser. */
export const DEFAULT_FREE_BATTLE: FreeBattleSetup = {
  sides: [
    { designId: 'lance', commander: 'player' },
    { designId: 'bastion', commander: 'computer' },
  ],
  scenarioId: OPENING_PASS.id,
};

/** The battle's sides for a free battle's choices. */
export const freeBattleSides = (setup: FreeBattleSetup): readonly SideSetup[] =>
  FREE_BATTLE_SIDES.map((side, i) => {
    const { designId, commander } = setup.sides[i] ?? DEFAULT_FREE_BATTLE.sides[0];
    return { ...side, commander, design: handMadeDesign(designId) };
  });

/** The starting scenario a free battle's choices name. */
export const freeBattleScenario = (setup: FreeBattleSetup): StartingScenario =>
  startingScenario(setup.scenarioId ?? OPENING_PASS.id);

/** What test mode adds to a free battle. */
export interface FreeBattleTestMode {
  /** The battle ends with no result once this much simulated time has passed, s. */
  readonly timeLimit: number;
  /** The actions recorded in an earlier battle from the same choices and seed, to replay it. */
  readonly replay?: readonly RecordedAction[];
}

/** A new seed for a battle, different each time. */
export const newSeed = (): number => Math.floor(Math.random() * 2 ** 32);

/**
 * Sets up a free battle in its chosen scenario and returns it ready to run. The same choices and
 * seed fight the same battle, given the same orders. Test mode adds a time limit, time
 * compression above 1000× and replay: the orders another battle recorded, given again.
 */
export const startFreeBattle = (
  setup: FreeBattleSetup,
  seed = newSeed(),
  testMode?: FreeBattleTestMode,
): BattleRunner =>
  createBattleRunner(
    createBattle({
      seed,
      scenario: freeBattleScenario(setup),
      sides: freeBattleSides(setup),
      ...(testMode && { timeLimit: testMode.timeLimit }),
    }),
    { testMode: testMode !== undefined, ...(testMode?.replay && { replay: testMode.replay }) },
  );

/**
 * A test mode batch run of free battles in the chosen scenario between the chosen designs; the
 * computer commands both sides, whatever the choices say.
 */
export const freeBattleBatch = (
  setup: FreeBattleSetup,
  options: Pick<BatchSetup, 'battles' | 'seed' | 'timeLimit'>,
): BatchSetup => ({
  sides: freeBattleSides(setup),
  scenario: freeBattleScenario(setup),
  ...options,
});
