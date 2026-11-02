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

/** A missile in flight. */
export interface Missile {
  /** Unique among the battle's munitions. */
  readonly id: number;
  readonly attacker: SideId;
  readonly target: SideId;
  readonly design: MissileDesign;
  /** kg */
  readonly propellantMass: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Drive thrust applied in the last step, N. */
  readonly thrust: number;
}

/** A missile's mass now, with the propellant it has left, kg. */
export const missileMassNow = (missile: Missile): number =>
  missile.design.dryMass + missile.propellantMass;

/** Delta-v of a missile design carrying `propellantMass` (a full load by default), m/s. */
export const missileDeltaV = (
  design: MissileDesign,
  propellantMass: number = design.propellantMass,
): number => design.exhaustVelocity * Math.log((design.dryMass + propellantMass) / design.dryMass);

/**
 * How far a missile design reaches, m: the speed its boost builds up (its delta-v down to the
 * guidance reserve), held for `MISSILE_REACH_TIME`.
 */
export const missileReach = (design: MissileDesign): number =>
  (1 - GUIDANCE_RESERVE) * missileDeltaV(design) * MISSILE_REACH_TIME;

/** A missile leaving a ship: it starts where the ship is, moving with it, with full propellant. */
export const launchMissile = (
  id: number,
  attacker: SideId,
  target: SideId,
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
  if (!target || missile.propellantMass <= 0) return { ...missile, thrust: 0 };
  const wanted = guidance(missile, target, design.thrust / mass);
  const force = Math.min(design.thrust, length(wanted) * mass);
  if (!(force > 0)) return { ...missile, thrust: 0 };
  const burn = (force / design.exhaustVelocity) * dt;
  const used = Math.min(burn, missile.propellantMass);
  const deltaV = design.exhaustVelocity * Math.log(mass / (mass - used));
  return {
    ...missile,
    propellantMass: used === missile.propellantMass ? 0 : missile.propellantMass - used,
    velocity: add(missile.velocity, scale(wanted, deltaV / length(wanted))),
    thrust: (force * used) / burn,
  };
};
