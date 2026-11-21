import { TIME_STEP, type Battle, type BattleEvent, type SideId } from '../sim/battle';
import { withComputerCaptains } from '../sim/command';
import { targetsMissile } from '../sim/missile';
import {
  advanceTest,
  passAhead,
  passInReach,
  type AdvanceCondition,
  type AdvanceTest,
} from './advance';
import type { ClosestPass } from './relativeMotion';
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
    case 'disarmed':
      return watched.has(event.side);
    case 'detonation':
    case 'magazine-explosion':
    case 'withdrawal':
    case 'adrift':
    case 'battle-ended':
      return true;
  }
};

/**
 * Before a pass that comes within any weapon's reach, time compression drops to 10× this long
 * before closest approach, s...
 */
export const PASS_WARNING = 600;
/** ...and to 1× this long before it, s. */
export const PASS_IMMINENT = 60;

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
  /**
   * The pass ahead, within some weapon's reach, that last slowed the battle into it (see
   * `PASS_WARNING`), as it stood then; cleared by choosing a speed.
   */
  readonly slowdownPass: ClosestPass | null;
  /** The advance under way, or null (see `advanceUntil`). */
  readonly advancing: AdvanceCondition | null;
  /**
   * The condition the last advance reached, pausing the battle; cleared by choosing a speed,
   * pausing or resuming, or starting another advance.
   */
  readonly advanceReached: AdvanceCondition | null;
  /**
   * Runs the battle at the highest time compression offered until `condition` holds for
   * `side`, then pauses it at the step it first holds, keeping the time compression chosen
   * before. An event that needs the captain stops it first, at 1× as ever. Choosing a speed or
   * pausing cancels it. Returns why it cannot start (its condition already holds, say), or null
   * once it has started.
   */
  advanceUntil(side: SideId, condition: AdvanceCondition): string | null;
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
   * A closest pass within any weapon's reach slows it to 10× `PASS_WARNING` before and to 1×
   * `PASS_IMMINENT` before, once each per pass, unless an advance runs until that pass. Once the
   * battle has ended, updates do nothing.
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
  let slowdownPass: ClosestPass | null = null;
  const players = battle.sides.filter((side) => side.commander === 'player');
  const watched = new Set((players.length > 0 ? players : battle.sides).map((side) => side.id));
  /** The side whose view of the pass ahead slows the battle into it. */
  const viewer = [...watched][0];
  /** How far the battle has slowed into the pass ahead: 0 not yet, 1 to 10×, 2 to 1×. */
  let passStage = 0;
  let advance: {
    readonly side: SideId;
    readonly condition: AdvanceCondition;
    readonly test: AdvanceTest;
    /** The time compression chosen before the advance, kept for after it. */
    readonly resumeAt: number;
  } | null = null;
  let advanceReached: AdvanceCondition | null = null;

  const compression = (): TimeCompression => compressions[compressionIndex] ?? 1;
  /** Ends any advance under way, back at the time compression chosen before it. */
  const cancelAdvance = () => {
    if (advance) compressionIndex = advance.resumeAt;
    advance = null;
    advanceReached = null;
  };

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
    get slowdownPass() {
      return slowdownPass;
    },
    get advancing() {
      return advance?.condition ?? null;
    },
    get advanceReached() {
      return advanceReached;
    },
    advanceUntil(side, condition) {
      if (battle.outcome) return 'The battle is over';
      const test = advanceTest(condition, battle.observe(side));
      if (typeof test === 'string') return test;
      cancelAdvance();
      slowdownEvent = null;
      slowdownPass = null;
      advance = { side, condition, test, resumeAt: compressionIndex };
      compressionIndex = compressions.length - 1;
      paused = false;
      return null;
    },
    setPaused(value) {
      cancelAdvance();
      paused = value;
    },
    togglePause() {
      cancelAdvance();
      paused = !paused;
    },
    setTimeCompression(value) {
      cancelAdvance();
      slowdownEvent = null;
      slowdownPass = null;
      // A compression this runner does not offer leaves it at real time.
      compressionIndex = Math.max(compressions.indexOf(value), 0);
    },
    faster() {
      cancelAdvance();
      slowdownEvent = null;
      slowdownPass = null;
      compressionIndex = Math.min(compressionIndex + 1, compressions.length - 1);
    },
    slower() {
      cancelAdvance();
      slowdownEvent = null;
      slowdownPass = null;
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
          if (compression() > 1) {
            slowdownEvent = significant;
            slowdownPass = null;
          }
          advance = null;
          compressionIndex = 0;
          owed = 0;
          break;
        }
        const view = viewer === undefined ? null : battle.observe(viewer);
        const ahead = view && passAhead(view);
        if (!view || !ahead) {
          passStage = 0;
        } else if (advance?.condition.type !== 'closest-pass' && passInReach(view)) {
          const stage = ahead.time <= PASS_IMMINENT ? 2 : ahead.time <= PASS_WARNING ? 1 : 0;
          const cap = stage === 2 ? 1 : 10;
          if (stage > passStage) {
            passStage = stage;
            if (compression() > cap) {
              slowdownPass = ahead;
              slowdownEvent = null;
              advance = null;
              compressionIndex = Math.max(compressions.indexOf(cap), 0);
              owed = 0;
              break;
            }
          }
        }
        const advanceView = advance?.side === viewer && view ? view : null;
        if (advance?.test(advanceView ?? battle.observe(advance.side), happened)) {
          advanceReached = advance.condition;
          compressionIndex = advance.resumeAt;
          advance = null;
          paused = true;
          owed = 0;
          break;
        }
      }
      return events;
    },
  };
};
