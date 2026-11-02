import { TIME_STEP, type Battle, type BattleEvent, type SideId } from '../sim/battle';
import type { Order } from '../sim/orders';

/** Something a captain did to the battle from outside it: an order, or "End battle". */
export type CaptainAction =
  { readonly type: 'order'; readonly order: Order } | { readonly type: 'end-battle' };

/** A captain's action and how many steps the battle had taken when it was given. */
export interface RecordedAction {
  readonly step: number;
  readonly sideId: SideId;
  readonly action: CaptainAction;
}

/** A battle that records the orders given to it, and the log it keeps. */
export interface LoggedBattle {
  readonly battle: Battle;
  /** Every action given through `battle` that the battle took, oldest first. */
  readonly log: readonly RecordedAction[];
}

/**
 * Records every order and "End battle" given to the battle from outside, with the step it came
 * before, so the same seed and setup can fight it again exactly: given `replay`, the battle
 * gives those actions again before the same steps, recording them as it goes. Orders the
 * computer captains of `battle` give are not recorded, since they decide the same way again.
 */
export const withOrderLog = (
  battle: Battle,
  replay: readonly RecordedAction[] = [],
): LoggedBattle => {
  const log: RecordedAction[] = [];
  let steps = 0;
  let next = 0;

  const giveOrder = (sideId: SideId, order: Order): void => {
    if (battle.outcome) return;
    battle.giveOrder(sideId, order);
    log.push({ step: steps, sideId, action: { type: 'order', order } });
  };
  const endBattle = (sideId: SideId): readonly BattleEvent[] => {
    const events = battle.endBattle(sideId);
    if (events.length > 0) log.push({ step: steps, sideId, action: { type: 'end-battle' } });
    return events;
  };

  const step = (): readonly BattleEvent[] => {
    const events: BattleEvent[] = [];
    for (let due = replay[next]; due && due.step <= steps; due = replay[++next]) {
      if (due.action.type === 'order') giveOrder(due.sideId, due.action.order);
      else events.push(...endBattle(due.sideId));
    }
    // A battle that is over takes no more steps.
    if (!battle.outcome) steps++;
    return [...events, ...battle.step()];
  };

  return {
    log,
    battle: {
      sides: battle.sides,
      get time() {
        return battle.time;
      },
      get outcome() {
        return battle.outcome;
      },
      giveOrder,
      step,
      advance(seconds) {
        const events: BattleEvent[] = [];
        const count = Math.round(seconds / TIME_STEP);
        for (let i = 0; i < count; i++) events.push(...step());
        return events;
      },
      observe: (sideId) => battle.observe(sideId),
      endBattle,
    },
  };
};
