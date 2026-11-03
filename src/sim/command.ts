import { createBattle, TIME_STEP, type Battle, type BattleEvent, type BattleSetup } from './battle';
import { createComputerCaptain } from './captain';

/** How often each computer captain looks at the battle and gives its orders, simulated s. */
export const DECISION_INTERVAL = 1;

const commanded = new WeakSet<Battle>();

/**
 * The battle with every computer side commanded by its captain. Before a step, once every
 * `DECISION_INTERVAL` of simulated time, each captain observes the battle and gives its orders,
 * which take effect from that step. Decisions follow simulated time alone, so a battle runs the
 * same whatever the frame rate or time compression. Player sides are left to the player.
 * Commanding a battle that is already commanded returns it unchanged.
 */
export const withComputerCaptains = (battle: Battle): Battle => {
  if (commanded.has(battle)) return battle;
  const captains = battle.sides
    .filter((side) => side.commander === 'computer')
    .map((side) => createComputerCaptain(side));
  let nextDecision = 0;

  const step = (): readonly BattleEvent[] => {
    // The small allowance stops rounding error in the battle's time from skipping a decision.
    if (!battle.outcome && battle.time >= nextDecision - 1e-9) {
      for (const captain of captains) {
        for (const order of captain.decide(battle.observe(captain.side))) {
          battle.giveOrder(captain.side, order);
        }
      }
      nextDecision = battle.time + DECISION_INTERVAL;
    }
    return battle.step();
  };

  const result: Battle = {
    sides: battle.sides,
    get time() {
      return battle.time;
    },
    get outcome() {
      return battle.outcome;
    },
    giveOrder: (sideId, order) => {
      battle.giveOrder(sideId, order);
    },
    step,
    advance(seconds) {
      const events: BattleEvent[] = [];
      const count = Math.round(seconds / TIME_STEP);
      for (let i = 0; i < count; i++) events.push(...step());
      return events;
    },
    observe: (sideId) => battle.observe(sideId),
    endBattle: (sideId) => battle.endBattle(sideId),
  };
  commanded.add(result);
  return result;
};

/**
 * Sets up a battle with every computer side commanded by its captain and runs it until it ends
 * or `maxTime` simulated seconds have passed, returning the battle. With computer sides alone
 * it plays out a whole battle, the same every time for the same setup.
 */
export const runBattle = (
  setup: BattleSetup,
  { maxTime }: { readonly maxTime: number },
): Battle => {
  const battle = withComputerCaptains(createBattle(setup));
  while (!battle.outcome && battle.time < maxTime - 1e-9) battle.step();
  return battle;
};
