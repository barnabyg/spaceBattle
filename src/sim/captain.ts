import type {
  ContactObservation,
  MissileObservation,
  OwnShipObservation,
  SideId,
  SideObservation,
  SideSetup,
} from './battle';
import { effectiveRange } from './beams';
import {
  designComponents,
  designComponentsOfType,
  missileRole,
  type Design,
  type MountedComponentDesign,
  type ShieldType,
} from './design';
import { ARMOUR } from './armour';
import { BASE_TEMPERATURE, OVERHEAT_TEMPERATURE } from './heat';
import { missileReach, reachOfDeltaV } from './missile';
import type {
  AntiMissileOrder,
  AttitudeOrder,
  BurnOrder,
  LaunchOrder,
  ManoeuvreOrder,
  Order,
  PointDefenceOrder,
  PowerOrder,
  RadiatorsOrder,
  ShieldsOrder,
  WeaponsOrder,
} from './orders';
import type { PowerSystem } from './power';
import { designReach } from './weapons';
import { distance, dot, normalize, perpendiculars, scale, sub, type Vec3 } from './vector';

/**
 * A side's commander as the battle sees it: it decides on orders from what its side observes,
 * and may remember what it saw before. It never touches the ship itself.
 */
export interface Captain {
  readonly side: SideId;
  /** The orders to give now; none when the standing orders already do what it wants. */
  decide(observation: SideObservation): readonly Order[];
}

/** How skilled a computer captain is. */
export type CaptainSkill = 'low' | 'medium' | 'high';
export const CAPTAIN_SKILLS: readonly CaptainSkill[] = ['low', 'medium', 'high'];

/** What a captain of each skill does. */
interface SkillProfile {
  /** How often it reconsiders its plan and gives orders, s. */
  readonly reconsider: number;
  /**
   * Whether it foresees the enemy's motion against its own: where enemy slugs will meet a ship
   * that moves, so it dodges them.
   */
  readonly predicts: boolean;
  /**
   * Whether it manages power and heat: the weapons first in a fight and the drive first on the
   * way, radiators out to fight, shields raised only against weapons they counter. Without it
   * the captain leaves the power as it was, deploys the radiators only when hot and keeps the
   * shields up.
   */
  readonly managesPower: boolean;
  /** Whether it keeps out of reach of an enemy it outranges, rather than always closing in. */
  readonly keepsRange: boolean;
  /** Whether it turns its best-armoured section to the enemy near the range it wants. */
  readonly turnsArmour: boolean;
  /**
   * Whether it times its withdrawal, leaving out of the fight with `EARLY_WITHDRAWAL` times its
   * reserve still to spare rather than at the reserve itself.
   */
  readonly withdrawsEarly: boolean;
}

const SKILLS: Readonly<Record<CaptainSkill, SkillProfile>> = {
  low: {
    reconsider: 20,
    predicts: false,
    managesPower: false,
    keepsRange: false,
    turnsArmour: false,
    withdrawsEarly: false,
  },
  medium: {
    reconsider: 1,
    predicts: true,
    managesPower: true,
    keepsRange: true,
    turnsArmour: false,
    withdrawsEarly: false,
  },
  high: {
    reconsider: 1,
    predicts: true,
    managesPower: true,
    keepsRange: true,
    turnsArmour: true,
    withdrawsEarly: true,
  },
};

/** A captain that times its withdrawal leaves with this many times its reserve still to spare. */
const EARLY_WITHDRAWAL = 1.5;

/** A ship that outranges its enemy holds at this fraction of its own reach. */
const STANDOFF_FRACTION = 0.95;
/** A ship that cannot outrange its enemy closes to this fraction of its own reach. */
const CLOSE_FRACTION = 0.5;
/** Within this multiple of the longer reach a ship is fighting, not just manoeuvring. */
const FIGHTING_FRACTION = 1.05;
/**
 * The speed a ship works up to on its way to the range it wants, as a fraction of its delta-v
 * left: more than the autopilot's own, as the opening ranges are long and battles otherwise drag.
 */
const APPROACH_FRACTION = 0.2;
/** Radiators deploy above this temperature, K... */
const DEPLOY_TEMPERATURE = BASE_TEMPERATURE + 0.5 * (OVERHEAT_TEMPERATURE - BASE_TEMPERATURE);
/** ...and once out, stay out until the ship cools below this, K. */
const RETRACT_TEMPERATURE = BASE_TEMPERATURE + 0.2 * (OVERHEAT_TEMPERATURE - BASE_TEMPERATURE);
/** With no fire either way and the range not shrinking for this long, the captain closes in, s. */
const PATIENCE = 1_800;
/** The range must shrink by this fraction to count as getting somewhere. */
const PROGRESS_FRACTION = 0.01;
/** Ordered ranges within this fraction of each other count as the same order. */
const RANGE_TOLERANCE = 0.01;
/** Ordered speeds within this fraction of each other count as the same order. */
const SPEED_TOLERANCE = 0.1;
/**
 * A slug that takes longer than this to arrive can be dodged: the target has time to turn and
 * push itself out of the slug's path, s. So the captain fires its kinetic guns only at a target
 * close enough for its slugs to arrive sooner, and dodges enemy slugs that will arrive later.
 */
const DODGE_TIME = 20;
/** Dodging, the captain changes the direction it pushes in this often, s. */
const JINK_PERIOD = 15;
/** A captain turns its armour to the enemy while within this fraction of the range it wants. */
const SETTLED_BAND = 0.25;
/** An attitude this close to the one ordered (the cosine of the angle) is the same order. */
const SAME_DIRECTION = Math.cos((1 * Math.PI) / 180);
/**
 * A nuclear warhead strips the radiators facing it, so they come in once a nuclear missile is
 * this close to arriving, s.
 */
const NUCLEAR_WARNING = 120;

/**
 * Shields come second in a fight, ahead of the drive: they draw little beside the weapons, and
 * are raised only while an enemy weapon they counter can reach the ship. The weapons come first
 * under missile attack too, as point defence draws on them.
 */
const COMBAT_PRIORITIES: readonly PowerSystem[] = ['weapons', 'shields', 'drive', 'capacitors'];
const MANOEUVRE_PRIORITIES: readonly PowerSystem[] = ['drive', 'shields', 'weapons', 'capacitors'];

/** The enemy beam weapons each kind of shield counters. */
const COUNTERED: Readonly<Record<ShieldType, 'laser' | 'charged-particle-beam'>> = {
  'magnetic-shield': 'charged-particle-beam',
  'coolant-shield': 'laser',
};

/** The kinds of enemy beam weapon a design's shields counter. */
const counteredBy = (own: Design): ReadonlySet<'laser' | 'charged-particle-beam'> =>
  new Set(
    designComponents(own).flatMap(({ component }) =>
      component.type === 'magnetic-shield' || component.type === 'coolant-shield'
        ? [COUNTERED[component.type]]
        : [],
    ),
  );

/** How far a kinetic gun's slugs fly before they could be dodged, m. */
const sureRange = (muzzleVelocity: number): number => muzzleVelocity * DODGE_TIME;

/**
 * How far the ship's anti-ship missiles reach while it has a working launcher and some of them
 * left, m. Anti-missile missiles are left out: they are kept for missiles.
 */
const missileReachOf = ({ weapons }: OwnShipObservation): number =>
  weapons.launchers.some((l) => l.integrity > 0)
    ? Math.max(
        0,
        ...weapons.ammunition.missileDesigns
          .filter((missile) => missile.role === 'anti-ship' && missile.missiles > 0)
          .map((missile) => missile.reach),
      )
    : 0;

/** The longest `range` of any working one of `weapons`, m; zero without any. */
const reachOf = <W extends { readonly integrity: number }>(
  weapons: readonly W[],
  range: (weapon: W) => number,
): number => Math.max(0, ...weapons.filter((weapon) => weapon.integrity > 0).map(range));

/** How far the ship's working lasers and particle beams fire, m; zero without any. */
const beamReach = ({ weapons }: OwnShipObservation): number =>
  reachOf([...weapons.lasers, ...weapons.particleBeams], (weapon) => weapon.effectiveRange);

/** How close its working kinetic guns need the enemy to hit it for sure while it has slugs, m. */
const gunReach = ({ weapons }: OwnShipObservation): number =>
  weapons.ammunition.slugs > 0
    ? reachOf(weapons.kineticGuns, (gun) => sureRange(gun.muzzleVelocity))
    : 0;

/**
 * The furthest the ship's working weapons fight from, m: its lasers and particle beams, its
 * kinetic guns while it has slugs left (out to where they cannot be dodged), and its anti-ship
 * missiles while it has some and a launcher. Zero once none is left. Point defence and
 * anti-missile missiles are left out: they are kept for missiles.
 */
const ownReach = (ship: OwnShipObservation): number =>
  Math.max(missileReachOf(ship), beamReach(ship), gunReach(ship));

/** How far the ship's point defence reaches while it has a working gun and rounds left, m. */
const pointDefenceReach = ({ weapons }: OwnShipObservation): number =>
  weapons.ammunition.rounds > 0 ? reachOf(weapons.pointDefence, (gun) => gun.effectiveRange) : 0;

/** A mount of the enemy's the captain has made out, and how finely it saw it then. */
interface KnownMount {
  readonly component: MountedComponentDesign;
  /** The resolution it was made out at, m. */
  readonly resolution: number;
}

/**
 * What the captain makes of the enemy's arms from its contact alone: the mounts its sensors have
 * made out, remembered once the range opens and they blur again, and the anti-ship missiles it
 * has seen the enemy launch. It forgets a mount once it sees the contact at least as finely as it
 * saw the mount and the mount is gone: wrecked, or lost with its section. What it has not made
 * out it does not know: it neither sees nor guesses at weapons too small for its sensors.
 */
const enemyArsenal = () => {
  const mounts = new Map<string, KnownMount>();
  /** The longest reach of the enemy anti-ship missiles seen in flight, m. */
  let missileReachSeen = 0;
  /** Whether it has ever made out a launcher of the enemy's. */
  let launcherSeen = false;

  /** Notes the mounts made out on the contact and the enemy's missiles in flight. */
  const watch = (observation: SideObservation, contact: ContactObservation) => {
    const seen = new Set<string>();
    for (const mount of contact.mounts) {
      const key = `${mount.section}/${String(mount.mount)}`;
      seen.add(key);
      mounts.set(key, { component: mount.component, resolution: contact.resolution });
      if (mount.component.type === 'launcher') launcherSeen = true;
    }
    for (const [key, known] of mounts) {
      if (!seen.has(key) && contact.resolution <= known.resolution) mounts.delete(key);
    }
    for (const munition of observation.munitions) {
      if (
        munition.attacker === contact.sideId &&
        munition.kind === 'missile' &&
        munition.role === 'anti-ship'
      ) {
        missileReachSeen = Math.max(missileReachSeen, reachOfDeltaV(munition.deltaV));
      }
    }
  };

  /** The enemy's known beam weapons: lasers and particle beams. */
  const beamWeapons = () =>
    [...mounts.values()].flatMap(({ component }) =>
      component.type === 'laser' ||
      component.type === 'charged-particle-beam' ||
      component.type === 'neutral-particle-beam'
        ? [component]
        : [],
    );

  /**
   * How far the enemy's known weapons can hurt the ship, m: its beam weapons, its kinetic guns
   * out to where their slugs cannot be dodged, and its launchers as far as the missiles it has
   * been seen to launch reach, or else `presumedMissileReach`. A missile seen in flight shows a
   * launcher, made out or not, until every launcher made out is gone.
   */
  const reach = (presumedMissileReach: number): number => {
    const known = [...mounts.values()].map(({ component }) => component);
    const launcher = known.some((c) => c.type === 'launcher');
    return Math.max(
      0,
      ...beamWeapons().map(effectiveRange),
      ...known.map((c) => (c.type === 'kinetic-gun' ? sureRange(c.muzzleVelocity) : 0)),
      launcher || !launcherSeen ? missileReachSeen : 0,
      launcher && missileReachSeen === 0 ? presumedMissileReach : 0,
    );
  };

  /** How far the enemy's known beam weapons of the kinds in `kinds` reach, m; zero if none. */
  const reachOfKinds = (kinds: ReadonlySet<string>): number =>
    Math.max(
      0,
      ...beamWeapons()
        .filter((weapon) => kinds.has(weapon.type))
        .map(effectiveRange),
    );

  return { watch, reach, reachOfKinds };
};

/** Whether an order is already standing, so giving it again would change nothing. */
const inForce = (ship: OwnShipObservation, order: Order): boolean => {
  switch (order.type) {
    case 'weapons':
      return ship.weapons.target === order.target && ship.weapons.mode === order.mode;
    case 'radiators':
      return ship.heat.radiatorsDeployed === order.deployed;
    case 'shields':
      return ship.shields.raised === order.raised;
    case 'launch': {
      const { salvo } = ship.weapons;
      if (!salvo) return order.missiles === 0;
      const sameTarget =
        typeof order.target === 'string' || typeof salvo.target === 'string'
          ? salvo.target === order.target
          : salvo.target.munition === order.target.munition;
      return (
        sameTarget &&
        salvo.remaining === order.missiles &&
        (order.missile === undefined || salvo.missile === order.missile)
      );
    }
    case 'anti-missile':
      return ship.weapons.antiMissile.automatic === order.automatic;
    case 'withdraw':
      return ship.withdrawing;
    case 'power':
      return order.priorities.every((system, i) => ship.power.priorities[i] === system);
    case 'point-defence':
      return ship.weapons.pointDefencePriority === order.priority;
    case 'attitude': {
      const standing = ship.attitude;
      if (standing?.mode !== order.mode) return false;
      return (
        standing.mode !== 'direction' ||
        order.mode !== 'direction' ||
        dot(standing.direction, normalize(order.direction)) >= SAME_DIRECTION
      );
    }
    case 'burn':
      return ship.burn !== null && ship.burn.throttle === order.throttle;
    case 'manoeuvre': {
      const standing = ship.manoeuvre;
      if (order.goal === 'none') return standing === null;
      if (standing?.goal !== order.goal) return false;
      if (order.goal === 'match-velocity' || standing.range === null) return true;
      const speed = order.speed ?? null;
      const sameSpeed =
        speed === null || standing.speed === null
          ? speed === standing.speed
          : Math.abs(standing.speed - speed) <= SPEED_TOLERANCE * speed;
      return sameSpeed && Math.abs(standing.range - order.range) <= RANGE_TOLERANCE * order.range;
    }
  }
};

/** The enemy missiles in flight aimed at the side's ship. */
const missileThreats = (observation: SideObservation, side: SideId): MissileObservation[] =>
  observation.munitions.flatMap((m) => (m.kind === 'missile' && m.target === side ? [m] : []));

/** Seconds until a munition passes closest to the ship, if it keeps its course; ∞ if never. */
const timeToClosest = (
  ship: OwnShipObservation,
  munition: { readonly position: Vec3; readonly velocity: Vec3 },
): number => {
  const offset = sub(munition.position, ship.position);
  const drift = sub(munition.velocity, ship.velocity);
  const closing = -dot(offset, drift);
  return closing > 0 ? closing / dot(drift, drift) : Infinity;
};

/**
 * The orders that dodge enemy slugs still too far off to hit a ship that moves: the ship pushes
 * across the line of fire at full thrust, turning a quarter turn every `JINK_PERIOD`, so the
 * enemy's fire control, which leads on the ship's acceleration as it sees it when firing, never
 * knows where it will be. None while no such slug is on its way.
 */
const jink = (
  observation: SideObservation,
  side: SideId,
  enemy: ContactObservation,
): [AttitudeOrder, BurnOrder] | null => {
  const ship = observation.ownShip;
  const dodging = observation.munitions.some(
    (m) =>
      m.kind === 'slug' &&
      m.target === side &&
      Number.isFinite(timeToClosest(ship, m)) &&
      timeToClosest(ship, m) > DODGE_TIME,
  );
  if (!dodging) return null;
  const sight = normalize(sub(enemy.position, ship.position));
  // Two directions across the line of sight, square to it and to each other.
  const [across, other] = perpendiculars(sight);
  const directions = [across, other, scale(across, -1), scale(other, -1)];
  const direction =
    directions[Math.floor(observation.time / JINK_PERIOD) % directions.length] ?? across;
  return [
    { type: 'attitude', mode: 'direction', direction },
    { type: 'burn', throttle: 1, duration: 2 * JINK_PERIOD },
  ];
};

/**
 * A computer captain for one side, at the side's skill (medium if not set; see `SkillProfile`
 * for what each skill does). It knows its own ship's design, and of the enemy only what its side
 * observes: the weapons its sensors make out on the contact and the missiles the enemy launches
 * (see `enemyArsenal`). A weapon it has not made out, it does not allow for, though it takes an
 * enemy launcher to reach as far as its own missiles until it sees the enemy's.
 *
 * Range: if it outranges the enemy it holds just inside its own reach, out of the enemy's;
 * otherwise it closes to where its weapons bite hard. It heads there at a fifth of its delta-v,
 * as the opening ranges are long. If neither side fires and the range stops shrinking for a
 * while, it gives up on standing off and closes in for good. Near the range it wants, a highly
 * skilled captain turns its best-armoured section to the enemy, unless enemy missiles are on
 * their way. It never pursues a withdrawing enemy.
 *
 * Withdrawal: it withdraws once an armed ship has nothing left to fight with, or at its reserve
 * (a highly skilled one, out of the fight, with half the reserve again to spare). A ship built
 * without weapons stays.
 *
 * Weapons: it targets the enemy and fires its beams freely. It holds its kinetic guns' fire
 * until the enemy is close enough that their slugs arrive before it could dodge them, so as not
 * to throw its slugs away. It launches a salvo of anti-ship missiles, one from each working
 * launcher, whenever the enemy is within their reach, none of them is still in flight and no
 * enemy missile is on its way to it.
 *
 * Defence: it keeps its point defence on missiles, ignoring the enemy ship, unless point defence
 * is the only weapon it has left, when it turns it on the ship too and fights at its short reach.
 * It keeps automatic missile defence on, so its anti-missile missiles meet incoming missiles, and
 * keeps its launchers free for them while enemy missiles are inbound, sending a second
 * anti-missile missile at each nuclear one. It dodges enemy slugs fired from too far off to hit a
 * ship that moves. It ranks the weapons, then shields, first in a fight or under missile attack
 * and the drive first otherwise. It deploys its radiators to fight or to cool down, retracting
 * them when cool and out of reach, or when a nuclear missile is about to arrive. It keeps its
 * shields raised only while an enemy weapon they counter can reach it, saving their power and
 * heat the rest of the time.
 */
export const createComputerCaptain = (setup: SideSetup): Captain => {
  const side = setup.id;
  const profile = SKILLS[setup.skill ?? 'medium'];
  const arsenal = enemyArsenal();
  const countered = counteredBy(setup.design);
  // Whether it was built to harm a ship: point defence counts, anti-missile missiles do not.
  const armed =
    designReach(setup.design) > 0 ||
    designComponentsOfType(setup.design, 'point-defence').length > 0;
  // Its best-armoured section: the most armour by mass for each square metre.
  const armoured = [...setup.design.sections].sort(
    (a, b) =>
      b.armour.thickness * ARMOUR[b.armour.type].density -
      a.armour.thickness * ARMOUR[a.armour.type].density,
  )[0];
  const designMissileReach = Math.max(
    0,
    ...designComponentsOfType(setup.design, 'magazine').flatMap(({ missile }) =>
      missile && missileRole(missile) === 'anti-ship' ? [missileReach(missile)] : [],
    ),
  );
  let nextDecision = 0;
  /** When the battle last got somewhere, s, and the range to measure progress from, m. */
  let progress: { time: number; range: number } | null = null;
  let pressing = false;

  /** Notes fire either way or a shrinking range; a long spell of neither sends it in. */
  const notice = (observation: SideObservation, range: number) => {
    const { ownShip, time } = observation;
    const { weapons, appearance } = ownShip;
    const engaged =
      [...weapons.lasers, ...weapons.particleBeams, ...weapons.kineticGuns].some(
        (weapon) => weapon.firing,
      ) ||
      weapons.pointDefence.some((gun) => gun.engaging !== null) ||
      weapons.salvo !== null ||
      observation.munitions.length > 0 ||
      appearance.beamsLanding.length > 0 ||
      appearance.impacts.length > 0;
    if (!progress || engaged || range < progress.range * (1 - PROGRESS_FRACTION)) {
      progress = { time, range };
    } else {
      // Drifting apart is no progress, but closing back in from there is.
      progress = { time: progress.time, range: Math.max(progress.range, range) };
      if (time - progress.time > PATIENCE) pressing = true;
    }
  };

  /**
   * Where to manoeuvre given the reach of its own weapons and the enemy's: nowhere when neither
   * side has a weapon to fight with, and nowhere but where it is when only the enemy has.
   */
  const manoeuvre = (
    ship: OwnShipObservation,
    reach: number,
    enemyReach: number,
  ): ManoeuvreOrder | null => {
    if (reach === 0) {
      return enemyReach > 0 ? { type: 'manoeuvre', goal: 'match-velocity' } : null;
    }
    const approach = APPROACH_FRACTION * ship.deltaV;
    const speed = approach > 0 ? { speed: approach } : {};
    const standoff = STANDOFF_FRACTION * reach;
    return profile.keepsRange && !pressing && standoff > enemyReach
      ? { type: 'manoeuvre', goal: 'hold', range: standoff, ...speed }
      : { type: 'manoeuvre', goal: 'close', range: CLOSE_FRACTION * reach, ...speed };
  };

  /**
   * Missile salvos and defence: a salvo of anti-ship missiles once the enemy is in their reach
   * and none is in flight, held back while enemy missiles are inbound and it has anti-missile
   * missiles to meet them with; and a second anti-missile missile at a nuclear missile that only
   * one is after.
   */
  const missiles = (
    observation: SideObservation,
    enemy: ContactObservation,
    range: number,
    threats: readonly MissileObservation[],
  ): LaunchOrder | null => {
    const ship = observation.ownShip;
    const { weapons } = ship;
    const launchers = weapons.launchers.filter((l) => l.integrity > 0).length;
    if (launchers === 0) return null;
    const antiMissiles = weapons.ammunition.missileDesigns
      .filter((missile) => missile.role === 'anti-missile')
      .reduce((total, missile) => total + missile.missiles, 0);
    if (antiMissiles > 0 && threats.length > 0) {
      const after = (threat: MissileObservation) =>
        weapons.antiMissile.engagements.filter((e) => e.target === threat.id).length;
      const nuclear = threats.find((t) => t.warhead === 'nuclear' && after(t) === 1);
      // Calls off any anti-ship salvo still to go, keeping the launchers free.
      return nuclear
        ? { type: 'launch', target: { munition: nuclear.id }, missiles: 1 }
        : weapons.salvo && typeof weapons.salvo.target === 'string'
          ? { type: 'launch', target: weapons.salvo.target, missiles: 0 }
          : null;
    }
    const inFlight = observation.munitions.some(
      (m) => m.kind === 'missile' && m.attacker === side && m.role === 'anti-ship',
    );
    return range <= missileReachOf(ship) && !inFlight && weapons.salvo === null
      ? { type: 'launch', target: enemy.sideId, missiles: launchers }
      : null;
  };

  /**
   * Near the range it wants, the ship turns its best-armoured section to the enemy instead of
   * steering: its nose at the enemy for the
   * forward section, its tail for the engine section, broadside for the middle. Otherwise it
   * keeps to its manoeuvre.
   */
  const armourTowards = (
    ship: OwnShipObservation,
    enemy: ContactObservation,
    goal: ManoeuvreOrder,
  ): ManoeuvreOrder | AttitudeOrder => {
    if (goal.goal === 'none' || goal.goal === 'match-velocity' || !armoured) return goal;
    const offset = sub(enemy.position, ship.position);
    const range = Math.hypot(offset.x, offset.y, offset.z);
    if (Math.abs(range - goal.range) > SETTLED_BAND * goal.range) return goal;
    switch (armoured.kind) {
      case 'forward':
        return { type: 'attitude', mode: 'enemy' };
      case 'engine':
        return { type: 'attitude', mode: 'away' };
      case 'middle': {
        const [broadside] = perpendiculars(normalize(offset));
        return { type: 'attitude', mode: 'direction', direction: broadside };
      }
    }
  };

  return {
    side,
    decide(observation) {
      const enemy = observation.contacts[0];
      if (observation.outcome || !enemy) return [];
      // It watches all the time, but reconsiders its plan only as often as its skill allows.
      arsenal.watch(observation, enemy);
      if (observation.time < nextDecision - 1e-9) return [];
      nextDecision = observation.time + profile.reconsider;
      const ship = observation.ownShip;
      const range = distance(ship.position, enemy.position);
      notice(observation, range);
      // An enemy launcher whose missiles it has not seen yet it takes to reach as far as its own.
      const enemyReach = arsenal.reach(designMissileReach);
      const threats = missileThreats(observation, side);
      // With nothing else left to fight with, point defence turns on the ship.
      const lastResort = ownReach(ship) === 0 && pointDefenceReach(ship) > 0;
      const reach = lastResort ? pointDefenceReach(ship) : ownReach(ship);
      const fighting = range <= FIGHTING_FRACTION * Math.max(reach, enemyReach);
      const hot =
        ship.heat.temperature >
        (ship.heat.radiatorsDeployed ? RETRACT_TEMPERATURE : DEPLOY_TEMPERATURE);
      const nuclearClose = threats.some(
        (t) => t.warhead === 'nuclear' && timeToClosest(ship, t) < NUCLEAR_WARNING,
      );
      // Its guns hold their slugs until they cannot miss, unless its beams can fire anyway.
      const holdSlugs = gunReach(ship) > 0 && range > Math.max(gunReach(ship), beamReach(ship));
      const weapons: WeaponsOrder = {
        type: 'weapons',
        target: enemy.sideId,
        mode: holdSlugs ? 'hold-fire' : 'fire-freely',
      };
      const radiators: RadiatorsOrder = {
        type: 'radiators',
        deployed: ((profile.managesPower && fighting) || hot) && !nuclearClose,
      };
      const power: PowerOrder = {
        type: 'power',
        priorities: fighting || threats.length > 0 ? COMBAT_PRIORITIES : MANOEUVRE_PRIORITIES,
      };
      const pointDefence: PointDefenceOrder = {
        type: 'point-defence',
        priority: lastResort ? 'missiles-then-ship' : 'missiles',
      };
      const antiMissile: AntiMissileOrder = { type: 'anti-missile', automatic: true };
      // It withdraws once it has nothing left to fight with, or at its reserve; timing it, with
      // some of the reserve to spare while out of the fight.
      const reserve =
        profile.withdrawsEarly && !fighting ? EARLY_WITHDRAWAL * ship.reserve : ship.reserve;
      const leaving = ship.withdrawing || (armed && reach === 0) || ship.deltaV <= reserve;
      // A withdrawing ship takes no other course, and the rules forbid pursuing one.
      const moving = !leaving && !enemy.withdrawing;
      const dodge = moving && profile.predicts ? jink(observation, side, enemy) : null;
      const goal = moving ? manoeuvre(ship, reach, enemyReach) : null;
      // A ship that stops steering is easy for missiles, so it turns its armour only when none is
      // on its way.
      const turning = profile.turnsArmour && threats.length === 0;
      const course = dodge ?? (goal && turning ? armourTowards(ship, enemy, goal) : goal);
      const orders: Order[] = [
        ...(leaving ? [{ type: 'withdraw' } as const] : []),
        weapons,
        pointDefence,
        antiMissile,
        ...(Array.isArray(course) ? course : course ? [course] : []),
        radiators,
        ...(profile.managesPower ? [power] : []),
      ];
      if (profile.managesPower && ship.shields.shields.length > 0) {
        const shields: ShieldsOrder = {
          type: 'shields',
          raised: range <= FIGHTING_FRACTION * arsenal.reachOfKinds(countered),
        };
        orders.push(shields);
      }
      const launch = missiles(observation, enemy, range, threats);
      if (launch) orders.push(launch);
      return orders.filter((order) => !inForce(ship, order));
    },
  };
};
