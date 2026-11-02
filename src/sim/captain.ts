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
  type ShieldType,
} from './design';
import { BASE_TEMPERATURE, OVERHEAT_TEMPERATURE } from './heat';
import { missileReach } from './missile';
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
import { cross, distance, dot, normalize, scale, sub, vec3, type Vec3 } from './vector';

/**
 * A side's commander as the battle sees it: it decides on orders from what its side observes,
 * and may remember what it saw before. It never touches the ship itself.
 */
export interface Captain {
  readonly side: SideId;
  /** The orders to give now; none when the standing orders already do what it wants. */
  decide(observation: SideObservation): readonly Order[];
}

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

/**
 * How far the enemy's weapons that a design's shields counter reach, m; zero when its shields
 * counter none of them, or it has none.
 */
const counteredReach = (own: Design, enemies: readonly SideSetup[]): number => {
  const shields = new Set(
    designComponents(own).flatMap(({ component }) =>
      component.type === 'magnetic-shield' || component.type === 'coolant-shield'
        ? [COUNTERED[component.type]]
        : [],
    ),
  );
  return Math.max(
    0,
    ...enemies.flatMap((enemy) =>
      [...shields].flatMap((type) =>
        designComponentsOfType(enemy.design, type).map(effectiveRange),
      ),
    ),
  );
};

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

/** How far the ship's working lasers and particle beams fire, m; zero without any. */
const beamReach = ({ weapons }: OwnShipObservation): number =>
  Math.max(
    0,
    ...[...weapons.lasers, ...weapons.particleBeams]
      .filter((weapon) => weapon.integrity > 0)
      .map((weapon) => weapon.effectiveRange),
  );

/** How close its working kinetic guns need the enemy to hit it for sure while it has slugs, m. */
const gunReach = ({ weapons }: OwnShipObservation): number =>
  weapons.ammunition.slugs > 0
    ? Math.max(
        0,
        ...weapons.kineticGuns
          .filter((gun) => gun.integrity > 0)
          .map((gun) => sureRange(gun.muzzleVelocity)),
      )
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
  weapons.ammunition.rounds > 0
    ? Math.max(
        0,
        ...weapons.pointDefence.filter((gun) => gun.integrity > 0).map((gun) => gun.effectiveRange),
      )
    : 0;

/**
 * What the captain makes of the enemy's arms: it knows the enemy's design, sees which of its
 * mounts are wrecked, and counts the slugs and missiles it has seen the enemy fire.
 */
const enemyArsenal = (enemy: SideSetup) => {
  const slugsCarried = designComponentsOfType(enemy.design, 'magazine').reduce(
    (total, magazine) => total + magazine.slugs,
    0,
  );
  const missilesCarried = new Map<string, number>();
  for (const magazine of designComponentsOfType(enemy.design, 'magazine')) {
    if (magazine.missile) {
      const { name } = magazine.missile;
      missilesCarried.set(name, (missilesCarried.get(name) ?? 0) + magazine.missiles);
    }
  }
  const slugsSeen = new Set<number>();
  const missilesSeen = new Map<string, Set<number>>();

  /** Notes the enemy's slugs and missiles in flight. */
  const watch = (observation: SideObservation) => {
    for (const munition of observation.munitions) {
      if (munition.attacker !== enemy.id) continue;
      if (munition.kind === 'slug') slugsSeen.add(munition.id);
      else {
        const seen = missilesSeen.get(munition.name) ?? new Set<number>();
        seen.add(munition.id);
        missilesSeen.set(munition.name, seen);
      }
    }
  };

  /**
   * How far the enemy's weapons can still hurt the ship, m: its intact beam weapons, its intact
   * kinetic guns out to where their slugs cannot be dodged while it may have slugs left, and its
   * anti-ship missiles while it has an intact launcher and may have some left.
   */
  const reach = (contact: ContactObservation): number => {
    const intact = new Set(
      contact.appearance.parts.flatMap((part) =>
        part.mount === null ? [] : [`${part.section}/${String(part.mount)}`],
      ),
    );
    const mounted = enemy.design.sections.flatMap((section) =>
      section.mounts.flatMap((component, i) =>
        intact.has(`${section.kind}/${String(i)}`) ? [component] : [],
      ),
    );
    const slugsLeft = slugsSeen.size < slugsCarried;
    const launcher = mounted.some((component) => component.type === 'launcher');
    return Math.max(
      0,
      ...mounted.map((component) => {
        switch (component.type) {
          case 'laser':
          case 'charged-particle-beam':
          case 'neutral-particle-beam':
            return effectiveRange(component);
          case 'kinetic-gun':
            return slugsLeft ? sureRange(component.muzzleVelocity) : 0;
          default:
            return 0;
        }
      }),
      ...(launcher
        ? designComponentsOfType(enemy.design, 'magazine').flatMap(({ missile }) =>
            missile &&
            missileRole(missile) === 'anti-ship' &&
            (missilesSeen.get(missile.name)?.size ?? 0) < (missilesCarried.get(missile.name) ?? 0)
              ? [missileReach(missile)]
              : [],
          )
        : []),
    );
  };

  return { watch, reach };
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
  const reference = Math.abs(sight.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  const across = normalize(cross(sight, reference));
  const other = cross(sight, across);
  const directions = [across, other, scale(across, -1), scale(other, -1)];
  const direction =
    directions[Math.floor(observation.time / JINK_PERIOD) % directions.length] ?? across;
  return [
    { type: 'attitude', mode: 'direction', direction },
    { type: 'burn', throttle: 1, duration: 2 * JINK_PERIOD },
  ];
};

/**
 * A basic computer captain for one side. It knows the designs in the battle, so it knows how far
 * the enemy's weapons reach (contacts show every detail until sensors arrive), and otherwise
 * decides only from its side's observations: it sees which enemy mounts are wrecked and counts
 * the slugs and missiles the enemy fires, so it knows when a weapon of the enemy's is spent.
 *
 * Range: if it outranges the enemy it holds just inside its own reach, out of the enemy's;
 * otherwise it closes to where its weapons bite hard. It heads there at a fifth of its delta-v,
 * as the opening ranges are long. If neither side fires and the range stops shrinking for a
 * while, it gives up on standing off and closes in for good. With nothing left to fight with, it
 * stops where it is: there is no withdrawing yet.
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
export const createComputerCaptain = (side: SideId, sides: readonly SideSetup[]): Captain => {
  const enemies = sides.filter((s) => s.id !== side);
  const enemySetup = enemies[0];
  const arsenal = enemySetup ? enemyArsenal(enemySetup) : null;
  const own = sides.find((s) => s.id === side)?.design;
  const shieldedReach = own ? counteredReach(own, enemies) : 0;
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
    return !pressing && standoff > enemyReach
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

  return {
    side,
    decide(observation) {
      const enemy = observation.contacts[0];
      if (observation.outcome || !enemy) return [];
      arsenal?.watch(observation);
      const ship = observation.ownShip;
      const range = distance(ship.position, enemy.position);
      notice(observation, range);
      const enemyReach = arsenal?.reach(enemy) ?? 0;
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
        deployed: (fighting || hot) && !nuclearClose,
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
      const dodge = jink(observation, side, enemy);
      const course = dodge ?? manoeuvre(ship, reach, enemyReach);
      const orders: Order[] = [
        weapons,
        pointDefence,
        antiMissile,
        ...(Array.isArray(course) ? course : course ? [course] : []),
        radiators,
        power,
      ];
      if (ship.shields.shields.length > 0) {
        const shields: ShieldsOrder = {
          type: 'shields',
          raised: range <= FIGHTING_FRACTION * shieldedReach,
        };
        orders.push(shields);
      }
      const launch = missiles(observation, enemy, range, threats);
      if (launch) orders.push(launch);
      return orders.filter((order) => !inForce(ship, order));
    },
  };
};
