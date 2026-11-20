import { TIME_STEP, type Battle, type BattleEvent, type SideId } from '../sim/battle';
import { withComputerCaptains } from '../sim/command';
import { targetsMissile } from '../sim/missile';
import { withOrderLog, type RecordedAction } from './orderLog';

/** The time compression settings the captain can choose between. */
export const TIME_COMPRESSIONS = [1, 10, 100, 500, 1000] as const;
/** In test mode, time compression goes on above 1000×. */
export const TEST_TIME_COMPRESSIONS = [...TIME_COMPRESSIONS, 2000, 5000, 10_000] as const;
export type TimeCompression = (typeof TEST_TIME_COMPRESSIONS)[number];

/**
 * Whether an event needs a watched side's captain, so time compression drops back to real time
 * for them to respond. Watched sides are the player's, or every side when the computer commands
 * them all. Damage a watched side does to an enemy does not: the hit indicator and battle log
 * report it while the battle runs on. A missile launched at a watched ship does, but only when it
 * opens a new threat, not for each further launch while enemy missiles already fly at that ship.
 * `launched` lists the ids of the missiles launched in the same step.
 */
const needsCaptain = (
  event: BattleEvent,
  watched: ReadonlySet<SideId>,
  battle: Battle,
  launched: ReadonlySet<number>,
): boolean => {
  switch (event.type) {
    case 'hit':
    case 'impact':
    case 'intercept':
    case 'miss':
      return false;
    case 'launch': {
      const { target } = event;
      if (targetsMissile(target) || !watched.has(target)) return false;
      return !battle
        .observe(target)
        .munitions.some(
          (m) =>
            m.kind === 'missile' &&
            m.target === target &&
            m.attacker !== target &&
            !launched.has(m.id),
        );
    }
    case 'armour-breached':
    case 'component-lost':
    case 'structural-failure':
      return watched.has(event.side);
    case 'detonation':
    case 'magazine-explosion':
    case 'withdrawal':
    case 'battle-ended':
      return true;
  }
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
  /** The time compressions this runner offers, slowest first; test mode adds more. */
  readonly compressions: readonly TimeCompression[];
  /** Kept while paused, so the battle resumes at it. */
  readonly timeCompression: TimeCompression;
  /** The event that last reduced compression from above 1×; cleared by choosing a speed. */
  readonly slowdownEvent: BattleEvent | null;
  setPaused(paused: boolean): void;
  togglePause(): void;
  /** Sets a time compression directly; one this runner does not offer leaves it at 1×. */
  setTimeCompression(compression: TimeCompression): void;
  /** Steps to the next time compression offered, stopping at the highest. */
  faster(): void;
  /** Steps to the previous time compression offered, stopping at 1×. */
  slower(): void;
  /**
   * Runs the battle forward by `realSeconds` of real time, returning what happened. An event
   * that needs the player's captain, such as an armour breach or a component lost on their own
   * ship or a new missile threat to it, drops time compression to 1× and ends the update there.
   * Once the battle has ended, updates do nothing.
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
  let slowdownEvent: BattleEvent | null = null;
  const players = battle.sides.filter((side) => side.commander === 'player');
  const watched = new Set((players.length > 0 ? players : battle.sides).map((side) => side.id));

  const compression = (): TimeCompression => compressions[compressionIndex] ?? 1;

  return {
    battle,
    orders: log,
    compressions,
    get paused() {
      return paused;
    },
    get timeCompression() {
      return compression();
    },
    get slowdownEvent() {
      return slowdownEvent;
    },
    setPaused(value) {
      paused = value;
    },
    togglePause() {
      paused = !paused;
    },
    setTimeCompression(value) {
      slowdownEvent = null;
      // A compression this runner does not offer leaves it at real time.
      compressionIndex = Math.max(compressions.indexOf(value), 0);
    },
    faster() {
      slowdownEvent = null;
      compressionIndex = Math.min(compressionIndex + 1, compressions.length - 1);
    },
    slower() {
      slowdownEvent = null;
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
        const launched = new Set(
          happened.flatMap((e) => (e.type === 'launch' ? [e.munition] : [])),
        );
        const significant = happened.find((event) =>
          needsCaptain(event, watched, battle, launched),
        );
        if (significant) {
          if (compression() > 1) slowdownEvent = significant;
          compressionIndex = 0;
          owed = 0;
          break;
        }
      }
      return events;
    },
  };
};
