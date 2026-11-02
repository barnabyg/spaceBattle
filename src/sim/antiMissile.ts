import type { SideId } from './battle';
import type { FragmentationWarheadDesign, MissileDesign } from './design';
import type { Motion } from './kinetic';
import { missileDeltaV, missileSilhouette, type Missile } from './missile';
import { add, dot, length, scale, sub, type Vec3 } from './vector';

/**
 * The chance a fragmentation warhead bursting `distance` m from a missile brings it down. Its
 * fragments spread evenly over the cone's cross-section where they reach the missile, a disc of
 * radius distance·tan(spread); the missile's silhouette, `silhouette` m², catches
 * fragments·silhouette/disc of them on average. Hits fall at random, so the chance of at least
 * one is 1 − e^(−hits); at the speeds missiles meet, one fragment wrecks a missile. Bursting so
 * close that the missile fills the cone, every fragment hits.
 */
export const fragmentationChance = (
  warhead: FragmentationWarheadDesign,
  distance: number,
  silhouette: number,
): number => {
  const disc = Math.PI * (distance * Math.tan(warhead.spread)) ** 2;
  const hits = disc > silhouette ? (warhead.fragments * silhouette) / disc : warhead.fragments;
  return 1 - Math.exp(-hits);
};

/**
 * The chance a fragmentation warhead bursting near an enemy missile brings it down. `offset` runs
 * from the missile to the burst and `closing` is the burst's velocity relative to the missile, m
 * and m/s: the fragments fly on at about that velocity, so they meet the missile seen along it.
 * The missile flies nose first along `heading` (any length), its velocity relative to the ship it
 * is closing on.
 */
export const burstChance = (
  warhead: FragmentationWarheadDesign,
  target: MissileDesign,
  offset: Vec3,
  closing: Vec3,
  heading: Vec3,
): number => {
  const along = length(closing) > 0 ? closing : offset;
  return fragmentationChance(
    warhead,
    length(offset),
    missileSilhouette(target, heading, scale(along, 1 / Math.max(length(along), 1e-12))),
  );
};

/**
 * How closely a missile coasting at its present velocity passes a ship that holds its own, m:
 * where it is now if it is already moving away.
 */
const closestApproach = (relative: { readonly position: Vec3; readonly velocity: Vec3 }) => {
  const speed = dot(relative.velocity, relative.velocity);
  const time = speed > 0 ? Math.max(0, -dot(relative.position, relative.velocity) / speed) : 0;
  return length(add(relative.position, scale(relative.velocity, time)));
};

/**
 * The enemy missiles predicted to reach a side's ship, soonest first: those aimed at it and
 * closing on it. A missile with delta-v left can still steer onto the ship; one without must
 * already be on a path passing within `reach` of the ship's centre of mass, its size.
 */
export const incomingMissiles = (
  side: SideId,
  ship: Pick<Motion, 'position' | 'velocity'>,
  missiles: readonly Missile[],
  reach: number,
): Missile[] =>
  missiles
    .flatMap((missile) => {
      if (missile.target !== side) return [];
      const relative = {
        position: sub(missile.position, ship.position),
        velocity: sub(missile.velocity, ship.velocity),
      };
      const range = length(relative.position);
      const closing = range > 0 ? -dot(relative.velocity, relative.position) / range : 0;
      if (!(closing > 0)) return [];
      const steering = missileDeltaV(missile.design, missile.propellantMass) > 0;
      if (!steering && closestApproach(relative) > reach) return [];
      return [{ missile, time: range / closing }];
    })
    .sort((a, b) => a.time - b.time || a.missile.id - b.missile.id)
    .map(({ missile }) => missile);
