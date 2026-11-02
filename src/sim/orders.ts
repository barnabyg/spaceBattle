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

/** An instruction from a side's captain to its ship. */
export type Order = AttitudeOrder | BurnOrder;
