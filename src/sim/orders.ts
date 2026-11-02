import type { Vec3 } from './vector';

/** Turn the ship so its nose points at the enemy, away from it, or along a world direction. */
export type AttitudeOrder =
  | { readonly type: 'attitude'; readonly mode: 'enemy' }
  | { readonly type: 'attitude'; readonly mode: 'away' }
  | { readonly type: 'attitude'; readonly mode: 'direction'; readonly direction: Vec3 };

/** Fire the drive along the nose at a throttle (0–1) for a duration (s); throttle 0 cuts it. */
export interface BurnOrder {
  readonly type: 'burn';
  readonly throttle: number;
  readonly duration: number;
}

/** What a manoeuvre order has the autopilot work towards. */
export type ManoeuvreGoal = 'close' | 'hold' | 'open' | 'match-velocity';

/**
 * A standing order: the autopilot plans turns and burns towards a goal relative to the enemy
 * until another manoeuvre, an attitude or burn order, or the goal 'none' replaces it. Close,
 * hold and open work towards a separation (`range`, m); match velocity towards zero relative
 * velocity.
 */
export type ManoeuvreOrder =
  | { readonly type: 'manoeuvre'; readonly goal: 'close' | 'hold' | 'open'; readonly range: number }
  | { readonly type: 'manoeuvre'; readonly goal: 'match-velocity' }
  | { readonly type: 'manoeuvre'; readonly goal: 'none' };

/** An instruction from a side's captain to its ship. */
export type Order = AttitudeOrder | BurnOrder | ManoeuvreOrder;
