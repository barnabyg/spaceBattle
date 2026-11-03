import type { Order } from './orders';
import { dot, normalize, sub, type Vec3 } from './vector';

/**
 * Rules of engagement: limits on what captains may order, kept apart from the physics model
 * (ADR-0002). They say what a captain may not do, never what physics allows.
 */

/** How long after its order a withdrawing ship is gone even if still within reach, s: 30 min. */
export const WITHDRAWAL_TIME = 1_800;

/**
 * A ship counts as pointing towards the enemy, for pursuit, once its nose is within this angle of
 * square to the line of sight (the cosine of the angle from it): about 85°.
 */
const TOWARDS = 0.087;

/** A ship as the rules of engagement see it, and where the enemy it might pursue is. */
export interface Pursuer {
  readonly position: Vec3;
  /** World unit vector along its nose. */
  readonly nose: Vec3;
  readonly enemy: Vec3;
}

/**
 * Why an order is refused while the enemy withdraws, or null if it may be given. The enemy may
 * keep firing at a withdrawing ship, launches included, but may not pursue it: the autopilot may
 * not close on it, hold a range to it or match its velocity, and under manual control the ship
 * may not point towards it or burn while its nose does. Opening the range is allowed.
 */
export const pursuitRefused = (order: Order, pursuer: Pursuer): string | null => {
  const towards = normalize(sub(pursuer.enemy, pursuer.position));
  const pursuing =
    order.type === 'manoeuvre'
      ? order.goal === 'close' || order.goal === 'hold' || order.goal === 'match-velocity'
      : order.type === 'attitude'
        ? order.mode === 'enemy' ||
          (order.mode === 'direction' && dot(normalize(order.direction), towards) > TOWARDS)
        : order.type === 'burn'
          ? order.throttle > 0 && order.duration > 0 && dot(pursuer.nose, towards) > TOWARDS
          : false;
  return pursuing ? 'A ship may not pursue an enemy that is withdrawing' : null;
};

/** Why an order to move is refused for a ship that is withdrawing, or null if it may be given. */
export const withdrawingRefused = (order: Order): string | null =>
  order.type === 'manoeuvre' ||
  order.type === 'attitude' ||
  order.type === 'burn' ||
  order.type === 'withdraw'
    ? 'A ship that is withdrawing takes no other order to move'
    : null;
