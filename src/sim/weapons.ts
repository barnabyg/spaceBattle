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
  missileRole,
  type Design,
  type KineticGunDesign,
  type LauncherDesign,
  type MissileDesign,
  type PointDefenceDesign,
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
import { launchMissile, missileReach, type Missile, type MissileTarget } from './missile';
import type { FireMode, PointDefencePriority } from './orders';
import {
  assignPointDefence,
  burstEnergy,
  burstSpread,
  missileHitChance,
  pointDefencePower,
  pointDefenceSolution,
  type PointDefenceEngagement,
  type Threat,
} from './pointDefence';
import { shipMassProperties, type ShipState } from './ship';
import { TIME_STEP } from './time';
import { add, dot, normalize, scale, sub, type Vec3 } from './vector';

/** The missiles a design's magazines hold, by design. */
export const designMissiles = (design: Design): readonly MissileDesign[] =>
  designComponentsOfType(design, 'magazine').flatMap((m) => (m.missile ? [m.missile] : []));

/** A design's beam weapons: its lasers and particle beams. */
export const designBeamWeapons = (design: Design): readonly BeamWeaponDesign[] => [
  ...designComponentsOfType(design, 'laser'),
  ...designComponentsOfType(design, 'charged-particle-beam'),
  ...designComponentsOfType(design, 'neutral-particle-beam'),
];

/**
 * The furthest any of a design's weapons fires at a ship, m; zero if it has none. Anti-missile
 * missiles are left out: they fire only at missiles.
 */
export const designReach = (design: Design): number =>
  Math.max(
    0,
    ...designBeamWeapons(design).map(effectiveRange),
    ...designComponentsOfType(design, 'kinetic-gun').map(kineticGunRange),
    ...(designComponentsOfType(design, 'launcher').length > 0
      ? designMissiles(design)
          .filter((missile) => missileRole(missile) === 'anti-ship')
          .map(missileReach)
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

/** One point defence gun's state. */
export interface PointDefenceState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly gun: PointDefenceDesign;
  /** What it is firing on this step, if anything. */
  readonly engaging: PointDefenceEngagement | null;
  /** Electrical power it asks for this step, W. */
  readonly demand: number;
  /** Electrical energy drawn towards its next burst, J. */
  readonly charge: number;
  /** The chance its latest burst at a missile had of bringing it down, or null before any. */
  readonly lastChance: number | null;
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
  /** An enemy ship, or an enemy missile in flight for anti-missile missiles. */
  readonly target: MissileTarget;
  readonly remaining: number;
  /** The name of the missile design it launches. */
  readonly missile: string;
}

/** A ship's weapons: the captain's orders and each weapon's state. */
export interface WeaponsState {
  readonly target: SideId | null;
  readonly mode: FireMode;
  /** Lasers and particle beams, in the order of the ship's component slots. */
  readonly beamWeapons: readonly BeamWeaponState[];
  readonly kineticGuns: readonly KineticGunState[];
  readonly pointDefence: readonly PointDefenceState[];
  /** What the captain has the point defence fire on. */
  readonly pointDefencePriority: PointDefencePriority;
  /** Enemy missiles the ship has shot down. */
  readonly intercepts: number;
  readonly launchers: readonly LauncherState[];
  /** The launch order still being carried out, if any. */
  readonly salvo: Salvo | null;
  /** Whether the ship launches anti-missile missiles at incoming missiles by itself. */
  readonly automaticDefence: boolean;
  /** Electrical power the weapons ask for this step, W. */
  readonly demand: number;
  /** The fraction of the power the weapons draw that leaves in beams. */
  readonly beamFraction: number;
  /**
   * The fraction of the power the weapons draw that kinetic guns and point defence put into their
   * slugs and rounds.
   */
  readonly slugFraction: number;
  /** The latest hit this ship's beam weapons scored. */
  readonly lastHit: HitEvent | null;
}

/** The ammunition held in one magazine. */
export interface MagazineState {
  /** Its place in the ship's component slots. */
  readonly slot: number;
  readonly slugs: number;
  readonly rounds: number;
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
            rounds: component.rounds,
            missiles: component.missiles,
            missile: component.missile,
          },
        ]
      : [],
  );

/** Slugs left in the ship's magazines. */
export const slugsLeft = (ship: ShipState): number =>
  ship.ammunition.reduce((total, magazine) => total + magazine.slugs, 0);

/** Point defence rounds left in the ship's magazines. */
export const roundsLeft = (ship: ShipState): number =>
  ship.ammunition.reduce((total, magazine) => total + magazine.rounds, 0);

/** Missiles left in the ship's magazines: of one design, by name, or of every design. */
export const missilesLeft = (ship: ShipState, name?: string): number =>
  ship.ammunition.reduce(
    (total, magazine) =>
      name === undefined || magazine.missile?.name === name ? total + magazine.missiles : total,
    0,
  );

/** How much ammunition of each kind to take. */
interface Taken {
  readonly slugs?: number;
  readonly rounds?: number;
  readonly missiles?: number;
  /** How much lighter it leaves the ship, kg. */
  readonly mass: number;
}

/**
 * Takes ammunition out of the magazine at `magazine` in the ship's ammunition list: so many
 * slugs, rounds and missiles, leaving the ship lighter by `mass`.
 */
const takeAmmunition = (ship: ShipState, magazine: number, taken: Taken): void => {
  const slot = ship.ammunition[magazine]?.slot ?? -1;
  const section = componentSlots(ship.design)[slot]?.section;
  if (!section) return;
  const { slugs = 0, rounds = 0, missiles = 0 } = taken;
  ship.ammunition = ship.ammunition.map((m, i) =>
    i === magazine
      ? {
          ...m,
          slugs: m.slugs - slugs,
          rounds: m.rounds - rounds,
          missiles: m.missiles - missiles,
        }
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

/**
 * Every ship starts a battle with no target and holding fire, its point defence on missiles
 * only and its automatic missile defence on.
 */
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
  pointDefence: componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'point-defence'
      ? [{ slot: i, gun: slot.component, engaging: null, demand: 0, charge: 0, lastChance: null }]
      : [],
  ),
  pointDefencePriority: 'missiles',
  intercepts: 0,
  launchers: componentSlots(design).flatMap((slot, i) =>
    slot.component.type === 'launcher' ? [{ slot: i, launcher: slot.component, reload: 0 }] : [],
  ),
  salvo: null,
  automaticDefence: true,
  demand: 0,
  beamFraction: 0,
  slugFraction: 0,
  lastHit: null,
});

/** What point defence may fire on this step: enemy missiles, and the targeted ship. */
export interface PointDefenceTargets {
  /** Enemy missiles in flight, as seen at the start of the step. */
  readonly threats: readonly Threat[];
  /** The ship the weapons order targets, if any, as seen at the start of the step. */
  readonly ship: { readonly id: SideId; readonly motion: Motion } | null;
}

/** Fires point defence on nothing. */
const NO_POINT_DEFENCE_TARGETS: PointDefenceTargets = { threats: [], ship: null };

/**
 * Decides which weapons fire this step and the power they ask for: when firing freely at a target
 * within their effective range, as much as their integrity and the ship's temperature allow.
 * A kinetic gun also needs slugs left, and asks only for what its next shot still needs.
 * `range` is the distance to the ordered target, or null without one. Phase 1 turrets bear in
 * every direction; firing arcs come later. Point defence, given rounds, fires on enemy missiles
 * within its reach whatever the fire mode (see `assignPointDefence`), and on the targeted ship
 * only when its priority allows and the weapons fire freely.
 */
export const aimWeapons = (
  ship: ShipState,
  range: number | null,
  targets: PointDefenceTargets = NO_POINT_DEFENCE_TARGETS,
): void => {
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
  const armed = roundsLeft(ship) > 0;
  const onShip =
    weapons.pointDefencePriority === 'missiles-then-ship' && weapons.mode === 'fire-freely';
  const engagements = assignPointDefence(
    ship,
    weapons.pointDefence.map((state) =>
      armed && (ship.integrity[state.slot] ?? 0) > 0 ? state.gun : null,
    ),
    targets.threats,
    onShip ? targets.ship : null,
    TIME_STEP,
  );
  const pointDefence = weapons.pointDefence.map((state, i) => {
    const integrity = ship.integrity[state.slot] ?? 0;
    const engaging = engagements[i] ?? null;
    // Enough for every burst its rate allows in a step, and at least one.
    const bursts = Math.max(1, state.gun.burstRate * TIME_STEP);
    const needed = Math.max(0, bursts * burstEnergy(state.gun) - state.charge) / TIME_STEP;
    const wanted = engaging
      ? Math.min(pointDefencePower(state.gun) * integrity * limit, needed)
      : 0;
    demand += wanted;
    slug += wanted * state.gun.efficiency;
    return { ...state, engaging, demand: wanted };
  });
  ship.weapons = {
    ...weapons,
    beamWeapons,
    kineticGuns,
    pointDefence,
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
  takeAmmunition(ship, from, { slugs: 1, mass: slugMass });
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

/** A burst of point defence rounds on its way to what it was fired on. */
export interface PointDefenceBurst {
  /** The side that fired it. */
  readonly attacker: SideId;
  /** The gun's place in the attacker's point defence list. */
  readonly gun: number;
  readonly engagement: PointDefenceEngagement;
  /** Battle time its rounds meet the target, s. */
  readonly arrival: number;
  readonly rounds: number;
  /** kg */
  readonly roundMass: number;
  /** World unit vector its rounds fly along relative to the target. */
  readonly direction: Vec3;
  /** Its rounds' speed relative to the target, m/s. */
  readonly speed: number;
  /** Radius of the disc its rounds spread over about the target, m (see `burstSpread`). */
  readonly spread: number;
  /** For a burst at a missile, the chance it brings the missile down; 0 at a ship. */
  readonly chance: number;
}

/** Takes `count` rounds of `roundMass` kg from the magazines, first to last. */
const takeRounds = (ship: ShipState, count: number, roundMass: number): void => {
  let left = count;
  for (let i = 0; i < ship.ammunition.length && left > 0; i++) {
    const taken = Math.min(left, ship.ammunition[i]?.rounds ?? 0);
    if (taken > 0) takeAmmunition(ship, i, { rounds: taken, mass: taken * roundMass });
    left -= taken;
  }
};

/**
 * Charges the point defence guns with their share of the power the weapons were given, and fires
 * a burst from each one engaging a target as often as its charge allows, given rounds and a firing
 * solution from fire control (see `pointDefenceSolution`). A burst takes its rounds from the
 * magazines, or what is left of them, and its recoil pushes the ship back. It meets its target
 * after the rounds' flight, leaving at `time`; at a missile it carries the chance it has of
 * bringing it down then.
 */
export const firePointDefence = (
  ship: ShipState,
  attacker: SideId,
  targets: PointDefenceTargets,
  time: number,
  dt: number,
): PointDefenceBurst[] => {
  const share = weaponsShare(ship);
  const bursts: PointDefenceBurst[] = [];
  const pointDefence = ship.weapons.pointDefence.map((state, gun) => {
    const needed = burstEnergy(state.gun);
    let charge = state.charge + state.demand * share * dt;
    let { lastChance } = state;
    const { engaging } = state;
    const threat =
      engaging?.kind === 'missile'
        ? targets.threats.find((t) => t.id === engaging.munition)
        : undefined;
    const motion =
      engaging?.kind === 'ship' && targets.ship?.id === engaging.side
        ? targets.ship.motion
        : threat?.motion;
    // The allowance stops rounding error in the charge from holding a burst back a step.
    while (engaging && motion && charge >= needed * (1 - 1e-9) && roundsLeft(ship) > 0) {
      const solution = pointDefenceSolution(state.gun, ship, motion, dt);
      if (!solution) break;
      const { roundMass, muzzleVelocity, roundsPerBurst } = state.gun;
      const rounds = Math.min(roundsPerBurst, roundsLeft(ship));
      takeRounds(ship, rounds, roundMass);
      const launch = scale(solution.direction, muzzleVelocity);
      const relative = sub(add(ship.velocity, launch), motion.velocity);
      const chance = threat ? missileHitChance(state.gun, rounds, ship, threat, solution) : 0;
      bursts.push({
        attacker,
        gun,
        engagement: engaging,
        arrival: time + solution.flightTime,
        rounds,
        roundMass,
        direction: normalize(relative),
        speed: Math.sqrt(dot(relative, relative)),
        spread: burstSpread(state.gun, ship, motion, solution),
        chance,
      });
      if (threat) lastChance = chance;
      const { mass } = shipMassProperties(ship);
      ship.velocity = sub(ship.velocity, scale(launch, (rounds * roundMass) / mass));
      charge -= needed;
    }
    return { ...state, charge: Math.min(charge, needed), lastChance };
  });
  ship.weapons = { ...ship.weapons, pointDefence };
  return bursts;
};

/** A missile just launched, and the launcher in the ship's list that launched it. */
export interface Launch {
  readonly missile: Missile;
  readonly launcher: number;
}

/** The first magazine in the ship's list holding missiles that pass `wanted`, or -1. */
const magazineOf = (ship: ShipState, wanted: (missile: MissileDesign) => boolean): number =>
  ship.ammunition.findIndex((m) => m.missiles > 0 && m.missile !== null && wanted(m.missile));

/**
 * Launches missiles from the working, loaded launchers, in turn. First comes automatic missile
 * defence: an anti-missile missile at each of `threats` (missile ids, most urgent first), from the
 * first magazine holding any. Then the salvo, if any: its missile design, until the salvo is done
 * or the magazines hold no more of it. `salvoTarget` is the salvo's target while it is still in
 * the battle, or null. Each launcher then reloads, taking longer the more it is damaged;
 * reloading counts down over each step, launching ends it. Missiles leave from the ship's centre
 * of mass, moving with it, and steer themselves from there; the ship gets lighter by each.
 */
export const launchMissiles = (
  ship: ShipState,
  attacker: SideId,
  salvoTarget: MissileTarget | null,
  threats: readonly number[],
  dt: number,
  nextId: () => number,
): Launch[] => {
  const { salvo } = ship.weapons;
  let remaining = salvo && salvoTarget !== null ? salvo.remaining : 0;
  const defending = [...threats];
  const launched: Launch[] = [];
  const launch = (from: number, target: MissileTarget, launcher: number) => {
    const design = ship.ammunition[from]?.missile;
    if (!design) return;
    takeAmmunition(ship, from, { missiles: 1, mass: missileMass(design) });
    launched.push({ missile: launchMissile(nextId(), attacker, target, design, ship), launcher });
  };
  const launchers = ship.weapons.launchers.map((state, i) => {
    const integrity = ship.integrity[state.slot] ?? 0;
    if (integrity <= 0) return state;
    // The allowance stops rounding error in the countdown from holding a launch back a step.
    const reload = state.reload - dt > 1e-9 ? state.reload - dt : 0;
    if (reload > 0) return { ...state, reload };
    const antiMissile = magazineOf(ship, (m) => missileRole(m) === 'anti-missile');
    const threat = defending[0];
    if (threat !== undefined && antiMissile >= 0) {
      defending.shift();
      launch(antiMissile, { munition: threat }, i);
    } else {
      const from = salvo ? magazineOf(ship, (m) => m.name === salvo.missile) : -1;
      if (remaining === 0 || salvoTarget === null || from < 0) return { ...state, reload };
      remaining -= 1;
      launch(from, salvoTarget, i);
    }
    return { ...state, reload: state.launcher.reloadTime / integrity };
  });
  const done = remaining === 0 || !salvo || missilesLeft(ship, salvo.missile) === 0;
  ship.weapons = {
    ...ship.weapons,
    launchers,
    salvo: salvo && !done ? { ...salvo, remaining } : null,
  };
  return launched;
};
