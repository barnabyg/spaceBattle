import { TIME_STEP, type Battle, type BattleEvent } from '../sim/battle';
import { withComputerCaptains } from '../sim/command';
import { withOrderLog, type RecordedAction } from './orderLog';

/** The time compression settings the captain can choose between. */
export const TIME_COMPRESSIONS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const;
/** In test mode, time compression goes on above 1000×. */
export const TEST_TIME_COMPRESSIONS = [...TIME_COMPRESSIONS, 2000, 5000, 10_000] as const;
export type TimeCompression = (typeof TEST_TIME_COMPRESSIONS)[number];

/**
 * Whether each kind of event drops time compression back to real time, so the captain can
 * respond. A record, so a new kind of event cannot be added without deciding.
 */
const SIGNIFICANT: Readonly<Record<BattleEvent['type'], boolean>> = {
  hit: true,
  impact: true,
  launch: true,
  intercept: true,
  miss: true,
  detonation: true,
  'magazine-explosion': true,
  'armour-breached': true,
  'component-lost': true,
  'structural-failure': true,
  'battle-ended': true,
};

/** Real time longer than this between updates (e.g. a background tab) is not caught up. */
const MAX_REAL_DELTA = 0.25;
/**
 * No update runs more steps than this (250 s of battle), so the highest time compressions keep
 * the screen responsive; the battle then runs as fast as the computer allows.
 */
const MAX_STEPS_PER_UPDATE = 2_500;

export interface BattleRunnerOptions {
  /** Test mode offers time compression above 1000×. */
  readonly testMode?: boolean;
  /**
   * Test mode's replay: the actions another runner of the same battle recorded, given again
   * before the same steps (see `withOrderLog`).
   */
  readonly replay?: readonly RecordedAction[];
}

/**
 * Turns real time into whole simulation steps, honouring pause and time compression. Computer
 * sides are commanded by their captains as the battle runs; player sides wait for orders.
 */
export interface BattleRunner {
  /**
   * The battle, with its computer sides commanded (see `withComputerCaptains`) and the orders
   * given to it recorded.
   */
  readonly battle: Battle;
  /** The orders and "End battle" given to `battle`, oldest first, for replaying it. */
  readonly orders: readonly RecordedAction[];
  readonly paused: boolean;
  readonly timeCompression: TimeCompression;
  setPaused(paused: boolean): void;
  togglePause(): void;
  setTimeCompression(compression: TimeCompression): void;
  faster(): void;
  slower(): void;
  /**
   * Runs the battle forward by `realSeconds` of real time, returning what happened. A
   * significant event, such as a hit or a component lost, drops time compression to 1× and
   * ends the update there. Once the battle has ended, updates do nothing.
   */
  update(realSeconds: number): readonly BattleEvent[];
}

export const createBattleRunner = (
  uncommanded: Battle,
  { testMode = false, replay = [] }: BattleRunnerOptions = {},
): BattleRunner => {
  const { battle, log } = withOrderLog(withComputerCaptains(uncommanded), replay);
  const compressions: readonly TimeCompression[] = testMode
    ? TEST_TIME_COMPRESSIONS
    : TIME_COMPRESSIONS;
  let paused = false;
  let compressionIndex = 0;
  let owed = 0;

  const compression = (): TimeCompression => compressions[compressionIndex] ?? 1;

  return {
    battle,
    orders: log,
    get paused() {
      return paused;
    },
    get timeCompression() {
      return compression();
    },
    setPaused(value) {
      paused = value;
    },
    togglePause() {
      paused = !paused;
    },
    setTimeCompression(value) {
      // A compression this runner does not offer leaves it at real time.
      compressionIndex = Math.max(compressions.indexOf(value), 0);
    },
    faster() {
      compressionIndex = Math.min(compressionIndex + 1, compressions.length - 1);
    },
    slower() {
      compressionIndex = Math.max(compressionIndex - 1, 0);
    },
    update(realSeconds) {
      if (paused || battle.outcome) return [];
      owed += Math.min(Math.max(realSeconds, 0), MAX_REAL_DELTA) * compression();
      // The small allowance stops rounding error in `owed` from dropping a step.
      const steps = Math.min(Math.floor(owed / TIME_STEP + 1e-9), MAX_STEPS_PER_UPDATE);
      // Time owed beyond the most one update runs is not caught up either.
      owed = steps < MAX_STEPS_PER_UPDATE ? owed - steps * TIME_STEP : 0;
      const events: BattleEvent[] = [];
      for (let i = 0; i < steps; i++) {
        const happened = battle.step();
        events.push(...happened);
        if (happened.some((event) => SIGNIFICANT[event.type])) {
          compressionIndex = 0;
          owed = 0;
          break;
        }
      }
      return events;
    },
  };
};
