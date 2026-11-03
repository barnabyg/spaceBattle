import { armourMass } from './armour';
import { componentSlots, integrityOfType } from './components';
import {
  designComponent,
  designComponents,
  designComponentsOfType,
  missileMass,
  SECTION_KINDS,
  type Design,
  type SectionKind,
} from './design';
import { BASE_TEMPERATURE, thermalLimit, thermalProperties } from './heat';
import { HULLS } from './hull';
import type { ManoeuvreState } from './manoeuvre';
import type { AttitudeOrder } from './orders';
import {
  DEFAULT_PRIORITIES,
  EMPTY_LEDGER,
  IDLE_FLOW,
  powerFlowOf,
  powerPlant,
  type EnergyLedger,
  type PowerFlow,
  type PowerSystem,
} from './power';
import { conjugate, integrate, rotate, type Quat } from './quaternion';
import { NO_COOLANT_LOAD, shieldDemand, type CoolantLoad } from './shields';
import { TIME_STEP } from './time';
import { add, cross, dot, length, scale, sub, vec3, ZERO, type Vec3 } from './vector';
import {
  initialAmmunition,
  initialWeapons,
  type MagazineState,
  type WeaponsState,
} from './weapons';

/** The ship's long axis in its own body frame: the drive pushes along it. */
export const NOSE: Vec3 = vec3(1, 0, 0);
/** The axis a ship turns about when asked to reverse its heading exactly. */
const REVERSE_AXIS: Vec3 = vec3(0, 0, 1);
/** Fraction of the thrusters' best braking rate the autopilot plans turns with. */
const TURN_MARGIN = 0.8;
/** Heading errors below this are closed proportionally rather than bang-bang, per second. */
const TURN_GAIN = 0.5;

export interface BurnState {
  readonly throttle: number;
  /** Seconds of burn left. */
  readonly remaining: number;
}

/** A section's own state: its armour and structure, and what a beam inside it bores into. */
export interface SectionState {
  /** Armour thickness left, m. */
  readonly armour: number;
  /** Integrity of the section's own structure (0–1); at zero the section has failed. */
  readonly structure: number;
  /** The component slot a beam through the armour is boring into, if any. */
  readonly struck: number | null;
}

/** A single built ship and its changing state. */
export interface ShipState {
  readonly design: Design;
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  /** Body frame, rad/s. */
  angularVelocity: Vec3;
  /** The drive's acceleration over the last step, world frame, m/s². */
  acceleration: Vec3;
  propellantMass: number;
  attitude: AttitudeOrder | null;
  burn: BurnState | null;
  /** A standing manoeuvre order; while it is set the autopilot owns attitude and drive. */
  manoeuvre: ManoeuvreState | null;
  /** When the ship was ordered to withdraw, s; null unless it is withdrawing. */
  withdrawingSince: number | null;
  /** What the ship applied during the last step. */
  thrust: number;
  torque: Vec3;
  /** The drive's electrical energy in the last step: what its throttle asked for and used, J. */
  driveEnergy: { readonly wanted: number; readonly used: number };
  /** The captain's power order: every power system, highest priority first. */
  priorities: readonly PowerSystem[];
  /** Energy held in the capacitors, J. */
  storedEnergy: number;
  /** Heat held in the ship, J: its heat capacity times its temperature. */
  heat: number;
  radiatorsDeployed: boolean;
  /** Whether the captain has the shields raised, so they draw power and work. */
  shieldsRaised: boolean;
  /** Laser power each section's coolant shields are carrying in this step, W. */
  coolantLoad: CoolantLoad;
  /** How power and heat flowed in the last step. */
  powerFlow: PowerFlow;
  /** W; `absorbed` is laser heat the coolant shields carried into the ship. */
  heatFlow: {
    readonly generated: number;
    readonly radiated: number;
    readonly absorbed: number;
  };
  ledger: EnergyLedger;
  /** Each component's integrity (0–1), in the order of `componentSlots`. */
  integrity: readonly number[];
  sections: Record<SectionKind, SectionState>;
  weapons: WeaponsState;
  /** The ammunition left in each magazine. */
  ammunition: readonly MagazineState[];
  /** Mass of the ammunition fired or launched from each section's magazines so far, kg. */
  ammunitionSpent: AmmunitionSpent;
}

/**
 * Mass of ammunition gone from each section's magazines, kg. A design's mass counts its
 * magazines full, so the ship is lighter by this; with its propellant it sets the centre of mass.
 */
export type AmmunitionSpent = Readonly<Record<SectionKind, number>>;

export const NO_AMMUNITION_SPENT: AmmunitionSpent = { forward: 0, middle: 0, engine: 0 };

/** Mass, centre of mass and principal moments of inertia (body axes), from hull and contents. */
export interface MassProperties {
  readonly mass: number;
  readonly dryMass: number;
  /** How far the centre of mass lies behind the nose, m. */
  readonly centreOfMass: number;
  readonly inertia: Vec3;
}

interface CachedMassProperties {
  readonly propellantMass: number;
  readonly spent: AmmunitionSpent;
  readonly result: MassProperties;
}

/**
 * The last results for each design, newest first: a ship asks many times per step at the same
 * load, and two ships of the same design take turns asking.
 */
const lastMassProperties = new WeakMap<Design, readonly CachedMassProperties[]>();
/** How many recent results each design keeps. */
const MASS_PROPERTIES_KEPT = 2;

const sameSpent = (a: AmmunitionSpent, b: AmmunitionSpent): boolean =>
  a === b || SECTION_KINDS.every((kind) => a[kind] === b[kind]);

/**
 * A design's mass properties carrying `propellantMass` and its magazines less `spent`. The dry
 * mass includes whatever ammunition is left.
 */
export const massProperties = (
  design: Design,
  propellantMass: number,
  spent: AmmunitionSpent = NO_AMMUNITION_SPENT,
): MassProperties => {
  const kept = lastMassProperties.get(design) ?? [];
  const hit = kept.find(
    (last) => last.propellantMass === propellantMass && sameSpent(last.spent, spent),
  );
  if (hit) return hit.result;
  const result = computeMassProperties(design, propellantMass, spent);
  lastMassProperties.set(design, [
    { propellantMass, spent, result },
    ...kept.slice(0, MASS_PROPERTIES_KEPT - 1),
  ]);
  return result;
};

/** A ship's mass properties now, with the propellant and ammunition it has left. */
export const shipMassProperties = (ship: ShipState): MassProperties =>
  massProperties(ship.design, ship.propellantMass, ship.ammunitionSpent);

/** A design's hull section volumes and what each section holds before propellant and spending. */
const loadOf = new WeakMap<
  Design,
  { readonly volumes: readonly number[]; readonly contents: ReadonlyMap<SectionKind, number> }
>();

const designLoad = (design: Design) => {
  const cached = loadOf.get(design);
  if (cached) return cached;
  const volumes = HULLS[design.hullSize].sections.map((s) => s.length * s.width * s.height);
  const contents = new Map<SectionKind, number>();
  for (const { component, section } of designComponents(design)) {
    contents.set(section, (contents.get(section) ?? 0) + component.mass);
  }
  for (const section of design.sections) {
    contents.set(section.kind, (contents.get(section.kind) ?? 0) + armourMass(design, section));
  }
  const load = { volumes, contents };
  loadOf.set(design, load);
  return load;
};

const computeMassProperties = (
  design: Design,
  propellantMass: number,
  spent: AmmunitionSpent,
): MassProperties => {
  const hull = HULLS[design.hullSize];
  const { volumes, contents: designContents } = designLoad(design);
  const totalVolume = volumes.reduce((a, b) => a + b, 0);
  const contents = new Map<SectionKind, number>();
  for (const kind of SECTION_KINDS) {
    contents.set(kind, (designContents.get(kind) ?? 0) - spent[kind]);
  }
  // Propellant tanks sit in the middle section.
  contents.set('middle', (contents.get('middle') ?? 0) + propellantMass);

  let offset = 0;
  const parts = hull.sections.map((shape, i) => {
    const centre = -(offset + shape.length / 2);
    offset += shape.length;
    const mass =
      (hull.structureMass * (volumes[i] ?? 0)) / totalVolume + (contents.get(shape.kind) ?? 0);
    return { shape, centre, mass };
  });
  const mass = parts.reduce((total, p) => total + p.mass, 0);
  const centreOfMass = parts.reduce((total, p) => total + p.mass * p.centre, 0) / mass;
  let ixx = 0;
  let iyy = 0;
  let izz = 0;
  for (const { shape, centre, mass: m } of parts) {
    const d2 = (centre - centreOfMass) ** 2;
    ixx += (m * (shape.width ** 2 + shape.height ** 2)) / 12;
    iyy += (m * (shape.length ** 2 + shape.height ** 2)) / 12 + m * d2;
    izz += (m * (shape.length ** 2 + shape.width ** 2)) / 12 + m * d2;
  }
  return {
    mass,
    dryMass: mass - propellantMass,
    centreOfMass: -centreOfMass,
    inertia: vec3(ixx, iyy, izz),
  };
};

/**
 * What a ship carries from one battle to the next: its damage, the propellant it has left and the
 * ammunition in its magazines. Heat and stored energy are not carried: between battles the ship
 * cools and its capacitors charge.
 */
export interface ShipCondition {
  /** Each component's integrity (0–1), in the order of `componentSlots`. */
  readonly integrity: readonly number[];
  /** Each section's armour thickness left, m, and its structure's integrity (0–1). */
  readonly sections: Readonly<
    Record<SectionKind, { readonly armour: number; readonly structure: number }>
  >;
  /** kg */
  readonly propellantMass: number;
  /** The ammunition left in each of the design's magazines, in the order of its slots. */
  readonly magazines: readonly {
    readonly slugs: number;
    readonly rounds: number;
    readonly missiles: number;
  }[];
}

/** A ship of a design as built: undamaged, with full tanks and magazines. */
export const fullCondition = (design: Design): ShipCondition => ({
  integrity: componentSlots(design).map(() => 1),
  sections: Object.fromEntries(
    SECTION_KINDS.map((kind) => [
      kind,
      { armour: design.sections.find((s) => s.kind === kind)?.armour.thickness ?? 0, structure: 1 },
    ]),
  ) as ShipCondition['sections'],
  propellantMass: design.propellantMass,
  magazines: designComponentsOfType(design, 'magazine').map(({ slugs, rounds, missiles }) => ({
    slugs,
    rounds,
    missiles,
  })),
});

/** A ship's condition now. */
export const conditionOf = (ship: ShipState): ShipCondition => ({
  integrity: ship.integrity,
  sections: Object.fromEntries(
    SECTION_KINDS.map((kind) => [
      kind,
      { armour: ship.sections[kind].armour, structure: ship.sections[kind].structure },
    ]),
  ) as ShipCondition['sections'],
  propellantMass: ship.propellantMass,
  magazines: ship.ammunition.map(({ slugs, rounds, missiles }) => ({ slugs, rounds, missiles })),
});

/**
 * Whether a value is a number from `low` to `high`. A condition may come from a file, where a
 * number written as text would pass the comparisons alone.
 */
const isBetween = (value: unknown, low: number, high: number): boolean =>
  typeof value === 'number' && value >= low && value <= high;

/** Throws unless `condition` fits a ship of `design`. */
const checkCondition = (design: Design, condition: ShipCondition): void => {
  const full = fullCondition(design);
  const fits =
    condition.integrity.length === full.integrity.length &&
    condition.integrity.every((value) => isBetween(value, 0, 1)) &&
    SECTION_KINDS.every((kind) => {
      const section = condition.sections[kind];
      return (
        isBetween(section.armour, 0, full.sections[kind].armour) &&
        isBetween(section.structure, 0, 1)
      );
    }) &&
    isBetween(condition.propellantMass, 0, design.propellantMass) &&
    condition.magazines.length === full.magazines.length &&
    condition.magazines.every((held, i) => {
      const most = full.magazines[i];
      return (
        most !== undefined &&
        [held.slugs, held.rounds, held.missiles].every((n) => Number.isInteger(n) && n >= 0) &&
        held.slugs <= most.slugs &&
        held.rounds <= most.rounds &&
        held.missiles <= most.missiles
      );
    });
  if (!fits) throw new Error(`A ship's condition does not fit its design "${design.id}"`);
};

/**
 * Mass of the ammunition gone from each section's magazines when they hold `magazines`, kg: a
 * slug or round weighs as much as the heaviest any of the design's guns fires.
 */
const spentFrom = (design: Design, magazines: ShipCondition['magazines']): AmmunitionSpent => {
  const slug = Math.max(0, ...designComponentsOfType(design, 'kinetic-gun').map((g) => g.slugMass));
  const round = Math.max(
    0,
    ...designComponentsOfType(design, 'point-defence').map((g) => g.roundMass),
  );
  const spent = { ...NO_AMMUNITION_SPENT };
  initialAmmunition(design).forEach((full, i) => {
    const held = magazines[i];
    const section = componentSlots(design)[full.slot]?.section;
    if (!held || !section) return;
    spent[section] +=
      (full.slugs - held.slugs) * slug +
      (full.rounds - held.rounds) * round +
      (full.missile ? (full.missiles - held.missiles) * missileMass(full.missile) : 0);
  });
  return spent;
};

/**
 * A ship of a design at a place and motion, in `condition`: as built, if left out, or as the
 * last battle left it.
 */
export const createShip = (
  design: Design,
  position: Vec3,
  velocity: Vec3,
  orientation: Quat,
  condition?: ShipCondition,
): ShipState => {
  if (condition) checkCondition(design, condition);
  const ship = createFreshShip(design, position, velocity, orientation);
  if (!condition) return ship;
  return {
    ...ship,
    propellantMass: condition.propellantMass,
    integrity: [...condition.integrity],
    sections: Object.fromEntries(
      SECTION_KINDS.map((kind) => [kind, { ...condition.sections[kind], struck: null }]),
    ) as Record<SectionKind, SectionState>,
    ammunition: ship.ammunition.map((full, i) => ({ ...full, ...condition.magazines[i] })),
    ammunitionSpent: spentFrom(design, condition.magazines),
  };
};

const createFreshShip = (
  design: Design,
  position: Vec3,
  velocity: Vec3,
  orientation: Quat,
): ShipState => ({
  design,
  position,
  velocity,
  orientation,
  angularVelocity: ZERO,
  acceleration: ZERO,
  propellantMass: design.propellantMass,
  attitude: null,
  burn: null,
  manoeuvre: null,
  withdrawingSince: null,
  thrust: 0,
  torque: ZERO,
  driveEnergy: { wanted: 0, used: 0 },
  priorities: DEFAULT_PRIORITIES,
  storedEnergy: powerPlant(design).storageCapacity,
  heat: thermalProperties(design).heatCapacity * BASE_TEMPERATURE,
  radiatorsDeployed: false,
  shieldsRaised: true,
  coolantLoad: NO_COOLANT_LOAD,
  powerFlow: IDLE_FLOW,
  heatFlow: { generated: 0, radiated: 0, absorbed: 0 },
  ledger: EMPTY_LEDGER,
  integrity: componentSlots(design).map(() => 1),
  sections: Object.fromEntries(
    SECTION_KINDS.map((kind) => [
      kind,
      {
        armour: design.sections.find((s) => s.kind === kind)?.armour.thickness ?? 0,
        structure: 1,
        struck: null,
      },
    ]),
  ) as Record<SectionKind, SectionState>,
  weapons: initialWeapons(design),
  ammunition: initialAmmunition(design),
  ammunitionSpent: NO_AMMUNITION_SPENT,
});

/** K */
export const temperatureOf = (ship: ShipState): number =>
  ship.heat / thermalProperties(ship.design).heatCapacity;

/**
 * The fraction of the drive's full thrust it can use now: no more than its integrity and the
 * ship's temperature allow, nor than the power left for it after higher priorities.
 */
export const driveLimit = (ship: ShipState): number => {
  const { power } = designComponent(ship.design, 'drive');
  const integrity = integrityOfType(ship.design, ship.integrity, 'drive');
  const flow = powerFlowOf(
    ship,
    { drive: power * integrity, shields: shieldDemand(ship), weapons: ship.weapons.demand },
    TIME_STEP,
  );
  return Math.min(
    integrity,
    thermalLimit(temperatureOf(ship)),
    flow.systems.drive.supplied / power,
  );
};

/** The largest torque the thrusters can apply now, by their integrity, N·m. */
export const thrusterTorque = (ship: ShipState): number =>
  designComponent(ship.design, 'thrusters').torque *
  integrityOfType(ship.design, ship.integrity, 'thrusters');

export const noseOf = (ship: ShipState): Vec3 => rotate(ship.orientation, NOSE);

/** Delta-v the ship can still achieve with its remaining propellant, m/s. */
export const deltaVOf = (ship: ShipState): number => {
  const { mass, dryMass } = shipMassProperties(ship);
  return designComponent(ship.design, 'drive').exhaustVelocity * Math.log(mass / dryMass);
};

/** The ship warns once its delta-v left is within this many times its reserve. */
export const RESERVE_WARNING = 1.5;

/** Whether a ship's delta-v left is coming down towards its reserve: within `RESERVE_WARNING`. */
export const reserveWarning = (ship: ShipState): boolean =>
  deltaVOf(ship) <= RESERVE_WARNING * ship.design.reserve;

/** Delta-v of a design carrying `propellantMass` (its full load by default), m/s. */
export const deltaVWith = (design: Design, propellantMass = design.propellantMass): number => {
  const { mass, dryMass } = massProperties(design, propellantMass);
  // Tsiolkovsky: Δv = vₑ · ln(m₀ / m_dry).
  return designComponent(design, 'drive').exhaustVelocity * Math.log(mass / dryMass);
};

/** The most thrust the drive can give now, within the limits of power and heat, N. */
export const availableThrust = (ship: ShipState): number =>
  designComponent(ship.design, 'drive').thrust * driveLimit(ship);

/** Angular acceleration about the slowest pitch/yaw axis at full thruster torque, rad/s². */
export const turnAcceleration = (ship: ShipState): number => {
  const { inertia } = shipMassProperties(ship);
  return thrusterTorque(ship) / Math.max(inertia.y, inertia.z);
};

/**
 * Roughly how long the autopilot takes to turn the nose through `angle` radians from rest and
 * stop: accelerate then brake (θ = αt²/4) at the planning margin, plus the proportional tail.
 */
export const turnTime = (ship: ShipState, angle: number): number =>
  (2 * Math.sqrt(angle / turnAcceleration(ship))) / TURN_MARGIN + 1 / TURN_GAIN;

const mul = (a: Vec3, b: Vec3): Vec3 => vec3(a.x * b.x, a.y * b.y, a.z * b.z);

/** The body-frame angular velocity that brings the nose round to `target` (world, unit). */
const desiredAngularVelocity = (ship: ShipState, target: Vec3, turnRate: number): Vec3 => {
  const bodyTarget = rotate(conjugate(ship.orientation), target);
  const axisLength = length(cross(NOSE, bodyTarget));
  const angle = Math.atan2(axisLength, dot(NOSE, bodyTarget));
  if (angle < 1e-6) return ZERO;
  const axis = axisLength < 1e-9 ? REVERSE_AXIS : scale(cross(NOSE, bodyTarget), 1 / axisLength);
  const speed = Math.min(TURN_MARGIN * Math.sqrt(2 * turnRate * angle), TURN_GAIN * angle);
  return scale(axis, speed);
};

/** Turns the ship's nose towards `target` (or holds it still) within the thrusters' torque. */
export const steer = (ship: ShipState, target: Vec3 | null, dt: number): void => {
  const { inertia } = shipMassProperties(ship);
  const maxTorque = thrusterTorque(ship);
  // Plan with the slowest pitch/yaw axis so the turn can always be stopped in time.
  const turnRate = turnAcceleration(ship);
  const desired = target ? desiredAngularVelocity(ship, target, turnRate) : ZERO;
  const w = ship.angularVelocity;
  const gyroscopic = cross(w, mul(inertia, w));
  let torque = add(mul(inertia, scale(sub(desired, w), 1 / dt)), gyroscopic);
  const magnitude = length(torque);
  if (magnitude > maxTorque) torque = scale(torque, maxTorque / magnitude);
  ship.torque = torque;
  // Euler's equations for a rigid body with principal axes along the body axes.
  const acceleration = sub(torque, gyroscopic);
  ship.angularVelocity = add(
    w,
    scale(
      vec3(acceleration.x / inertia.x, acceleration.y / inertia.y, acceleration.z / inertia.z),
      dt,
    ),
  );
  ship.orientation = integrate(ship.orientation, ship.angularVelocity, dt);
};

/** Fires the drive for this step if a burn is ordered, spending propellant by the rocket equation. */
export const burn = (ship: ShipState, dt: number): void => {
  const order = ship.burn;
  if (!order) {
    fireDrive(ship, 0, dt);
    return;
  }
  const burnTime = Math.min(dt, order.remaining);
  const remaining = order.remaining - burnTime;
  // Treat rounding crumbs as done so a burn ends on the step it was due to.
  ship.burn = remaining > 1e-9 ? { ...order, remaining } : null;
  fireDrive(ship, order.throttle, burnTime);
};

/**
 * Pushes along the nose at `throttle` (0–1 of full thrust) for `burnTime` seconds, as far as
 * power, heat and propellant allow. The drive draws power in proportion to its thrust.
 */
export const fireDrive = (ship: ShipState, throttle: number, burnTime: number): void => {
  ship.thrust = 0;
  const drive = designComponent(ship.design, 'drive');
  const ordered = Math.min(Math.max(throttle, 0), 1);
  ship.driveEnergy = { wanted: ordered * drive.power * Math.max(burnTime, 0), used: 0 };
  if (ordered <= 0 || burnTime <= 0 || ship.propellantMass <= 0) return;
  const force = Math.min(ordered * drive.thrust, availableThrust(ship));
  if (force <= 0) return;
  const wanted = (force / drive.exhaustVelocity) * burnTime;
  const used = Math.min(wanted, ship.propellantMass);
  const { mass } = shipMassProperties(ship);
  const deltaV = drive.exhaustVelocity * Math.log(mass / (mass - used));
  ship.propellantMass = used === ship.propellantMass ? 0 : ship.propellantMass - used;
  ship.velocity = add(ship.velocity, scale(noseOf(ship), deltaV));
  ship.thrust = (force * used) / wanted;
  ship.driveEnergy = {
    ...ship.driveEnergy,
    used: ((drive.power * ship.thrust) / drive.thrust) * burnTime,
  };
};
