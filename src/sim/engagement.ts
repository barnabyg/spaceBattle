import type { Order } from './orders';

/**
 * Rules of engagement: limits on what captains may order, kept apart from the physics model
 * (ADR-0002). They say what a captain may not do, never what physics allows.
 */

/** How long after its order a withdrawing ship is gone even if still within reach, s: 30 min. */
export const WITHDRAWAL_TIME = 1_800;

/**
 * Why an order is refused while the enemy withdraws, or null if it may be given. The enemy may
 * keep firing at a withdrawing ship, launches included, but may not pursue it: the autopilot may
 * not close on it, hold a range to it or match its velocity. Opening the range is allowed.
 */
export const pursuitRefused = (order: Order): string | null =>
  order.type === 'manoeuvre' &&
  (order.goal === 'close' || order.goal === 'hold' || order.goal === 'match-velocity')
    ? 'A ship may not pursue an enemy that is withdrawing'
    : null;

/** Why an order to move is refused for a ship that is withdrawing, or null if it may be given. */
export const withdrawingRefused = (order: Order): string | null =>
  order.type === 'manoeuvre' ||
  order.type === 'attitude' ||
  order.type === 'burn' ||
  order.type === 'withdraw'
    ? 'A ship that is withdrawing takes no other order to move'
    : null;
