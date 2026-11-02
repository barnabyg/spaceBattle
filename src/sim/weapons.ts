import type { SideId } from './battle';
import {
  beamEfficiency,
  beamKindOf,
  beamWeaponPower,
  effectiveRange,
  SPEED_OF_LIGHT,
  type BeamWeaponDesign,
} from './beams';
import { componentSlots } from './components';
import {
  designComponentsOfType,
  missileMass,
  type Design,
  type KineticGunDesign,
  type LauncherDesign,
  type MissileDesign,
} from './design';
import type { BeamKind, HitEvent } from './events';
import { thermalLimit, thermalProperties } from './heat';
import {
  firingSolution,
  kineticGunPower,
  kineticGunRange,
  shotEnergy,
  type Motion,
  type Slug,
} from './kinetic';
import { launchMissile, missileReach, type Missile } from './missile';
import type { FireMode } from './orders';
import { shipMassProperties, type ShipState } from './ship';
import { TIME_STEP } from './time';
import { add, scale, sub, type Vec3 } from './vector';

/** The missiles a design's magazines hold, by design. */
export const designMissiles = (design: Design): readonly MissileDesign[] =>
  designComponentsOfType(design, 'magazine').flatMap((m) => (m.missile ? [m.missile] : []));

/** A design's beam weapons: its lasers and particle beams. */
export const designBeamWeapons = (design: Design): readonly BeamWeaponDesign[] => [
  ...designComponentsOfType(design, 'laser'),
  ...designComponentsOfType(design, 'charged-particle-beam'),
  ...designComponentsOfType(design, 'neutral-particle-beam'),
];

/** The furthest any of a design's weapons fires, m; zero if it has none. */
export const designReach = (design: Design): number =>
  Math.max(
    0,
    ...designBeamWeapons(design).map(effectiveRange),
    ...designComponentsOfType(design, 'kinetic-gun').map(kineticGunRange),
    ...(designComponentsOfType(design, 'launcher').length > 0
      ? designMissiles(design).map(missileReach)
      : []),
  );

/** One beam weapon's state: a laser's or a particle beam's. */
export interface BeamWeaponState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly weapon: BeamWeaponDesign;
  readonly attack: BeamKind;
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

/** One launcher's state. */
export interface LauncherState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly launcher: LauncherDesign;
  /** Time until it has loaded its next missile, s; zero when loaded. */
  readonly reload: number;
}

/** Missiles still to launch at a target under the captain's launch order. */
export interface Salvo {
  readonly target: SideId;
  readonly remaining: number;
}

/** A ship's weapons: the captain's orders and each weapon's state. */
export interface WeaponsState {
  readonly target: SideId | null;
  readonly mode: FireMode;
  /** Lasers and particle beams, in the order of the ship's component slots. */
  readonly beamWeapons: readonly BeamWeaponState[];
  readonly kineticGuns: readonly KineticGunState[];
  readonly launchers: readonly LauncherState[];
  /** The launch order still being carried out, if any. */
  readonly salvo: Salvo | null;
  /** Electrical power the weapons ask for this step, W. */
  readonly demand: number;
  /** The fraction of the power the weapons draw that leaves in beams. */
  readonly beamFraction: number;
  /** The fraction of the power the weapons draw that kinetic guns put into their slugs. */
  readonly slugFraction: number;
  /** The latest hit this ship's beam weapons scored. */
  readonly lastHit: HitEvent | null;
}

/** The ammunition held in one magazine. */
export interface MagazineState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly slugs: number;
  readonly missiles: number;
  /** The missiles it holds, if any. */
  readonly missile: MissileDesign | null;
}

/** Every magazine of a design, full. */
export const initialAmmunition = (design: Design): MagazineState[] =>
  componentSlots(design).flatMap(({ component }, i) =>
    component.type === 'magazine'
      ? [
          {
            slot: i,
            slugs: component.slugs,
            missiles: component.missiles,
            missile: component.missile,
          },
        ]
      : [],
  );

/** Slugs left in the ship's magazines. */
export const slugsLeft = (ship: ShipState): number =>
  ship.ammunition.reduce((total, magazine) => total + magazine.slugs, 0);

/** Missiles left in the ship's magazines. */
export const missilesLeft = (ship: ShipState): number =>
  ship.ammunition.reduce((total, magazine) => total + magazine.missiles, 0);

/**
 * Takes rounds out of the magazine at `magazine` in the ship's ammunition list: `slugs` and
 * `missiles` say how many of each, and `mass` how much lighter that leaves the ship, kg.
 */
const takeAmmunition = (
  ship: ShipState,
  magazine: number,
  taken: { readonly slugs: number; readonly missiles: number; readonly mass: number },
): void => {
  const slot = ship.ammunition[magazine]?.slot ?? -1;
  const section = componentSlots(ship.design)[slot]?.section;
  if (!section) return;
  ship.ammunition = ship.ammunition.map((m, i) =>
    i === magazine
      ? { ...m, slugs: m.slugs - taken.slugs, missiles: m.missiles - taken.missiles }
      : m,
  );
  ship.ammunitionSpent = {
    ...ship.ammunitionSpent,
    [section]: ship.ammunitionSpent[section] + taken.mass,
  };
};

/**
 * A step's worth of beam on its way to the target at light speed: a laser's light, or a particle
 * beam's particles, which at their energies travel within a fraction of a percent of it.
 */
export interface Beam {
  readonly attacker: SideId;
  readonly target: SideId;
  readonly attack: BeamKind;
  /** The weapon's place in the attacker's beam weapons list. */
  readonly emitter: number;
  /** The weapon that fired it, which sets how it spreads. */
  readonly weapon: BeamWeaponDesign;
  /** W */
  readonly power: number;
  /** Where the attacker was when it fired. */
  readonly origin: Vec3;
  /** Distance to the target when fired, m. */
  readonly range: number;
  /** Battle time it reaches the target, s. */
  readonly arrival: number;
  /** Whether the weapon was already firing at this target in the step before. */
  readonly continuing: boolean;
}

/** Every ship starts a battle with no target and holding fire. */
export const initialWeapons = (design: Design): WeaponsState => ({
  target: null,
  mode: 'hold-fire',
  beamWeapons: componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'laser' ||
    slot.component.type === 'charged-particle-beam' ||
    slot.component.type === 'neutral-particle-beam'
      ? [
          {
            slot: i,
            weapon: slot.component,
            attack: beamKindOf(slot.component),
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
  launchers: componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'launcher' ? [{ slot: i, launcher: slot.component, reload: 0 }] : [],
  ),
  salvo: null,
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
  const beamWeapons = weapons.beamWeapons.map((state) => {
    const integrity = ship.integrity[state.slot] ?? 0;
    const firing = integrity > 0 && inReach(effectiveRange(state.weapon));
    const wanted = firing ? beamWeaponPower(state.weapon) * integrity * limit : 0;
    demand += wanted;
    beam += wanted * beamEfficiency(state.weapon);
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
    beamWeapons,
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
 * Sends out this step's beams once power is settled: each firing beam weapon gets its share of
 * the power the weapons were given, and puts its efficiency's part of that into its beam (for a
 * neutral particle beam, only what survives the stripping). The beam reaches the target R/c
 * later; fire control leads the target by its known motion.
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
  const beamWeapons = weapons.beamWeapons.map((state, i) => {
    const power = state.firing ? state.demand * share * beamEfficiency(state.weapon) : 0;
    if (!(power > 0) || !target) return { ...state, beamPower: 0, firedAt: null };
    const dx = target.position.x - ship.position.x;
    const dy = target.position.y - ship.position.y;
    const dz = target.position.z - ship.position.z;
    const range = Math.hypot(dx, dy, dz);
    beams.push({
      attacker,
      target: target.id,
      attack: state.attack,
      emitter: i,
      weapon: state.weapon,
      power,
      origin: ship.position,
      range,
      arrival: time + range / SPEED_OF_LIGHT,
      continuing: state.firedAt === target.id,
    });
    return { ...state, beamPower: power, firedAt: target.id };
  });
  ship.weapons = { ...weapons, beamWeapons };
  return beams;
};

/** Takes one slug of `slugMass` kg from the first magazine that has any. */
const takeSlug = (ship: ShipState, slugMass: number): void => {
  const from = ship.ammunition.findIndex((magazine) => magazine.slugs > 0);
  takeAmmunition(ship, from, { slugs: 1, missiles: 0, mass: slugMass });
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
  const { mass } = shipMassProperties(ship);
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
    takeSlug(ship, slugMass);
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

/** A missile just launched, and the launcher in the ship's list that launched it. */
export interface Launch {
  readonly missile: Missile;
  readonly launcher: number;
}

/**
 * Carries out the salvo, if any: each working, loaded launcher fires one missile from the first
 * magazine holding any, until the salvo is done or the magazines are empty, and then reloads,
 * taking longer the more it is damaged; reloading counts down over each step, launching ends it. Missiles leave from the ship's centre of mass, moving with it,
 * and steer themselves from there; the ship gets lighter by each. `target` is the salvo's target
 * while it is still in the battle, or null.
 */
export const launchMissiles = (
  ship: ShipState,
  attacker: SideId,
  target: SideId | null,
  dt: number,
  nextId: () => number,
): Launch[] => {
  const { salvo } = ship.weapons;
  let remaining = salvo?.target === target ? salvo.remaining : 0;
  const launched: Launch[] = [];
  const launchers = ship.weapons.launchers.map((state, i) => {
    const integrity = ship.integrity[state.slot] ?? 0;
    if (integrity <= 0) return state;
    const from = ship.ammunition.findIndex((magazine) => magazine.missiles > 0);
    const design = ship.ammunition[from]?.missile;
    // The allowance stops rounding error in the countdown from holding a launch back a step.
    const reload = state.reload - dt > 1e-9 ? state.reload - dt : 0;
    if (reload > 0 || remaining === 0 || !target || !design) return { ...state, reload };
    takeAmmunition(ship, from, { slugs: 0, missiles: 1, mass: missileMass(design) });
    remaining -= 1;
    launched.push({
      missile: launchMissile(nextId(), attacker, target, design, ship),
      launcher: i,
    });
    return { ...state, reload: state.launcher.reloadTime / integrity };
  });
  const done = remaining === 0 || missilesLeft(ship) === 0;
  ship.weapons = {
    ...ship.weapons,
    launchers,
    salvo: salvo && !done ? { ...salvo, remaining } : null,
  };
  return launched;
};
