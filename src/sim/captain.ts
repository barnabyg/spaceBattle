import type {
  ContactObservation,
  MissileObservation,
  OwnShipObservation,
  SideId,
  SideObservation,
  SideSetup,
} from './battle';
import { effectiveRange, USEFUL_INTENSITY } from './beams';
import {
  designComponent,
  designComponents,
  designComponentsOfType,
  missileRole,
  type ComponentType,
  type Design,
  type MountedComponentDesign,
  type ShieldType,
} from './design';
import { ARMOUR } from './armour';
import { WITHDRAWAL_TIME } from './engagement';
import { BASE_TEMPERATURE, OVERHEAT_TEMPERATURE, radiativeLimit } from './heat';
import { missileReach, reachOfDeltaV } from './missile';
import { HULLS, hullLength } from './hull';
import { DODGE_TIME, sureRange } from './kinetic';
import { REPAIR_CAP } from './repair';
import { TIME_STEP } from './time';
import type {
  AntiMissileOrder,
  AttitudeOrder,
  BurnOrder,
  ComponentAddress,
  LaunchOrder,
  ManoeuvreOrder,
  Order,
  PointDefenceOrder,
  PowerOrder,
  RadiatorsOrder,
  RollOrder,
  ShieldsOrder,
  WeaponsOrder,
  WithdrawalReason,
} from './orders';
import type { PowerSystem } from './power';
import { designReach } from './weapons';
import {
  add,
  distance,
  dot,
  length,
  normalize,
  perpendiculars,
  scale,
  sub,
  type Vec3,
  ZERO,
} from './vector';

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
/**
 * A ship that cannot outrange its enemy closes to this fraction of its own reach: close enough
 * that a laser lands at about eleven times the intensity it reaches out to, well above what
 * ablative armour sheds by glowing (see `radiativeLimit`), so it burns through.
 */
const CLOSE_FRACTION = 0.3;
/** Within this multiple of the longer reach a ship is fighting, not just manoeuvring. */
const FIGHTING_FRACTION = 1.05;
/**
 * The speed a ship works up to on its way to the range it wants, as a fraction of its delta-v
 * left: more than the autopilot's own, as the opening ranges are long and battles otherwise drag.
 */
const APPROACH_FRACTION = 0.2;
/** An order-of-magnitude disadvantage calls for an attack run rather than a settled approach. */
const ATTACK_RUN_RATIO = 10;
/** Target closing speed: half the expendable delta-v, leaving room for braking and the reserve. */
const ATTACK_RUN_FRACTION = 0.5;
/**
 * A ship reaching no further than this, m, is short-ranged: rather than settle at a range, it
 * makes firing passes (see `firingPass`). It covers kinetic gunboats, charged particle beams and
 * missile ships, against the longest beams' 90,000–165,000 km.
 */
const SHORT_REACH = 60_000e3;
/** An enemy reaching this many times as far as the ship has it outranged: it makes passes. */
const PASS_RATIO = 1.5;
/**
 * The closing speed a firing pass commits to: this fraction of the delta-v it has to spare above
 * its reserve, enough to build it, turn back once at twice that and keep a little in hand.
 */
const PASS_FRACTION = 0.3;
/** A firing pass coasts once its relative velocity is within this fraction of the pass speed. */
const PASS_TOLERANCE = 0.05;
/**
 * Fraction of the drive's acceleration a firing pass plans to turn back with: the slack keeps the
 * turn well inside the fight.
 */
const PASS_BRAKING = 0.5;
/** Keep the last half of a section's armour for withdrawal from an exposed attack run. */
const ATTACK_RUN_ARMOUR = 0.5;
/** Maximum time a severely outranged ship will knowingly spend crossing beam fire. */
const MAX_BEAM_EXPOSURE = 1_800;
/**
 * A ship that can roll bears beam fire this many times as long (see `RollOrder`): rolling cuts the
 * wear five to ten times close in, and this keeps a margin.
 */
const ROLLING_EXPOSURE_FACTOR = 4;
/** Allow several laser bursts to inform the estimate of damage per second. */
const DAMAGE_RATE_WINDOW = 60;
/** A badly damaged sensor or drive can make an approach untenable. */
const CRITICAL_INTEGRITY = 0.5;
/** Do not burn across the intended course while turning towards it. */
const ATTACK_RUN_ALIGNMENT = Math.cos((3 * Math.PI) / 180);
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
 * The captain dodges a slug that would hit only once it is this close to arriving, s: soon
 * enough to turn across its path and push clear before `DODGE_TIME`.
 */
const DODGE_WINDOW = 3 * DODGE_TIME;
/** Dodging, the captain pushes this many times harder than it needs to, to be sure. */
const DODGE_MARGIN = 2;
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
  weapons.ammunition.slugs > 0 ? reachOf(weapons.kineticGuns, sureRange) : 0;

/**
 * The furthest the ship's working weapons fight from, m: its lasers and particle beams, its
 * kinetic guns while it has slugs left (out to where they cannot be dodged), and its anti-ship
 * missiles while it has some and a launcher. Zero once none is left. Point defence and
 * anti-missile missiles are left out: they are kept for missiles.
 */
const ownReach = (ship: OwnShipObservation): number =>
  Math.max(missileReachOf(ship), beamReach(ship), gunReach(ship));

/**
 * How close the ship must be for its weapons to do the enemy harm, m. Its beams fire out to where
 * they land at `USEFUL_INTENSITY`, but burn armour only where they beat what it sheds by glowing:
 * about half that far against ablative armour, a quarter of the intensity. Taking the armour of
 * the enemy's nose as made out, or ablative until it is, that is its beams' reach scaled by
 * √(I/L). Its guns and missiles reach as they always do.
 */
const biteReach = (ship: OwnShipObservation, enemy: ContactObservation): number => {
  const armour = enemy.sections.find((s) => s.kind === 'forward')?.armour.type ?? 'ablative';
  const scale = Math.min(1, Math.sqrt(USEFUL_INTENSITY / radiativeLimit(armour)));
  return Math.max(missileReachOf(ship), gunReach(ship), scale * beamReach(ship));
};

/** Which damaged parts a captain has repaired first: moving, seeing, turning, then fighting. */
const REPAIR_PRIORITY: Partial<Readonly<Record<ComponentType, number>>> = {
  drive: 0,
  sensor: 1,
  thrusters: 2,
  laser: 3,
  'charged-particle-beam': 3,
  'neutral-particle-beam': 3,
  'kinetic-gun': 3,
  launcher: 3,
  'point-defence': 4,
  reactor: 5,
  radiator: 6,
};

/**
 * The damaged part most worth the crew's repair: one still working but below what a field repair
 * restores (see `REPAIR_CAP`), first by `REPAIR_PRIORITY`, then the most damaged. Null if none.
 */
const repairWorth = (ship: OwnShipObservation): ComponentAddress | null => {
  const candidates = ship.sections.flatMap((section) =>
    [
      ...section.components.map((part, index) => ({ part, mounted: false, index })),
      ...section.mounts.map((part, index) => ({ part, mounted: true, index })),
    ].flatMap(({ part, mounted, index }) =>
      part.integrity > 0 && part.integrity < REPAIR_CAP
        ? [{ section: section.kind, mounted, index, part }]
        : [],
    ),
  );
  const rank = (c: (typeof candidates)[number]) => REPAIR_PRIORITY[c.part.type] ?? 7;
  const best = candidates.sort(
    (a, b) => rank(a) - rank(b) || a.part.integrity - b.part.integrity,
  )[0];
  return best ? { section: best.section, mounted: best.mounted, index: best.index } : null;
};

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
  const reach = (presumedMissileReach: number) => {
    const known = [...mounts.values()].map(({ component }) => component);
    const launcher = known.some((c) => c.type === 'launcher');
    const beam = Math.max(0, ...beamWeapons().map(effectiveRange));
    return {
      beam,
      longest: Math.max(
        beam,
        ...known.map((c) => (c.type === 'kinetic-gun' ? sureRange(c) : 0)),
        launcher || !launcherSeen ? missileReachSeen : 0,
        launcher && missileReachSeen === 0 ? presumedMissileReach : 0,
      ),
    };
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
    case 'roll':
      return ship.rolling === order.rolling;
    case 'repair':
      return order.target === null
        ? ship.repair === null
        : ship.repair !== null &&
            ship.repair.section === order.target.section &&
            ship.repair.mounted === order.target.mounted &&
            ship.repair.index === order.target.index;
    case 'radiators':
      return (
        (ship.heat.radiatorsDeployed || ship.heat.radiatorDeploymentRemaining > 0) ===
        order.deployed
      );
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
 * How far a munition will pass from the ship's path, across its own line of flight, `time`
 * seconds from now if the ship moves with `acceleration`, m.
 */
const missAcross = (
  ship: OwnShipObservation,
  munition: { readonly position: Vec3; readonly velocity: Vec3 },
  time: number,
  acceleration: Vec3,
): number => {
  const drift = sub(munition.velocity, ship.velocity);
  const offset = sub(
    add(sub(munition.position, ship.position), scale(drift, time)),
    scale(acceleration, 0.5 * time * time),
  );
  const path = normalize(drift);
  return length(sub(offset, scale(path, dot(offset, path))));
};

/**
 * The orders that dodge enemy slugs that would hit the ship, whether it coasts or keeps up its
 * present burn, once they are within `DODGE_WINDOW` of arriving but still too far off to hit a
 * ship that moves: it turns across the slugs' path, the way nearest its nose, and pushes just
 * hard enough for them to pass `clearance` metres clear. One push clears every slug fired
 * before it, and the enemy's fire control leads on the ship's acceleration as it sees it when
 * firing, so slugs fired during the push miss once it stops. Waiting until the slugs are close
 * leaves the ship on its course between dodges, rather than turning back and forth at every
 * new slug. None while no such slug is on its way.
 */
const jink = (
  observation: SideObservation,
  side: SideId,
  clearance: number,
  thrust: number,
): [AttitudeOrder, BurnOrder] | null => {
  const ship = observation.ownShip;
  let worst: { need: number; path: Vec3 } | null = null;
  for (const m of observation.munitions) {
    if (m.kind !== 'slug' || m.target !== side) continue;
    const time = timeToClosest(ship, m);
    if (!Number.isFinite(time) || time <= DODGE_TIME || time > DODGE_WINDOW) continue;
    const miss = Math.min(
      missAcross(ship, m, time, ZERO),
      missAcross(ship, m, time, ship.acceleration),
    );
    if (miss >= clearance) continue;
    // The change of velocity across its path that takes it clear in the time left.
    const need = (clearance + miss) / time;
    if (!worst || need > worst.need) worst = { need, path: sub(m.velocity, ship.velocity) };
  }
  if (!worst) return null;
  const path = normalize(worst.path);
  const across = sub(ship.nose, scale(path, dot(ship.nose, path)));
  const direction = length(across) > 0.1 ? normalize(across) : perpendiculars(path)[0];
  const aligned = dot(ship.nose, direction) >= ATTACK_RUN_ALIGNMENT;
  const acceleration = thrust / ship.mass;
  return [
    { type: 'attitude', mode: 'direction', direction },
    {
      type: 'burn',
      throttle: aligned ? 1 : 0,
      duration: aligned ? Math.max(TIME_STEP, (DODGE_MARGIN * worst.need) / acceleration) : 1,
    },
  ];
};

/**
 * The closing speed a firing pass wants `outside` metres outside the fight (negative inside it).
 * Inside, the fastest from which it can turn back before it leaves the fight: it coasts while it
 * turns round (v·t), then brakes (v²/2a), so v = a(√(t² + 2d/a) − t). Outside, the fastest from
 * which it can still slow to that by the time it enters. Unlimited for a ship that cannot turn
 * or push.
 */
const passClosingSpeed = (
  ship: OwnShipObservation,
  driveThrust: number,
  outside: number,
  fight: number,
): number => {
  const a = (PASS_BRAKING * driveThrust * ship.power.driveLimit) / ship.mass;
  const t = ship.turnRoundTime;
  if (!(a > 0) || !Number.isFinite(t)) return Infinity;
  const turnBack = a * (Math.sqrt(t * t + (2 * fight) / a) - t);
  if (outside <= 0) return turnBack;
  // It coasts while it turns round, then slows from v to the turn-back speed over the rest.
  return Math.max(turnBack, Math.sqrt(a * a * t * t + turnBack ** 2 + 2 * a * outside) - a * t);
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
 * while, it gives up on standing off and closes in for good. Medium and high captains make an
 * attack run across a very large range disadvantage, trading a settled arrival for speed and
 * targeting half their expendable delta-v as closing speed. Gunboats also start this way against
 * unresolved arms when far beyond their own reach. Near the range it wants, a highly
 * skilled captain turns its best-armoured section to the enemy, unless enemy missiles are on
 * their way. It never pursues a withdrawing enemy.
 *
 * Withdrawal: it withdraws once an armed ship has nothing left to fight with, or at its reserve
 * (a highly skilled one, out of the fight, with half the reserve again to spare). An attack run
 * is abandoned outside its own reach once any armoured section has half its armour left;
 * withdrawal can still fail under enemy fire. A ship built
 * without weapons stays.
 *
 * Weapons: it targets the enemy and fires its beams freely. It holds its kinetic guns' fire
 * until the enemy is close enough that their slugs arrive before it could dodge them, so as not
 * to throw its slugs away. It launches a salvo of anti-ship missiles, one from each working
 * launcher, whenever the enemy is within their reach, none of them is still in flight and no
 * enemy missile is on its way to it.
 *
 * Power: the drive comes first until its own weapons can engage; incoming missiles still give
 * weapons priority for defence. Firing and keeping distance compete for the same power.
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
  const driveThrust = designComponent(setup.design, 'drive').thrust;
  // A slug passing within the hull's length of its centre would hit it, near enough.
  const clearance = hullLength(HULLS[setup.design.hullSize]);
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
  /** Closing speed chosen on committing to an attack run, m/s; fixed as propellant is spent. */
  let attackSpeed: number | null = null;
  /** Closing speed committed to for firing passes, m/s; null while not making them. */
  let passSpeed: number | null = null;
  let damage: {
    time: number;
    sensor: number;
    drive: number;
    sensorRate: number;
    driveRate: number;
  } | null = null;

  /** Optimistic time to close a gap with available thrust against a coasting target. */
  const timeToClose = (
    ship: OwnShipObservation,
    enemy: ContactObservation,
    gap: number,
  ): number => {
    const sight = normalize(sub(enemy.position, ship.position));
    const closing = dot(sub(ship.velocity, enemy.velocity), sight);
    const acceleration = (driveThrust * ship.power.driveLimit) / ship.mass;
    const speed = closing + Math.sqrt(closing ** 2 + 2 * acceleration * gap);
    return speed > 0 ? (2 * gap) / speed : Infinity;
  };

  /** Estimate whether drive or fire control will fail before the ship can return fire. */
  const approachFails = (
    time: number,
    ship: OwnShipObservation,
    enemy: ContactObservation,
    gap: number,
  ): boolean => {
    const sensor = Math.max(
      0,
      ...ship.sections.flatMap((section) =>
        section.mounts.filter((mount) => mount.type === 'sensor').map((mount) => mount.integrity),
      ),
    );
    // Its drive's units share its thrust equally, so what is left of it is their mean integrity.
    const units = ship.sections.flatMap((section) =>
      section.components.filter((part) => part.type === 'drive').map((part) => part.integrity),
    );
    const drive = units.reduce((total, integrity) => total + integrity, 0) / (units.length || 1);
    const previous = damage;
    const window = previous
      ? Math.max(DAMAGE_RATE_WINDOW, time - previous.time)
      : DAMAGE_RATE_WINDOW;
    const decay = previous ? 1 - (time - previous.time) / window : 0;
    const sensorRate = previous
      ? previous.sensorRate * decay + (previous.sensor - sensor) / window
      : 0;
    const driveRate = previous ? previous.driveRate * decay + (previous.drive - drive) / window : 0;
    damage = { time, sensor, drive, sensorRate, driveRate };

    const untilInRange = timeToClose(ship, enemy, gap);
    return (
      (sensor <= CRITICAL_INTEGRITY && sensorRate > 0 && sensor / sensorRate < untilInRange) ||
      (drive <= CRITICAL_INTEGRITY && driveRate > 0 && drive / driveRate < untilInRange)
    );
  };

  /**
   * A heavily outranged ship must cross the enemy's firing zone quickly. Unlike a settled
   * approach, this accepts a fast pass through its own weapon range instead of braking early.
   * Cancel transverse relative velocity as well as building closing speed, using contact
   * motion alone. The normal manoeuvre takes over in range; the reserve still ends the attack.
   */
  const attackRun = (
    ship: OwnShipObservation,
    enemy: ContactObservation,
    range: number,
    reach: number,
    enemyReach: number,
    enemyBeamReach: number,
  ): [AttitudeOrder, BurnOrder] | null => {
    const distant = range > ATTACK_RUN_RATIO * reach;
    const outmatched = enemyReach > ATTACK_RUN_RATIO * reach;
    const sight = normalize(sub(enemy.position, ship.position));
    const relative = sub(ship.velocity, enemy.velocity);
    // Once on an approach to an outranging beam, build speed before entering its reach.
    const approachingBeamFire =
      enemyBeamReach > reach &&
      (range <= enemyBeamReach ||
        attackSpeed !== null ||
        dot(relative, sight) >= (APPROACH_FRACTION * ship.deltaV) / 2);
    // Gunboats need a short approach regardless of unseen enemy arms. Other designs wait for
    // evidence of a large range disadvantage rather than rushing into unresolved weapons.
    const unknown = enemyReach === 0 && !enemy.fullyResolved;
    const gunboat = reach === gunReach(ship);
    if (
      !profile.predicts ||
      reach === 0 ||
      range <= reach ||
      !(
        outmatched ||
        approachingBeamFire ||
        (unknown && ((distant && gunboat) || attackSpeed !== null))
      )
    ) {
      attackSpeed = null;
      return null;
    }
    attackSpeed ??= ATTACK_RUN_FRACTION * Math.max(0, ship.deltaV - ship.reserve);
    const wanted = sub(scale(sight, attackSpeed), relative);
    const error = Math.hypot(wanted.x, wanted.y, wanted.z);
    // Below 1 m/s of error, coast; otherwise burn only once aligned with the correction.
    const throttle = error > 1 && dot(ship.nose, normalize(wanted)) >= ATTACK_RUN_ALIGNMENT ? 1 : 0;
    return [
      { type: 'attitude', mode: 'direction', direction: error > 1 ? wanted : ship.nose },
      { type: 'burn', throttle, duration: 2 * profile.reconsider },
    ];
  };

  /**
   * A firing pass: rather than brake to a range under fire, turning its engine section to the
   * enemy, the ship builds closing speed straight at the enemy, keeps its nose (and so its
   * forward armour) on it and flies through the closest pass firing, never braking on the way in
   * where either ship can fire. Past the enemy, it turns back nose first for another pass, but only while the delta-v
   * it has to spare above `reserve` covers stopping and building the same speed again; otherwise
   * it withdraws. Given a `fight` (the longer of the two reaches), it passes no faster than it can
   * turn back from before leaving it, slowing to that before it enters, rather than coast far out
   * and spend hours coming back; outranged, it has none, and passes fast to cut its time under
   * fire. Returns the orders, or 'withdraw'.
   */
  const firingPass = (
    ship: OwnShipObservation,
    enemy: ContactObservation,
    reserve: number,
    fight: number | null,
  ): [AttitudeOrder, BurnOrder] | [AttitudeOrder] | 'withdraw' => {
    const offset = sub(enemy.position, ship.position);
    const sight = normalize(offset);
    const relative = sub(ship.velocity, enemy.velocity);
    const spare = Math.max(0, ship.deltaV - reserve);
    passSpeed ??= PASS_FRACTION * spare;
    const range = Math.hypot(offset.x, offset.y, offset.z);
    const wantedClosing =
      fight === null
        ? passSpeed
        : Math.min(passSpeed, passClosingSpeed(ship, driveThrust, range - fight, fight));
    const closing = dot(relative, sight);
    const speed = Math.hypot(relative.x, relative.y, relative.z);
    // Drawing apart after a pass, it turns back only if it can afford another.
    if (closing < 0 && spare < speed + wantedClosing) return 'withdraw';
    const wanted = sub(scale(sight, wantedClosing), relative);
    const error = Math.hypot(wanted.x, wanted.y, wanted.z);
    // Close enough to the pass speed, it coasts with its nose on the enemy.
    if (error <= PASS_TOLERANCE * wantedClosing) return [{ type: 'attitude', mode: 'enemy' }];
    const throttle = dot(ship.nose, normalize(wanted)) >= ATTACK_RUN_ALIGNMENT ? 1 : 0;
    return [
      { type: 'attitude', mode: 'direction', direction: wanted },
      { type: 'burn', throttle, duration: 2 * profile.reconsider },
    ];
  };

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
      const { longest: enemyReach, beam: enemyBeamReach } = arsenal.reach(designMissileReach);
      const threats = missileThreats(observation, side);
      // With nothing else left to fight with, point defence turns on the ship.
      const lastResort = ownReach(ship) === 0 && pointDefenceReach(ship) > 0;
      const reach = lastResort ? pointDefenceReach(ship) : ownReach(ship);
      const fighting = range <= FIGHTING_FRACTION * Math.max(reach, enemyReach);
      const canAttack = range <= FIGHTING_FRACTION * reach;
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
      // Short-ranged or outranged, a captain who predicts makes firing passes when it must close;
      // a highly skilled one makes them whenever it must close, rather than brake under fire.
      const holding = profile.keepsRange && !pressing && STANDOFF_FRACTION * reach > enemyReach;
      const passing =
        profile.predicts &&
        !lastResort &&
        reach > 0 &&
        !holding &&
        (profile.turnsArmour || reach <= SHORT_REACH || enemyReach >= PASS_RATIO * reach);
      if (!passing) passSpeed = null;
      // Making passes, it keeps its radiators in, out of the enemy's fire, unless it runs hot.
      const radiators: RadiatorsOrder = {
        type: 'radiators',
        deployed: ((profile.managesPower && fighting && !passing) || hot) && !nuclearClose,
      };
      const power: PowerOrder = {
        type: 'power',
        priorities: canAttack || threats.length > 0 ? COMBAT_PRIORITIES : MANOEUVRE_PRIORITIES,
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
      const underFire = observation.events.some(
        (event) => (event.type === 'hit' || event.type === 'impact') && event.target === side,
      );
      const crossingBeamFire = profile.predicts && range > reach && range <= enemyBeamReach;
      if (!crossingBeamFire) damage = null;
      const failingApproach =
        crossingBeamFire && approachFails(observation.time, ship, enemy, range - reach);
      // The enemy's beams wear its nose only where they beat what that armour sheds by glowing;
      // further out they only heat it. Rolling, it can bear several times as long under them.
      const nose = ship.sections.find((section) => section.kind === 'forward')?.armour.type;
      const enemyBurnReach =
        enemyBeamReach * Math.min(1, Math.sqrt(USEFUL_INTENSITY / radiativeLimit(nose ?? 'heavy')));
      const canRoll = ship.sections.some((section) =>
        section.components.some((part) => part.type === 'thrusters' && part.integrity > 0),
      );
      const bearable = (canRoll ? ROLLING_EXPOSURE_FACTOR : 1) * MAX_BEAM_EXPOSURE;
      const untenable =
        profile.predicts &&
        reach > 0 &&
        !enemy.withdrawing &&
        range > enemyReach &&
        enemyBurnReach > ATTACK_RUN_RATIO * reach &&
        timeToClose(ship, enemy, enemyBurnReach - reach) > bearable;
      const exposed =
        range > reach &&
        (attackSpeed !== null || passSpeed !== null) &&
        timeToClose(ship, enemy, range - reach) > WITHDRAWAL_TIME &&
        (enemyReach > ATTACK_RUN_RATIO * reach || (enemyReach === 0 && underFire)) &&
        ship.sections.some(
          (section) =>
            section.armour.thickness > 0 &&
            section.armour.remaining <= ATTACK_RUN_ARMOUR * section.armour.thickness,
        );
      const pass =
        passing && !ship.withdrawing && !enemy.withdrawing
          ? firingPass(
              ship,
              enemy,
              reserve,
              enemyReach >= PASS_RATIO * reach ? null : Math.max(reach, enemyReach),
            )
          : null;
      // Adrift, it cannot withdraw: it fights on as it drifts.
      const leaving =
        ship.withdrawing ||
        (!ship.adrift &&
          (pass === 'withdraw' ||
            untenable ||
            failingApproach ||
            exposed ||
            (armed && reach === 0) ||
            ship.deltaV <= reserve));
      /** The first of the reasons to leave that holds, as the captain gives it. */
      const withdrawalReason = (): WithdrawalReason =>
        armed && reach === 0
          ? 'disarmed'
          : ship.deltaV <= reserve
            ? 'reserve'
            : pass === 'withdraw'
              ? 'no-pass'
              : exposed
                ? 'armour-worn'
                : failingApproach
                  ? 'failing'
                  : untenable
                    ? 'outranged'
                    : 'ordered';
      // A withdrawing ship takes no other course, and the rules forbid pursuing one.
      const moving = !leaving && !enemy.withdrawing;
      const dodge =
        moving && profile.predicts ? jink(observation, side, clearance, driveThrust) : null;
      // Across a very large disadvantage, an attack run builds speed faster than a pass would;
      // inside its own reach the pass takes over, and it does not brake.
      const attack = moving
        ? attackRun(ship, enemy, range, reach, enemyReach, enemyBeamReach)
        : null;
      const passOrders = moving && Array.isArray(pass) ? pass : null;
      const goal = moving ? manoeuvre(ship, reach, enemyReach) : null;
      // A ship that stops steering is easy for missiles, so it turns its armour only when none is
      // on its way.
      const turning = profile.turnsArmour && threats.length === 0;
      const course =
        dodge ??
        attack ??
        passOrders ??
        (goal && turning ? armourTowards(ship, enemy, goal) : goal);
      const orders: Order[] = [
        ...(leaving ? [{ type: 'withdraw', reason: withdrawalReason() } as const] : []),
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
      // Under beam fire it cannot answer yet, it rolls to spread the beam's heat around its armour;
      // within its own reach it stops, so its own beams bear in full.
      const thrusters = ship.sections.some((section) =>
        section.components.some((part) => part.type === 'thrusters' && part.integrity > 0),
      );
      const roll: RollOrder = {
        type: 'roll',
        rolling:
          profile.predicts &&
          thrusters &&
          range > biteReach(ship, enemy) &&
          ship.appearance.beamsLanding.length > 0,
      };
      orders.push(roll);
      // Medium and high captains set the crew to repair what matters most, one part at a time.
      if (profile.managesPower && ship.repair === null) {
        const fix = repairWorth(ship);
        if (fix) orders.push({ type: 'repair', target: fix });
      }
      const launch = missiles(observation, enemy, range, threats);
      if (launch) orders.push(launch);
      return orders.filter((order) => !inForce(ship, order));
    },
  };
};
