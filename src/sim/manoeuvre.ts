import { designComponent } from './design';
import type { ManoeuvreGoal, ManoeuvreOrder } from './orders';
import {
  availableThrust,
  deltaVOf,
  massProperties,
  noseOf,
  turnTime,
  type ShipState,
} from './ship';
import { dot, length, normalize, scale, sub, ZERO, type Vec3 } from './vector';

/** Fraction of the drive's acceleration the autopilot plans to brake with, leaving slack. */
const BRAKING_MARGIN = 0.5;
/** The fastest the autopilot closes or opens the range, as a fraction of the delta-v left. */
const CRUISE_FRACTION = 0.1;
/** Within this of the ordered range the autopilot only stops relative motion, m. */
const RANGE_TOLERANCE = 1_000;
/** A velocity error larger than this starts a correction, m/s. */
const START_ERROR = 1;
/** A correction ends once the velocity error is below this, m/s; the gap stops chatter. */
const STOP_ERROR = 0.05;
/** The drive fires only while the nose is within this angle of the wanted velocity change. */
const BURN_ANGLE = (3 * Math.PI) / 180;
/** The throttle closes the velocity error along the nose over at least this time, s. */
const THROTTLE_TIME = 2;

export type ActiveManoeuvreOrder = Exclude<ManoeuvreOrder, { readonly goal: 'none' }>;

/** A ship's standing manoeuvre order and whether it is correcting a velocity error. */
export interface ManoeuvreState {
  readonly order: ActiveManoeuvreOrder;
  readonly correcting: boolean;
}

/** What the autopilot knows of the enemy: the contact's position and velocity. */
export interface ManoeuvreTarget {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** A burn the autopilot expects to make, assuming the enemy drifts. */
export interface PlannedBurn {
  /** Seconds from now. */
  readonly start: number;
  /** s */
  readonly duration: number;
  /** World unit vector the drive will push along. */
  readonly direction: Vec3;
  /** A fraction of the drive's full thrust. */
  readonly throttle: number;
}

/** Turning towards the wanted velocity change, burning, or coasting with nothing to correct. */
export type ManoeuvrePhase = 'turning' | 'burning' | 'coasting';

export interface ManoeuvreObservation {
  readonly goal: ManoeuvreGoal;
  /** The ordered separation, m; null for match velocity. */
  readonly range: number | null;
  /** Separation minus the ordered range, m (positive when too far); null without a range. */
  readonly rangeError: number | null;
  /** The velocity change the autopilot still wants, world frame, m/s. */
  readonly velocityError: Vec3;
  readonly phase: ManoeuvrePhase;
  /** In order, starting with the next or current burn. */
  readonly plannedBurns: readonly PlannedBurn[];
}

/** What the autopilot does this step: where to point the nose and whether it is correcting. */
export interface ManoeuvreCommand {
  readonly heading: Vec3 | null;
  readonly velocityError: Vec3;
  readonly correcting: boolean;
}

interface Guidance {
  readonly rangeError: number | null;
  /** The planned rate of change of separation, m/s. */
  readonly rangeRate: number;
  /** Unit vector from the enemy to the own ship. */
  readonly outward: Vec3;
  readonly velocityError: Vec3;
}

const accelerationOf = (ship: ShipState): number =>
  availableThrust(ship) / massProperties(ship.design, ship.propellantMass).mass;

/** The throttle (a fraction of full thrust) that gives all the thrust power and heat allow. */
const fullAvailableThrottle = (ship: ShipState): number =>
  availableThrust(ship) / designComponent(ship.design, 'drive').thrust;

/**
 * The speed towards the ordered range from which the ship can still stop on arrival: it coasts
 * while it flips round (v·t) and then brakes (v²/2a), so v = a(√(t² + 2d/a) − t). Capped at a
 * cruise speed that keeps most of the delta-v for later.
 */
const approachSpeed = (ship: ShipState, distance: number): number => {
  const a = BRAKING_MARGIN * accelerationOf(ship);
  if (!(a > 0)) return 0;
  const t = turnTime(ship, Math.PI);
  // A ship that cannot turn cannot plan to stop.
  if (!Number.isFinite(t)) return 0;
  const stoppable = a * (Math.sqrt(t * t + (2 * distance) / a) - t);
  return Math.min(stoppable, CRUISE_FRACTION * deltaVOf(ship));
};

/** The relative velocity the goal wants (along the line of sight, nothing across it) and the gap. */
const guidance = (
  ship: ShipState,
  order: ActiveManoeuvreOrder,
  target: ManoeuvreTarget,
): Guidance => {
  const offset = sub(ship.position, target.position);
  const outward = normalize(offset);
  const relative = sub(ship.velocity, target.velocity);
  let rangeError: number | null = null;
  let rangeRate = 0;
  if (order.goal !== 'match-velocity') {
    rangeError = length(offset) - order.range;
    const speed = approachSpeed(ship, Math.max(0, Math.abs(rangeError) - RANGE_TOLERANCE));
    if (rangeError > 0 && order.goal !== 'open') rangeRate = -speed;
    if (rangeError < 0 && order.goal !== 'close') rangeRate = speed;
  }
  return {
    rangeError,
    rangeRate,
    outward,
    velocityError: sub(scale(outward, rangeRate), relative),
  };
};

/** Hysteresis: start correcting above one error, stop below a smaller one. */
const isCorrecting = (state: ManoeuvreState, velocityError: Vec3): boolean =>
  length(velocityError) > (state.correcting ? STOP_ERROR : START_ERROR);

const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))));

/** Where the autopilot points the nose this step; it holds still when there is nothing to do. */
export const manoeuvreCommand = (
  ship: ShipState,
  state: ManoeuvreState,
  target: ManoeuvreTarget | null,
): ManoeuvreCommand => {
  if (!target) return { heading: null, velocityError: ZERO, correcting: false };
  const { velocityError } = guidance(ship, state.order, target);
  const correcting = isCorrecting(state, velocityError);
  return { heading: correcting ? normalize(velocityError) : null, velocityError, correcting };
};

/**
 * The throttle for this step (a fraction of full thrust), once the ship has turned: zero unless
 * the nose is close to the wanted velocity change, and never more than closes the error along
 * the nose or than power and heat allow.
 */
export const manoeuvreThrottle = (ship: ShipState, command: ManoeuvreCommand, dt: number) => {
  if (!command.correcting) return 0;
  const along = dot(command.velocityError, noseOf(ship));
  if (along <= length(command.velocityError) * Math.cos(BURN_ANGLE)) return 0;
  const { mass } = massProperties(ship.design, ship.propellantMass);
  const wanted = (along * mass) / Math.max(THROTTLE_TIME, dt);
  return Math.min(availableThrust(ship), wanted) / designComponent(ship.design, 'drive').thrust;
};

/**
 * The burns the autopilot expects to make if the enemy drifts: one to correct the velocity
 * error now, and for a range goal, one to brake on arrival after coasting.
 */
const planBurns = (ship: ShipState, plan: Guidance, correcting: boolean): PlannedBurn[] => {
  const a = accelerationOf(ship);
  if (!(a > 0) || !Number.isFinite(turnTime(ship, Math.PI))) return [];
  const burns: PlannedBurn[] = [];
  const throttle = fullAvailableThrottle(ship);
  let pointing = noseOf(ship);
  let time = 0;
  const error = length(plan.velocityError);
  if (correcting) {
    const direction = normalize(plan.velocityError);
    const angle = angleBetween(pointing, direction);
    const start = angle < BURN_ANGLE ? 0 : turnTime(ship, angle);
    burns.push({ start, duration: error / a, direction, throttle });
    pointing = direction;
    time = start + error / a;
  }
  if (plan.rangeError !== null && plan.rangeRate !== 0) {
    const speed = Math.abs(plan.rangeRate);
    const brakeAcceleration = BRAKING_MARGIN * a;
    const flip = turnTime(ship, Math.PI);
    const stopping = speed * flip + speed ** 2 / (2 * brakeAcceleration);
    const coast = Math.max(0, (Math.abs(plan.rangeError) - stopping) / speed);
    const direction = scale(plan.outward, -Math.sign(plan.rangeRate));
    const angle = angleBetween(pointing, direction);
    burns.push({
      start: time + coast + (angle < BURN_ANGLE ? 0 : turnTime(ship, angle)),
      duration: speed / brakeAcceleration,
      direction,
      throttle: BRAKING_MARGIN * throttle,
    });
  }
  return burns;
};

/** The active goal, how far off it the ship is and the burns planned to reach it. */
export const observeManoeuvre = (
  ship: ShipState,
  state: ManoeuvreState,
  target: ManoeuvreTarget | null,
): ManoeuvreObservation => {
  const range = state.order.goal === 'match-velocity' ? null : state.order.range;
  if (!target) {
    return {
      goal: state.order.goal,
      range,
      rangeError: null,
      velocityError: ZERO,
      phase: 'coasting',
      plannedBurns: [],
    };
  }
  const plan = guidance(ship, state.order, target);
  const correcting = isCorrecting(state, plan.velocityError);
  const aligned = angleBetween(noseOf(ship), plan.velocityError) < BURN_ANGLE;
  return {
    goal: state.order.goal,
    range,
    rangeError: plan.rangeError,
    velocityError: plan.velocityError,
    phase: !correcting ? 'coasting' : aligned ? 'burning' : 'turning',
    plannedBurns: planBurns(ship, plan, correcting),
  };
};
