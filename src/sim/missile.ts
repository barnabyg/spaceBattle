import type { SideId } from './battle';
import type { MissileDesign } from './design';
import type { Motion } from './kinetic';
import { add, dot, length, scale, sub, ZERO, type Vec3 } from './vector';

/**
 * Missiles spend their delta-v down to this fraction of a full load building up speed towards
 * the target, and keep the rest to steer onto it as it manoeuvres.
 */
export const GUIDANCE_RESERVE = 0.4;
/** The navigation constant of the missiles' proportional navigation. */
const NAVIGATION_CONSTANT = 3;
/**
 * A missile counts its reach as how far its boost carries it in this long, s: further out, a
 * target has too long to manoeuvre and the flight too long to matter.
 */
export const MISSILE_REACH_TIME = 3_600;
/** A missile's body is a cylinder this many times longer than it is wide. */
export const MISSILE_FINENESS = 8;
/** A missile's average density as launched, propellant and all, kg/m³. */
export const MISSILE_DENSITY = 1_000;

/**
 * What a missile is launched at: an enemy ship, by its side; or, for an anti-missile missile, an
 * enemy missile in flight, by its id among the munitions.
 */
export type MissileTarget = SideId | { readonly munition: number };

/** Whether a missile's target is another missile rather than a ship. */
export const targetsMissile = (target: MissileTarget): target is { readonly munition: number } =>
  typeof target !== 'string';

/** A missile in flight. */
export interface Missile {
  /** Unique among the battle's munitions. */
  readonly id: number;
  readonly attacker: SideId;
  readonly target: MissileTarget;
  readonly design: MissileDesign;
  /** kg */
  readonly propellantMass: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Drive thrust applied in the last step, N. */
  readonly thrust: number;
  /** Its drive's acceleration over the last step, m/s². */
  readonly acceleration: Vec3;
}

/**
 * The size of a missile design's body, a cylinder of its launch mass at `MISSILE_DENSITY` and
 * `MISSILE_FINENESS` times as long as it is wide, m. It keeps its size as it burns propellant.
 */
export const missileSize = (
  design: MissileDesign,
): { readonly length: number; readonly diameter: number } => {
  const volume = (design.dryMass + design.propellantMass) / MISSILE_DENSITY;
  // V = π/4 · D² · L with L = F·D.
  const diameter = Math.cbrt((4 * volume) / (Math.PI * MISSILE_FINENESS));
  return { length: MISSILE_FINENESS * diameter, diameter };
};

/**
 * How large a missile looks seen along a unit direction, m²: its end-on disc and its side-on
 * outline in proportion to how far the direction lies off its long axis, which points along
 * `axis` (any length).
 */
export const missileSilhouette = (design: MissileDesign, axis: Vec3, along: Vec3): number => {
  const { length: long, diameter } = missileSize(design);
  const size = length(axis);
  const cos = size > 0 ? Math.min(1, Math.abs(dot(axis, along)) / size) : 0;
  const sin = Math.sqrt(1 - cos ** 2);
  return Math.PI * (diameter / 2) ** 2 * cos + long * diameter * sin;
};

/** A missile's mass now, with the propellant it has left, kg. */
export const missileMassNow = (missile: Missile): number =>
  missile.design.dryMass + missile.propellantMass;

/** Delta-v of a missile design carrying `propellantMass` (a full load by default), m/s. */
export const missileDeltaV = (
  design: MissileDesign,
  propellantMass: number = design.propellantMass,
): number => design.exhaustVelocity * Math.log((design.dryMass + propellantMass) / design.dryMass);

/**
 * How far a missile with `deltaV` m/s left reaches, m: the speed its boost builds up (its delta-v
 * down to the guidance reserve), held for `MISSILE_REACH_TIME`.
 */
export const reachOfDeltaV = (deltaV: number): number =>
  (1 - GUIDANCE_RESERVE) * deltaV * MISSILE_REACH_TIME;

/** How far a missile design reaches with a full load of propellant, m (see `reachOfDeltaV`). */
export const missileReach = (design: MissileDesign): number => reachOfDeltaV(missileDeltaV(design));

/** A missile leaving a ship: it starts where the ship is, moving with it, with full propellant. */
export const launchMissile = (
  id: number,
  attacker: SideId,
  target: MissileTarget,
  design: MissileDesign,
  from: Pick<Motion, 'position' | 'velocity'>,
): Missile => ({
  id,
  attacker,
  target,
  design,
  propellantMass: design.propellantMass,
  position: from.position,
  velocity: from.velocity,
  thrust: 0,
  acceleration: ZERO,
});

/**
 * The acceleration a missile's guidance asks for this step, m/s², towards a target moving as
 * observed (holding its acceleration). Proportional navigation in its zero-effort-miss form:
 * accelerate across the line of sight by N·ZEM⊥/t², where ZEM is how far the missile would miss
 * if neither changed course from now and t the time to go. While it has delta-v to spare above
 * the guidance reserve, or is not closing at all, it also boosts along the line of sight with
 * whatever thrust the steering leaves. Never more than its drive gives.
 */
const guidance = (missile: Missile, target: Motion, maxAcceleration: number): Vec3 => {
  const offset = sub(target.position, missile.position);
  const range = length(offset);
  if (range === 0) return ZERO;
  const sight = scale(offset, 1 / range);
  const drift = sub(target.velocity, missile.velocity);
  const closing = -dot(drift, sight);
  const boosting =
    closing <= 0 ||
    missileDeltaV(missile.design, missile.propellantMass) >
      GUIDANCE_RESERVE * missileDeltaV(missile.design);
  // Time to go: closing at the present speed, or faster while boosting (d = v·t + ½·a·t²).
  const timeToGo = boosting
    ? (Math.sqrt(closing ** 2 + 2 * maxAcceleration * range) - closing) / maxAcceleration
    : range / closing;
  const miss = add(
    add(offset, scale(drift, timeToGo)),
    scale(target.acceleration, 0.5 * timeToGo ** 2),
  );
  const across = sub(miss, scale(sight, dot(miss, sight)));
  let steering = scale(across, NAVIGATION_CONSTANT / timeToGo ** 2);
  const steeringNeeded = length(steering);
  if (steeringNeeded > maxAcceleration) {
    steering = scale(steering, maxAcceleration / steeringNeeded);
  }
  if (!boosting) return steering;
  const along = Math.sqrt(Math.max(0, maxAcceleration ** 2 - length(steering) ** 2));
  return add(steering, scale(sight, along));
};

/**
 * Guides a missile through one step of `dt` seconds towards its target's observed motion, firing
 * its drive along the acceleration guidance asks for and spending propellant by the rocket
 * equation. Out of propellant, it coasts and can no longer change course. Moves only its velocity;
 * the battle moves it.
 */
export const guideMissile = (missile: Missile, target: Motion | null, dt: number): Missile => {
  const { design } = missile;
  const mass = missileMassNow(missile);
  if (!target || missile.propellantMass <= 0) {
    return { ...missile, thrust: 0, acceleration: ZERO };
  }
  const wanted = guidance(missile, target, design.thrust / mass);
  const force = Math.min(design.thrust, length(wanted) * mass);
  if (!(force > 0)) return { ...missile, thrust: 0, acceleration: ZERO };
  const burn = (force / design.exhaustVelocity) * dt;
  const used = Math.min(burn, missile.propellantMass);
  const deltaV = design.exhaustVelocity * Math.log(mass / (mass - used));
  const change = scale(wanted, deltaV / length(wanted));
  return {
    ...missile,
    propellantMass: used === missile.propellantMass ? 0 : missile.propellantMass - used,
    velocity: add(missile.velocity, change),
    thrust: (force * used) / burn,
    acceleration: scale(change, 1 / dt),
  };
};

/**
 * How far along a step's path a proximity fuse set to `distance` metres first finds itself that
 * close to a ship, as a fraction of the path (0–1), or null if it never does in the step. `from`
 * and `to` are the missile's positions relative to the ship's centre of mass at the start and end
 * of the step; both move in straight lines through a step, so the path between them is swept.
 */
export const fuseTrigger = (from: Vec3, to: Vec3, distance: number): number | null => {
  const offset = dot(from, from) - distance ** 2;
  if (offset <= 0) return 0;
  const path = sub(to, from);
  const a = dot(path, path);
  const b = 2 * dot(from, path);
  const discriminant = b ** 2 - 4 * a * offset;
  if (a === 0 || discriminant < 0) return null;
  const along = (-b - Math.sqrt(discriminant)) / (2 * a);
  return along >= 0 && along <= 1 ? along : null;
};
