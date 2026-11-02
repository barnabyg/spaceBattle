import type { SideId } from './battle';
import type { MissileDesign, PointDefenceDesign } from './design';
import type { FiringSolution, Motion } from './kinetic';
import { missileSilhouette } from './missile';
import { add, dot, length, normalize, scale, sub } from './vector';

/**
 * Fire control looses no burst whose rounds would fly longer than this to meet their target, s:
 * beyond it the rounds have spread too far to matter and the target has too long to move.
 */
export const POINT_DEFENCE_FLIGHT_TIME = 5;
/**
 * How far behind a target crossing the line of fire the aim lags, s: the time from fire control
 * measuring the target's motion to the rounds leaving the muzzle.
 */
export const TRACKING_LAG = 1e-3;
/**
 * The share of the distance a target's acceleration moves it during the rounds' flight that fire
 * control fails to predict. It leads the acceleration it sees, but a missile's guidance keeps
 * changing it; a missile coasting with its drive off flies a path it can predict exactly.
 */
export const PREDICTION_ERROR = 0.25;

/** Electrical energy one burst takes: its rounds' ½mv² over the gun's efficiency, J. */
export const burstEnergy = (gun: PointDefenceDesign): number =>
  (gun.roundsPerBurst * 0.5 * gun.roundMass * gun.muzzleVelocity ** 2) / gun.efficiency;

/** Electrical power a gun draws at full integrity while it fires at its burst rate, W. */
export const pointDefencePower = (gun: PointDefenceDesign): number =>
  burstEnergy(gun) * gun.burstRate;

/** How far a gun's rounds reach: as far as they fly in the longest flight allowed, m. */
export const pointDefenceRange = (gun: PointDefenceDesign): number =>
  gun.muzzleVelocity * POINT_DEFENCE_FLIGHT_TIME;

/** An enemy missile in flight, as point defence sees it at the start of a step. */
export interface Threat {
  /** Its id among the munitions in flight. */
  readonly id: number;
  readonly design: MissileDesign;
  readonly motion: Motion;
}

/** What a point defence gun is firing on: a missile in flight, or an enemy ship. */
export type PointDefenceEngagement =
  | { readonly kind: 'missile'; readonly munition: number }
  | { readonly kind: 'ship'; readonly side: SideId };

/** How many times fire control samples the flight allowed to find where its rounds first meet. */
const SOLUTION_SAMPLES = 50;
/** How many halvings fire control then makes to refine the flight time. */
const SOLUTION_HALVINGS = 30;

/**
 * Where a gun must fire to meet a target, if the meeting is near enough. Fire control leads the
 * target on its observed motion, holding its acceleration, as kinetic guns do (see
 * `firingSolution`); but a missile may close faster than the rounds fly, so it finds the first
 * flight time at which the rounds meet it by sampling the flight allowed and halving.
 */
export const pointDefenceSolution = (
  gun: PointDefenceDesign,
  shooter: Pick<Motion, 'position' | 'velocity'>,
  target: Motion,
  step: number,
): FiringSolution | null => {
  // Quick rejection: too far off to be met within the flight allowed, however it moves.
  const time = POINT_DEFENCE_FLIGHT_TIME;
  const furthest =
    (gun.muzzleVelocity + length(sub(target.velocity, shooter.velocity))) * time +
    0.5 * length(target.acceleration) * time * (time + step);
  if (length(sub(target.position, shooter.position)) > furthest) return null;
  const offset = sub(target.position, shooter.position);
  const drift = sub(target.velocity, shooter.velocity);
  // Ships and missiles move in fixed steps, velocity first (see `firingSolution`).
  const relative = (t: number) =>
    add(add(offset, scale(drift, t)), scale(target.acceleration, 0.5 * t * (t + step)));
  // How far the target will be beyond the rounds after a flight of t.
  const gap = (t: number) => length(relative(t)) - gun.muzzleVelocity * t;
  let early = 0;
  let late = -1;
  for (let i = 1; i <= SOLUTION_SAMPLES; i++) {
    const t = (time * i) / SOLUTION_SAMPLES;
    if (gap(t) <= 0) {
      late = t;
      break;
    }
    early = t;
  }
  if (late < 0) return null;
  for (let i = 0; i < SOLUTION_HALVINGS; i++) {
    const middle = (early + late) / 2;
    if (gap(middle) <= 0) late = middle;
    else early = middle;
  }
  const meeting = relative(late);
  return length(meeting) > 0 ? { direction: normalize(meeting), flightTime: late } : null;
};

/**
 * How widely a burst's rounds fall about the target, m: the radius of the disc they spread over
 * where they meet it. Three things add up (in quadrature): the gun's cone of fire over the rounds'
 * path; the aim lagging a target that crosses the line of fire (`TRACKING_LAG`); and the part of
 * the target's acceleration over the flight that fire control does not predict
 * (`PREDICTION_ERROR`).
 */
export const burstSpread = (
  gun: PointDefenceDesign,
  shooter: Pick<Motion, 'velocity'>,
  target: Motion,
  solution: FiringSolution,
): number => {
  const path = gun.muzzleVelocity * solution.flightTime;
  const drift = sub(target.velocity, shooter.velocity);
  const crossing = length(sub(drift, scale(solution.direction, dot(drift, solution.direction))));
  const unpredicted =
    PREDICTION_ERROR * 0.5 * length(target.acceleration) * solution.flightTime ** 2;
  return Math.hypot(gun.dispersion * path, crossing * TRACKING_LAG, unpredicted);
};

/**
 * The chance that a burst of `rounds` rounds brings down a missile. Its rounds land evenly over a
 * disc of radius `spread` about the missile, so each strikes it with the chance its silhouette,
 * `silhouette` m², covers of that disc. A single round at these speeds wrecks a missile.
 */
export const burstHitChance = (rounds: number, spread: number, silhouette: number): number => {
  const pattern = Math.PI * spread ** 2;
  const each = pattern > silhouette ? silhouette / pattern : 1;
  return 1 - (1 - each) ** rounds;
};

/** The chance a burst fired on a solution has of bringing a missile down. */
export const missileHitChance = (
  gun: PointDefenceDesign,
  rounds: number,
  shooter: Pick<Motion, 'velocity'>,
  threat: Threat,
  solution: FiringSolution,
): number => {
  // A missile flies nose first along its path, which points it along its velocity relative to
  // the ship it is closing on.
  const heading = sub(threat.motion.velocity, shooter.velocity);
  return burstHitChance(
    rounds,
    burstSpread(gun, shooter, threat.motion, solution),
    missileSilhouette(threat.design, heading, solution.direction),
  );
};

/** How soon a missile would reach the ship closing at its present speed, s; never if it is not. */
const timeToGo = (shooter: Pick<Motion, 'position' | 'velocity'>, threat: Threat): number => {
  const offset = sub(threat.motion.position, shooter.position);
  const closing = -dot(sub(threat.motion.velocity, shooter.velocity), offset) / length(offset);
  return closing > 0 ? length(offset) / closing : Infinity;
};

/**
 * What each point defence gun fires on this step. Missiles come first, the soonest to arrive
 * first: the guns able to fire take the missiles each can reach in turn, so a salvo is shared out
 * among them and two guns double up only once every missile in reach has one. A gun with no
 * missile in reach fires on `ship`, if given, when it can reach it. `guns` lists every gun, with
 * null for one that cannot fire; it gets null back.
 */
export const assignPointDefence = (
  shooter: Pick<Motion, 'position' | 'velocity'>,
  guns: readonly (PointDefenceDesign | null)[],
  threats: readonly Threat[],
  ship: { readonly id: SideId; readonly motion: Motion } | null,
  step: number,
): (PointDefenceEngagement | null)[] => {
  const urgent = threats
    .map((threat) => ({ threat, time: timeToGo(shooter, threat) }))
    .sort((a, b) => a.time - b.time || a.threat.id - b.threat.id)
    .map(({ threat }) => threat);
  let turn = 0;
  return guns.map((gun): PointDefenceEngagement | null => {
    if (!gun) return null;
    const reachable = urgent.filter((threat) =>
      pointDefenceSolution(gun, shooter, threat.motion, step),
    );
    const missile = reachable[turn % Math.max(1, reachable.length)];
    turn += 1;
    if (missile) return { kind: 'missile', munition: missile.id };
    if (ship && pointDefenceSolution(gun, shooter, ship.motion, step)) {
      return { kind: 'ship', side: ship.id };
    }
    return null;
  });
};
