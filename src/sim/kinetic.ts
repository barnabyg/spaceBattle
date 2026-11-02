import { ARMOUR } from './armour';
import type { SideId } from './battle';
import type { ArmourType, KineticGunDesign } from './design';
import { conjugate, rotate, type Quat } from './quaternion';
import { firstHit, type ShapePart } from './shape';
import { add, dot, length, normalize, scale, sub, type Vec3 } from './vector';

/**
 * Fire control looses no slug that would take longer than this to reach its target, s: beyond
 * it, any change in the target's acceleration would throw the slug far wide.
 */
export const MAX_FLIGHT_TIME = 1_000;
/** Slugs are tungsten, kg/m³. */
export const SLUG_DENSITY = 19_300;
/**
 * A hypervelocity slug punches a hole through armour this many times its own diameter across,
 * as the impact splashes both slug and armour outward.
 */
export const HOLE_SCALE = 4;

/** Electrical energy one shot takes: ½mv² over the gun's efficiency, J. */
export const shotEnergy = (gun: KineticGunDesign): number =>
  (0.5 * gun.slugMass * gun.muzzleVelocity ** 2) / gun.efficiency;

/** Electrical power a gun draws at full integrity while it fires at its rate of fire, W. */
export const kineticGunPower = (gun: KineticGunDesign): number => shotEnergy(gun) * gun.rateOfFire;

/** The range out to which fire control fires: where a slug takes the longest flight allowed, m. */
export const kineticGunRange = (gun: KineticGunDesign): number =>
  gun.muzzleVelocity * MAX_FLIGHT_TIME;

/** Where a ship is and how it is moving. */
export interface Motion {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Over the last step, m/s². */
  readonly acceleration: Vec3;
}

/** Which way to fire a slug and how long it will take to reach the target. */
export interface FiringSolution {
  /** World unit vector, relative to the firing ship's motion. */
  readonly direction: Vec3;
  /** s */
  readonly flightTime: number;
}

/** How many refinements of the flight time fire control makes at most. */
const SOLUTION_ITERATIONS = 100;
/** Fire control stops refining once the flight time changes by less than this, s. */
const SOLUTION_TOLERANCE = 1e-7;

/**
 * Leads a target on its observed motion: the direction to fire a slug at `muzzleVelocity` from
 * the firing ship so that it meets the target if the target holds its acceleration. Ships move
 * in fixed steps of `step` seconds, velocity first, so a ship holding acceleration a for time t
 * travels v·t + ½·a·t·(t + step). The slug flies straight at constant velocity. Null when it
 * cannot reach the target within the longest flight allowed.
 */
export const firingSolution = (
  shooter: Pick<Motion, 'position' | 'velocity'>,
  target: Motion,
  muzzleVelocity: number,
  step: number,
): FiringSolution | null => {
  const offset = sub(target.position, shooter.position);
  const drift = sub(target.velocity, shooter.velocity);
  const relative = (t: number) =>
    add(add(offset, scale(drift, t)), scale(target.acceleration, 0.5 * t * (t + step)));
  // The slug must cover the distance to where the target will be by then: |r(t)| = u·t.
  let time = length(offset) / muzzleVelocity;
  for (let i = 0; i < SOLUTION_ITERATIONS; i++) {
    const next = length(relative(time)) / muzzleVelocity;
    if (!(next <= MAX_FLIGHT_TIME)) return null;
    const settled = Math.abs(next - time) < SOLUTION_TOLERANCE;
    time = next;
    if (settled) return { direction: normalize(relative(time)), flightTime: time };
  }
  return null;
};

/** A slug in flight. */
export interface Slug {
  /** Unique within the battle. */
  readonly id: number;
  readonly attacker: SideId;
  readonly target: SideId;
  /** kg */
  readonly mass: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** Where a slug meets a ship, in the ship's body frame. */
export interface SlugHit {
  readonly part: ShapePart;
  readonly point: Vec3;
  /** How far along the step's path it meets the ship, as a fraction of the path (0–1). */
  readonly along: number;
}

/** The furthest any part of a ship reaches from its centre of mass, m. */
export const shapeRadius = (parts: readonly ShapePart[]): number =>
  Math.max(
    0,
    ...parts.map((p) =>
      length({
        x: Math.max(-p.min.x, p.max.x),
        y: Math.max(-p.min.y, p.max.y),
        z: Math.max(-p.min.z, p.max.z),
      }),
    ),
  );

/** A ship's actual shape as a slug meets it. */
export interface Target {
  readonly parts: readonly ShapePart[];
  /** How far the parts reach from the centre of mass, m (see `shapeRadius`). */
  readonly reach: number;
  readonly orientation: Quat;
}

/**
 * Whether a slug crosses a ship during a step, and where it first meets it. `from` and `to` are
 * the slug's position relative to the ship's centre of mass at the start and end of the step;
 * both move in straight lines through a step, so the slug's path relative to the ship is the
 * segment between them. Slugs move kilometres per step, so the whole segment is swept.
 */
export const sweepSlug = (target: Target, from: Vec3, to: Vec3): SlugHit | null => {
  const path = sub(to, from);
  const span = length(path);
  if (span === 0) return null;
  const direction = scale(path, 1 / span);
  // Quick rejection: the segment never comes within the ship's reach of its centre.
  const along = Math.min(span, Math.max(0, -dot(from, direction)));
  if (length(add(from, scale(direction, along))) > target.reach) return null;
  const { parts, orientation } = target;
  const toBody = conjugate(orientation);
  const start = rotate(toBody, from);
  const heading = rotate(toBody, direction);
  const hit = firstHit(parts, start, heading);
  if (!hit || hit.distance > span) return null;
  return {
    part: hit.part,
    point: add(start, scale(heading, hit.distance)),
    along: hit.distance / span,
  };
};

/** Whether a slug, at `relative` position and velocity to its target, has passed it for good. */
export const slugPassed = (
  relative: { readonly position: Vec3; readonly velocity: Vec3 },
  reach: number,
): boolean => dot(relative.position, relative.velocity) > 0 && length(relative.position) > reach;

/** The area of the hole a slug punches through armour, m². */
export const holeArea = (slugMass: number): number => {
  const diameter = Math.cbrt((6 * slugMass) / (Math.PI * SLUG_DENSITY));
  return Math.PI * ((HOLE_SCALE * diameter) / 2) ** 2;
};

/**
 * How deep a slug carrying `energy` J would punch into armour of a type, m: the energy over what
 * each metre of armour in its hole takes to punch through.
 */
export const penetrationDepth = (energy: number, slugMass: number, type: ArmourType): number =>
  energy / (ARMOUR[type].density * holeArea(slugMass) * ARMOUR[type].penetrationEnergy);
