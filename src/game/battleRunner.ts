import { TIME_STEP, type Battle } from '../sim/battle';

/** The time compression settings the captain can choose between. */
export const TIME_COMPRESSIONS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const;
export type TimeCompression = (typeof TIME_COMPRESSIONS)[number];

/** Real time longer than this between updates (e.g. a background tab) is not caught up. */
const MAX_REAL_DELTA = 0.25;

/** Turns real time into whole simulation steps, honouring pause and time compression. */
export interface BattleRunner {
  readonly battle: Battle;
  readonly paused: boolean;
  readonly timeCompression: TimeCompression;
  setPaused(paused: boolean): void;
  togglePause(): void;
  setTimeCompression(compression: TimeCompression): void;
  faster(): void;
  slower(): void;
  /** Runs the battle forward by `realSeconds` of real time. */
  update(realSeconds: number): void;
}

export const createBattleRunner = (battle: Battle): BattleRunner => {
  let paused = false;
  let compressionIndex = 0;
  let owed = 0;

  const compression = (): TimeCompression => TIME_COMPRESSIONS[compressionIndex] ?? 1;

  return {
    battle,
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
      compressionIndex = TIME_COMPRESSIONS.indexOf(value);
    },
    faster() {
      compressionIndex = Math.min(compressionIndex + 1, TIME_COMPRESSIONS.length - 1);
    },
    slower() {
      compressionIndex = Math.max(compressionIndex - 1, 0);
    },
    update(realSeconds) {
      if (paused) return;
      owed += Math.min(Math.max(realSeconds, 0), MAX_REAL_DELTA) * compression();
      // The small allowance stops rounding error in `owed` from dropping a step.
      const steps = Math.floor(owed / TIME_STEP + 1e-9);
      owed -= steps * TIME_STEP;
      for (let i = 0; i < steps; i++) battle.step();
    },
  };
};
