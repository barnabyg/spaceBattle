import type { SideId } from './battle';
import { componentSlots } from './components';
import {
  designComponentsOfType,
  type Design,
  type KineticGunDesign,
  type LaserDesign,
} from './design';
import type { HitEvent } from './events';
import { thermalLimit, thermalProperties } from './heat';
import {
  firingSolution,
  kineticGunPower,
  kineticGunRange,
  shotEnergy,
  type Motion,
  type Slug,
} from './kinetic';
import type { FireMode } from './orders';
import { massProperties, type ShipState } from './ship';
import { TIME_STEP } from './time';
import { add, scale, sub, type Vec3 } from './vector';

/** m/s */
export const SPEED_OF_LIGHT = 299_792_458;
/**
 * Lasers hold fire beyond the range where their beam's intensity falls below this, W/m²: about a
 * thousand suns, which takes most of an hour to burn through a few centimetres of armour.
 */
export const USEFUL_INTENSITY = 1e6;

/** What sets the spread of a beam. */
type Optics = Pick<LaserDesign, 'aperture' | 'wavelength'>;

/**
 * Radius of a beam's spot at a range, m. Diffraction spreads it to the Airy disc's first dark
 * ring, 1.22·λ·R/D; up close it is never narrower than the mirror.
 */
export const spotRadius = (optics: Optics, range: number): number =>
  Math.max(optics.aperture / 2, (1.22 * optics.wavelength * range) / optics.aperture);

/** Intensity of a beam of `power` W over its spot at a range: P/(πr²), W/m². */
export const beamIntensity = (power: number, optics: Optics, range: number): number =>
  power / (Math.PI * spotRadius(optics, range) ** 2);

/** The range out to which the laser at full power keeps the useful intensity, m. */
export const effectiveRange = (laser: LaserDesign): number => {
  const radius = Math.sqrt(laser.beamPower / (Math.PI * USEFUL_INTENSITY));
  if (radius < laser.aperture / 2) return 0;
  return (radius * laser.aperture) / (1.22 * laser.wavelength);
};

/** The furthest any of a design's weapons fires, m; zero if it has none. */
export const designReach = (design: Design): number =>
  Math.max(
    0,
    ...designComponentsOfType(design, 'laser').map(effectiveRange),
    ...designComponentsOfType(design, 'kinetic-gun').map(kineticGunRange),
  );

/** Electrical power a laser draws at full integrity while firing, W. */
export const laserPower = (laser: LaserDesign): number => laser.beamPower / laser.efficiency;

/** One laser's state. */
export interface LaserState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly laser: LaserDesign;
  /** Whether it is firing this step. */
  readonly firing: boolean;
  /** Electrical power it asks for this step, W. */
  readonly demand: number;
  /** Power it put into its beam in the last step, W. */
  readonly beamPower: number;
  /** The target it fired at in the last step, if any. */
  readonly firedAt: SideId | null;
  /** The part its beam last landed on, e.g. "forward" or "middle/1", or null. */
  readonly striking: string | null;
}

/** One kinetic gun's state. */
export interface KineticGunState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly gun: KineticGunDesign;
  /** Whether it is firing at the target this step: drawing power for a shot, or loosing one. */
  readonly firing: boolean;
  /** Electrical power it asks for this step, W. */
  readonly demand: number;
  /** Electrical energy drawn towards its next shot, J. */
  readonly charge: number;
}

/** A ship's weapons: the captain's order and each weapon's state. */
export interface WeaponsState {
  readonly target: SideId | null;
  readonly mode: FireMode;
  readonly lasers: readonly LaserState[];
  readonly kineticGuns: readonly KineticGunState[];
  /** Electrical power the weapons ask for this step, W. */
  readonly demand: number;
  /** The fraction of the power the weapons draw that leaves in laser beams. */
  readonly beamFraction: number;
  /** The fraction of the power the weapons draw that kinetic guns put into their slugs. */
  readonly slugFraction: number;
  /** The latest hit this ship's lasers scored. */
  readonly lastHit: HitEvent | null;
}

/** The slugs held in one magazine. */
export interface MagazineState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly slugs: number;
}

/** Every magazine of a design, full. */
export const initialAmmunition = (design: Design): MagazineState[] =>
  componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'magazine' ? [{ slot: i, slugs: slot.component.slugs }] : [],
  );

/** Slugs left in the ship's magazines. */
export const slugsLeft = (ship: ShipState): number =>
  ship.ammunition.reduce((total, magazine) => total + magazine.slugs, 0);

/** A step's worth of beam on its way to the target at light speed. */
export interface Beam {
  readonly attacker: SideId;
  readonly target: SideId;
  /** The laser's place in the attacker's lasers list. */
  readonly laser: number;
  /** W */
  readonly power: number;
  readonly aperture: number;
  readonly wavelength: number;
  /** Where the attacker was when it fired. */
  readonly origin: Vec3;
  /** Distance to the target when fired, m. */
  readonly range: number;
  /** Battle time it reaches the target, s. */
  readonly arrival: number;
  /** Whether the laser was already firing at this target in the step before. */
  readonly continuing: boolean;
}

/** Every ship starts a battle with no target and holding fire. */
export const initialWeapons = (design: Design): WeaponsState => ({
  target: null,
  mode: 'hold-fire',
  lasers: componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'laser'
      ? [
          {
            slot: i,
            laser: slot.component,
            firing: false,
            demand: 0,
            beamPower: 0,
            firedAt: null,
            striking: null,
          },
        ]
      : [],
  ),
  kineticGuns: componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'kinetic-gun'
      ? [{ slot: i, gun: slot.component, firing: false, demand: 0, charge: 0 }]
      : [],
  ),
  demand: 0,
  beamFraction: 0,
  slugFraction: 0,
  lastHit: null,
});

/**
 * Decides which weapons fire this step and the power they ask for: when firing freely at a target
 * within their effective range, as much as their integrity and the ship's temperature allow.
 * A kinetic gun also needs slugs left, and asks only for what its next shot still needs.
 * `range` is the distance to the ordered target, or null without one. Phase 1 turrets bear in
 * every direction; firing arcs come later.
 */
export const aimWeapons = (ship: ShipState, range: number | null): void => {
  const { weapons } = ship;
  const limit = thermalLimit(ship.heat / thermalProperties(ship.design).heatCapacity);
  const inReach = (reach: number) =>
    weapons.mode === 'fire-freely' && range !== null && range <= reach;
  let demand = 0;
  let beam = 0;
  let slug = 0;
  const lasers = weapons.lasers.map((state) => {
    const integrity = ship.integrity[state.slot] ?? 0;
    const firing = integrity > 0 && inReach(effectiveRange(state.laser));
    const wanted = firing ? laserPower(state.laser) * integrity * limit : 0;
    demand += wanted;
    beam += wanted * state.laser.efficiency;
    return { ...state, firing, demand: wanted };
  });
  const loaded = slugsLeft(ship) > 0;
  const kineticGuns = weapons.kineticGuns.map((state) => {
    const integrity = ship.integrity[state.slot] ?? 0;
    const firing = loaded && integrity > 0 && inReach(kineticGunRange(state.gun));
    const needed = Math.max(0, shotEnergy(state.gun) - state.charge) / TIME_STEP;
    const wanted = firing ? Math.min(kineticGunPower(state.gun) * integrity * limit, needed) : 0;
    demand += wanted;
    slug += wanted * state.gun.efficiency;
    return { ...state, firing, demand: wanted };
  });
  ship.weapons = {
    ...weapons,
    lasers,
    kineticGuns,
    demand,
    beamFraction: demand > 0 ? beam / demand : 0,
    slugFraction: demand > 0 ? slug / demand : 0,
  };
};

/** The share of what the weapons asked for that they were given this step. */
const weaponsShare = (ship: ShipState): number =>
  ship.weapons.demand > 0 ? ship.powerFlow.systems.weapons.supplied / ship.weapons.demand : 0;

/**
 * Sends out this step's beams once power is settled: each firing laser gets its share of the
 * power the weapons were given, and puts its efficiency's part of that into its beam. The beam
 * reaches the target R/c later; fire control leads the target by its known motion.
 */
export const emitBeams = (
  ship: ShipState,
  attacker: SideId,
  target: { readonly id: SideId; readonly position: Vec3 } | null,
  time: number,
): Beam[] => {
  const { weapons } = ship;
  const share = weaponsShare(ship);
  const beams: Beam[] = [];
  const lasers = weapons.lasers.map((state, i) => {
    const power = state.firing ? state.demand * share * state.laser.efficiency : 0;
    if (!(power > 0) || !target) return { ...state, beamPower: 0, firedAt: null };
    const dx = target.position.x - ship.position.x;
    const dy = target.position.y - ship.position.y;
    const dz = target.position.z - ship.position.z;
    const range = Math.hypot(dx, dy, dz);
    beams.push({
      attacker,
      target: target.id,
      laser: i,
      power,
      aperture: state.laser.aperture,
      wavelength: state.laser.wavelength,
      origin: ship.position,
      range,
      arrival: time + range / SPEED_OF_LIGHT,
      continuing: state.firedAt === target.id,
    });
    return { ...state, beamPower: power, firedAt: target.id };
  });
  ship.weapons = { ...weapons, lasers };
  return beams;
};

/** Takes one slug from the first magazine that has any. */
const takeSlug = (ship: ShipState): void => {
  const from = ship.ammunition.findIndex((magazine) => magazine.slugs > 0);
  ship.ammunition = ship.ammunition.map((magazine, i) =>
    i === from ? { ...magazine, slugs: magazine.slugs - 1 } : magazine,
  );
};

/**
 * Charges the kinetic guns with their share of the power the weapons were given, and fires each
 * one whose next shot is fully charged, given a target, a slug and a firing solution. Fire
 * control leads the target on its observed motion. The slug leaves at the muzzle velocity
 * relative to the ship, and its recoil pushes the ship back by the slug's momentum.
 */
export const fireKineticGuns = (
  ship: ShipState,
  attacker: SideId,
  target: { readonly id: SideId; readonly motion: Motion } | null,
  dt: number,
  nextId: () => number,
): Slug[] => {
  const share = weaponsShare(ship);
  const { mass } = massProperties(ship.design, ship.propellantMass);
  const slugs: Slug[] = [];
  const kineticGuns = ship.weapons.kineticGuns.map((state) => {
    const needed = shotEnergy(state.gun);
    const charge = Math.min(needed, state.charge + state.demand * share * dt);
    // The allowance stops rounding error in the charge from holding a shot back a step.
    if (!state.firing || !target || charge < needed * (1 - 1e-9) || slugsLeft(ship) === 0) {
      return { ...state, charge };
    }
    const { muzzleVelocity, slugMass } = state.gun;
    const solution = firingSolution(ship, target.motion, muzzleVelocity, dt);
    if (!solution) return { ...state, charge };
    takeSlug(ship);
    const launch = scale(solution.direction, muzzleVelocity);
    slugs.push({
      id: nextId(),
      attacker,
      target: target.id,
      mass: slugMass,
      position: ship.position,
      velocity: add(ship.velocity, launch),
    });
    ship.velocity = sub(ship.velocity, scale(launch, slugMass / mass));
    return { ...state, charge: Math.max(0, charge - needed) };
  });
  ship.weapons = { ...ship.weapons, kineticGuns };
  return slugs;
};
