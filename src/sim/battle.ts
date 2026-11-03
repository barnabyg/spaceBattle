import { incomingMissiles } from './antiMissile';
import { componentSlots } from './components';
import { overheat, strike, type DamageContext } from './damage';
import {
  missileRole,
  SECTION_KINDS,
  type Design,
  type MissileRole,
  type SectionKind,
} from './design';
import { pursuitRefused, WITHDRAWAL_TIME, withdrawingRefused } from './engagement';
import { involves, type BattleEvent, type HitEvent } from './events';
import {
  manoeuvreCommand,
  manoeuvreThrottle,
  type ManoeuvreCommand,
  type ContactMotion,
} from './manoeuvre';
import { motionOf, type Motion, type Slug } from './kinetic';
import { guideMissile, targetsMissile, type Missile, type MissileTarget } from './missile';
import { createMunitions, targetOfMunitions, type Departures } from './munitions';
import {
  antiMissileEngagements,
  observeContact,
  observeMunitions,
  observeOwnShip,
  type BeamLanding,
  type ImpactLanding,
  type SideObservation,
} from './observation';
import {
  POINT_DEFENCE_PRIORITIES,
  type AimPoint,
  type LaunchOrder,
  type Order,
  type PointDefencePriority,
} from './orders';
import type { PointDefenceEngagement, Threat } from './pointDefence';
import { POWER_SYSTEMS, settlePowerAndHeat } from './power';
import { endedBy, judge, lossOf, noResult, type BattleOutcome } from './outcome';
import { conjugate, IDENTITY, rotate, type Quat } from './quaternion';
import { createRandom, type Random } from './random';
import { perceive, sensorPower, type ContactDetail } from './sensors';
import { burn, createShip, fireDrive, noseOf, steer, type ShipState } from './ship';
import { TIME_STEP } from './time';
import {
  add,
  cross,
  distance,
  dot,
  length,
  normalize,
  scale,
  sub,
  vec3,
  ZERO,
  type Vec3,
} from './vector';
import {
  aimWeapons,
  designMissiles,
  emitBeams,
  fireKineticGuns,
  firePointDefence,
  launchMissiles,
  missilesLeft,
  type Beam,
  type PointDefenceBurst,
  type PointDefenceTargets,
  type Salvo,
  workingReach,
} from './weapons';

export { TIME_STEP };
export type {
  AimPoint,
  BattleEvent,
  BattleOutcome,
  ContactDetail,
  MissileRole,
  MissileTarget,
  PointDefenceEngagement,
  PointDefencePriority,
};
export type {
  AmmunitionObservation,
  AntiMissileEngagement,
  AntiMissileObservation,
  BeamLanding,
  BeamWeaponObservation,
  ComponentObservation,
  ContactAppearance,
  ContactMountObservation,
  ContactObservation,
  ContactSectionObservation,
  HeatObservation,
  ImpactLanding,
  KineticGunObservation,
  LaserObservation,
  LauncherObservation,
  MissileDesignObservation,
  MissileObservation,
  MunitionObservation,
  OwnShipObservation,
  ParticleBeamObservation,
  PointDefenceObservation,
  PowerObservation,
  SectionObservation,
  ShieldObservation,
  ShieldsObservation,
  ShipAppearance,
  SideObservation,
  SlugObservation,
  WeaponsObservation,
} from './observation';

export type SideId = string;
export type Commander = 'player' | 'computer';

export interface SideSetup {
  readonly id: SideId;
  readonly name: string;
  readonly commander: Commander;
  readonly design: Design;
}

/** Where each side's ship starts, in the same order as the battle's sides. */
export interface ShipStart {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Body frame to world; the identity points the nose along +x. */
  readonly orientation?: Quat;
}

export interface Scenario {
  readonly name: string;
  readonly starts: readonly ShipStart[];
}

export interface BattleSetup {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly sides: readonly SideSetup[];
  /**
   * Test mode only: once this much simulated time has passed without a side losing, the battle
   * ends with no result, s. A battle normally has no time limit.
   */
  readonly timeLimit?: number;
}

export interface Battle {
  readonly sides: readonly SideSetup[];
  /** Simulated seconds since the battle began. */
  readonly time: number;
  /**
   * How the battle ended, or null while it goes on. Once it has ended the battle is frozen:
   * time stops, steps do nothing and return no events, and orders are ignored.
   */
  readonly outcome: BattleOutcome | null;
  /** Gives an order to a side's ship; it takes effect from the next step. */
  giveOrder(sideId: SideId, order: Order): void;
  /**
   * Advances the battle by one fixed time step, returning what happened in it. A step in which
   * a ship loses ends the battle, with a 'battle-ended' event last.
   */
  step(): readonly BattleEvent[];
  /** Advances the battle by whole time steps covering `seconds`, returning what happened. */
  advance(seconds: number): readonly BattleEvent[];
  /** What one side knows about the battle. */
  observe(sideId: SideId): SideObservation;
  /**
   * A side chooses "End battle", ending it at once: a forfeit for a player side, no result
   * between computer sides (see `endedBy`). Returns the 'battle-ended' event, or nothing if the
   * battle was already over.
   */
  endBattle(sideId: SideId): readonly BattleEvent[];
}

interface Combatant {
  readonly side: SideSetup;
  readonly ship: ShipState;
  /** Beams that landed on the ship in the last step. */
  beamsLanding: BeamLanding[];
  /** Slugs and missiles that struck the ship in the last step. */
  impacts: ImpactLanding[];
  /** Whether it has withdrawn: left the battle by withdrawal. */
  withdrawn: boolean;
}

/**
 * The battle as it was at the start of a step, which fire control, missile guidance and missile
 * defence work from.
 */
interface Snapshot {
  /** Each ship's motion, by side. */
  readonly motions: ReadonlyMap<SideId, Motion>;
  /** Each missile's motion, by id. */
  readonly missileMotions: ReadonlyMap<number, Motion>;
  /** The ids of the incoming missiles each side's automatic defence launches at. */
  readonly defence: ReadonlyMap<SideId, readonly number[]>;
  /** What each side's point defence may fire on. */
  readonly pointDefenceTargets: ReadonlyMap<SideId, PointDefenceTargets>;
}

/** Where a ship will point in a step, and what its autopilot commands if it has a manoeuvre. */
interface Plan {
  readonly heading: Vec3 | null;
  readonly command: ManoeuvreCommand | null;
}

const checkOrder = (order: Order): Order => {
  switch (order.type) {
    case 'burn':
      if (!(order.throttle >= 0 && order.throttle <= 1)) throw new Error('Throttle must be 0–1');
      if (!(order.duration >= 0 && Number.isFinite(order.duration))) {
        throw new Error('Burn duration must be a non-negative number of seconds');
      }
      return order;
    case 'attitude':
      if (order.mode !== 'direction') return order;
      if (!(length(order.direction) > 0)) {
        throw new Error('An attitude direction needs a length');
      }
      return { ...order, direction: normalize(order.direction) };
    case 'manoeuvre':
      if (order.goal === 'none' || order.goal === 'match-velocity') return order;
      if (!(order.range > 0 && Number.isFinite(order.range))) {
        throw new Error('A manoeuvre range must be a positive number of metres');
      }
      if (order.speed !== undefined && !(order.speed > 0 && Number.isFinite(order.speed))) {
        throw new Error('A manoeuvre speed must be a positive number of metres per second');
      }
      return order;
    case 'power': {
      const { priorities } = order;
      const complete =
        priorities.length === POWER_SYSTEMS.length &&
        POWER_SYSTEMS.every((system) => priorities.includes(system));
      if (!complete) {
        throw new Error(`A power order must rank each of ${POWER_SYSTEMS.join(', ')} once`);
      }
      return { ...order, priorities: [...priorities] };
    }
    case 'launch':
      if (!(Number.isInteger(order.missiles) && order.missiles >= 0)) {
        throw new Error('A launch order needs a whole, non-negative number of missiles');
      }
      if (order.missile !== undefined && !(typeof order.missile === 'string' && order.missile)) {
        throw new Error("A launch order's missile must be the name of a missile design");
      }
      return order;
    case 'point-defence':
      if (!POINT_DEFENCE_PRIORITIES.includes(order.priority)) {
        throw new Error(
          `A point defence order needs one of ${POINT_DEFENCE_PRIORITIES.join(', ')}`,
        );
      }
      return order;
    case 'weapons': {
      const { aim } = order;
      if (aim === undefined) return order;
      const mount = aim.mount;
      if (
        !SECTION_KINDS.includes(aim.section) ||
        (mount !== null && !(Number.isInteger(mount) && mount >= 0))
      ) {
        throw new Error('An aim point needs a section and a mount number or null');
      }
      return order;
    }
    case 'anti-missile':
    case 'radiators':
    case 'shields':
    case 'withdraw':
      return order;
  }
};

/** A withdrawing ship burns once its nose is within this angle of away from the enemy (cosine). */
const WITHDRAWAL_ALIGNMENT = Math.cos((10 * Math.PI) / 180);
/** How many recent events each side's observation keeps. */
const EVENT_LOG_LENGTH = 20;
/** Mixed into the battle's seed for the errors in fire control's tracks, kept apart from the rest. */
const TRACKING_SEED = 0x9e3779b9;

/** A draw from the standard normal distribution (Box–Muller). */
const normal = (random: Random): number =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

/** The middle of a part's box. */
const centreOf = (part: { readonly min: Vec3; readonly max: Vec3 }): Vec3 =>
  scale(add(part.min, part.max), 0.5);

/** Where fire control aims at a target this step. */
interface Aim {
  /** In the target's body frame, m. */
  readonly body: Vec3;
  /** From the target's centre of mass, in world axes, m. */
  readonly world: Vec3;
}

export const createBattle = (setup: BattleSetup): Battle => {
  if (setup.sides.length !== setup.scenario.starts.length) {
    throw new Error('A scenario needs one start for each side');
  }
  const { timeLimit } = setup;
  if (timeLimit !== undefined && !(timeLimit > 0 && Number.isFinite(timeLimit))) {
    throw new Error('A time limit must be a positive number of seconds');
  }
  const combatants: Combatant[] = setup.sides.map((side, i) => {
    const start = setup.scenario.starts[i];
    if (!start) throw new Error(`No start for side ${side.id}`);
    return {
      side,
      ship: createShip(side.design, start.position, start.velocity, start.orientation ?? IDENTITY),
      beamsLanding: [],
      impacts: [],
      withdrawn: false,
    };
  });
  let steps = 0;
  const random = createRandom(setup.seed);
  // Fire control's tracking errors draw on their own sequence, so they leave every other chance
  // in the battle as it would be without them.
  const tracking = createRandom((setup.seed ^ TRACKING_SEED) >>> 0);
  /** Beams on their way to their targets, in the order fired. */
  let beams: Beam[] = [];
  /** Slugs in flight, in the order fired. */
  let slugs: Slug[] = [];
  /** Missiles in flight, in the order launched. */
  let missiles: Missile[] = [];
  /** Point defence bursts on their way to their targets, in the order fired. */
  let bursts: PointDefenceBurst[] = [];
  let munitionsFired = 0;
  const nextMunitionId = () => ++munitionsFired;
  /** Where the launcher that launched each missile is. */
  const launchedFrom = new Map<number, { section: SectionKind; mount: number }>();
  const munitions = createMunitions(combatants, launchedFrom);
  const logs = new Map<SideId, BattleEvent[]>(setup.sides.map((side) => [side.id, []]));
  let outcome: BattleOutcome | null = null;
  /** Events from orders given since the last step, reported with that step's. */
  let pending: BattleEvent[] = [];

  /** Keeps each side's latest events about it. */
  const record = (events: readonly BattleEvent[]) => {
    for (const [side, log] of logs) {
      log.push(...events.filter((event) => involves(event, side)));
      log.splice(0, Math.max(0, log.length - EVENT_LOG_LENGTH));
    }
  };

  const combatantOf = (sideId: SideId): Combatant => {
    const combatant = combatants.find((c) => c.side.id === sideId);
    if (!combatant) throw new Error(`Unknown side ${sideId}`);
    return combatant;
  };
  const enemyOf = (combatant: Combatant): Combatant | undefined =>
    combatants.find((c) => c !== combatant);

  const attitudeTarget = (combatant: Combatant): Vec3 | null => {
    const { ship } = combatant;
    const order = ship.attitude;
    if (!order) return null;
    if (order.mode === 'direction') return order.direction;
    const enemy = enemyOf(combatant);
    if (!enemy) return null;
    const towards = normalize(sub(enemy.ship.position, ship.position));
    return order.mode === 'enemy' ? towards : scale(towards, -1);
  };

  /** What the ship knows of the enemy for its autopilot: the contact's position and velocity. */
  const contactOf = (combatant: Combatant): ContactMotion | null => {
    const enemy = enemyOf(combatant);
    return enemy ? { position: enemy.ship.position, velocity: enemy.ship.velocity } : null;
  };

  /** The ship a side's weapons are ordered to fire at, if any. */
  const targetOf = (combatant: Combatant): Combatant | undefined => {
    const id = combatant.ship.weapons.target;
    return id === null ? undefined : combatants.find((c) => c.side.id === id);
  };

  /** The part of a target a ship's sensors make out to aim at, if they make it out now. */
  const aimablePart = (ship: ShipState, target: ShipState, aim: AimPoint) =>
    perceive(sensorPower(ship), target, distance(ship.position, target.position)).parts.find(
      (part) => part.section === aim.section && part.mount === aim.mount,
    );

  /**
   * Where fire control aims at its target this step: the middle of the part the captain aims at
   * while the sensors make it out, or else the centre of mass, thrown off across the line of
   * sight by the error in the sensors' track of the target (see `SensorDesign.trackingError`).
   */
  const aimAt = ({ ship }: Combatant, target: Combatant): Aim => {
    const { aim } = ship.weapons;
    const part = aim ? aimablePart(ship, target.ship, aim) : undefined;
    const aimed = part ? centreOf(part) : ZERO;
    const offset = sub(target.ship.position, ship.position);
    const sight = normalize(offset);
    const reference = Math.abs(sight.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    const across = normalize(cross(sight, reference));
    const other = cross(sight, across);
    const spread = sensorPower(ship).trackingError * length(offset);
    const error = add(
      scale(across, spread * normal(tracking)),
      scale(other, spread * normal(tracking)),
    );
    const { orientation } = target.ship;
    return {
      body: add(aimed, rotate(conjugate(orientation), error)),
      world: add(rotate(orientation, aimed), error),
    };
  };

  /** Whether a missile's target is still in the battle: a ship, or a missile in flight. */
  const inBattle = (target: MissileTarget): boolean =>
    targetsMissile(target)
      ? missiles.some((m) => m.id === target.munition)
      : combatants.some((c) => c.side.id === target);

  /**
   * The salvo a launch order sets going, checking that the ship can carry it out: an anti-ship
   * missile at an enemy ship, or an anti-missile missile at an enemy missile in flight aimed at a
   * ship. The missile design is the one named, or else the first of the right kind, preferring
   * one with missiles left.
   */
  const salvoOf = (sideId: SideId, order: LaunchOrder): Salvo | null => {
    const { ship } = combatantOf(sideId);
    const { target } = order;
    if (order.missiles === 0) return null;
    let role: MissileRole = 'anti-ship';
    if (targetsMissile(target)) {
      const missile = missiles.find((m) => m.id === target.munition);
      if (!missile || missile.attacker === sideId || targetsMissile(missile.target)) {
        throw new Error('An anti-missile missile must be launched at an enemy missile in flight');
      }
      role = 'anti-missile';
    } else if (combatantOf(target).side.id === sideId) {
      throw new Error('A ship cannot launch at itself');
    }
    const carried = designMissiles(ship.design).filter((m) => missileRole(m) === role);
    const design =
      order.missile === undefined
        ? (carried.find((m) => missilesLeft(ship, m.name) > 0) ?? carried[0])
        : carried.find((m) => m.name === order.missile);
    if (!design) {
      throw new Error(
        order.missile === undefined
          ? `The ship carries no ${role} missiles`
          : `The ship carries no ${role} missile named "${order.missile}"`,
      );
    }
    return { target, remaining: order.missiles, missile: design.name };
  };

  /** A beam arriving: it strikes the target, and the attacker learns of a new hit. */
  const resolveBeam = (beam: Beam, ctx: Omit<DamageContext, 'side'>) => {
    const target = combatantOf(beam.target);
    const attacker = combatantOf(beam.attacker).ship;
    const landed = strike(target.ship, beam, { ...ctx, side: beam.target });
    if (landed && landed.power > 0) {
      const { point, power, spotRadius } = landed;
      target.beamsLanding.push({ attack: beam.attack, point, power, spotRadius });
    }
    const part = landed
      ? landed.part.mount === null
        ? landed.part.section
        : `${landed.part.section}/${String(landed.part.mount)}`
      : null;
    const emitter = attacker.weapons.beamWeapons[beam.emitter];
    if (!emitter) return;
    if (landed && part && (!beam.continuing || emitter.striking !== part)) {
      const hit: HitEvent = {
        type: 'hit',
        time: ctx.time,
        attacker: beam.attacker,
        target: beam.target,
        attack: beam.attack,
        section: landed.part.section,
        mount: landed.part.mount,
        power: landed.power,
        deflected: landed.deflected,
        absorbed: landed.absorbed,
        intensity: landed.intensity,
        spotRadius: landed.spotRadius,
        range: beam.range,
      };
      ctx.events.push(hit);
      attacker.weapons = { ...attacker.weapons, lastHit: hit };
    }
    attacker.weapons = {
      ...attacker.weapons,
      beamWeapons: attacker.weapons.beamWeapons.map((w, i) =>
        i === beam.emitter ? { ...w, striking: part } : w,
      ),
    };
  };

  /**
   * The battle as it was at the start of the step. Fire control, missile guidance and missile
   * defence all work from it, so the order of sides never matters.
   */
  const snapshot = (): Snapshot => {
    const motions = new Map<SideId, Motion>(
      combatants.map(({ side, ship }) => [side.id, motionOf(ship)]),
    );
    const missileMotions = new Map<number, Motion>(missiles.map((m) => [m.id, motionOf(m)]));
    // Automatic defence launches at each incoming missile none of the ship's anti-missile
    // missiles is after yet.
    const defence = new Map<SideId, number[]>(
      combatants.map((c) => {
        if (!c.ship.weapons.automaticDefence || missiles.length === 0) return [c.side.id, []];
        const engaged = new Set(
          missiles.flatMap(({ attacker, target }) =>
            attacker === c.side.id && targetsMissile(target) ? [target.munition] : [],
          ),
        );
        const reach = targetOfMunitions(c.ship).reach;
        const incoming = incomingMissiles(c.side.id, c.ship, missiles, reach);
        return [c.side.id, incoming.flatMap((m) => (engaged.has(m.id) ? [] : [m.id]))];
      }),
    );
    // Point defence sees the missiles aimed at its ship and its target; it leaves anti-missile
    // missiles, which threaten only missiles, alone.
    const pointDefenceTargets = new Map<SideId, PointDefenceTargets>(
      combatants.map((c) => {
        const target = targetOf(c);
        const motion = target && motions.get(target.side.id);
        const threats = missiles.flatMap((m): Threat[] =>
          m.target !== c.side.id ? [] : [{ id: m.id, design: m.design, motion: motionOf(m) }],
        );
        return [
          c.side.id,
          { threats, ship: target && motion ? { id: target.side.id, motion } : null },
        ];
      }),
    );
    return { motions, missileMotions, defence, pointDefenceTargets };
  };

  /** Weapons choose whether to fire first, so the drive knows what power they will ask for. */
  const aim = (seen: Snapshot) => {
    combatants.forEach((c) => {
      const target = targetOf(c);
      aimWeapons(
        c.ship,
        target ? distance(c.ship.position, target.ship.position) : null,
        seen.pointDefenceTargets.get(c.side.id),
      );
    });
  };

  /**
   * Where a ship will point and what its autopilot commands, if it has a manoeuvre. Every ship
   * plans before any steers, from the same positions, so the order of sides never matters.
   */
  const plan = (c: Combatant): Plan => {
    if (c.ship.withdrawingSince !== null) {
      const enemy = enemyOf(c);
      return {
        heading: enemy ? normalize(sub(c.ship.position, enemy.ship.position)) : null,
        command: null,
      };
    }
    const state = c.ship.manoeuvre;
    if (!state) return { heading: attitudeTarget(c), command: null };
    const command = manoeuvreCommand(c.ship, state, contactOf(c));
    return { heading: command.heading, command };
  };

  /** A ship steers and fires its drive to its plan, then settles its power and heat. */
  const drive = ({ ship }: Combatant, { heading, command }: Plan) => {
    steer(ship, heading, TIME_STEP);
    const coasting = ship.velocity;
    if (ship.withdrawingSince !== null) {
      // Withdrawing, it burns at full thrust once turned away from the enemy.
      const away = heading && dot(noseOf(ship), heading) >= WITHDRAWAL_ALIGNMENT;
      fireDrive(ship, away ? 1 : 0, TIME_STEP);
    } else if (command && ship.manoeuvre) {
      ship.manoeuvre = { ...ship.manoeuvre, correcting: command.correcting };
      fireDrive(ship, manoeuvreThrottle(ship, command, TIME_STEP), TIME_STEP);
    } else {
      burn(ship, TIME_STEP);
    }
    ship.acceleration = scale(sub(ship.velocity, coasting), 1 / TIME_STEP);
    settlePowerAndHeat(ship, TIME_STEP);
  };

  /**
   * A ship fires at the start of the step: its beam weapons, kinetic guns, point defence and
   * launchers. Returns an event for each missile it launched.
   */
  const fire = (combatant: Combatant, seen: Snapshot, start: number): BattleEvent[] => {
    const { ship } = combatant;
    const target = targetOf(combatant);
    const shooting =
      ship.weapons.beamWeapons.some((w) => w.firing) ||
      ship.weapons.kineticGuns.some((g) => g.firing);
    const aim = target && shooting ? aimAt(combatant, target) : null;
    beams.push(
      ...emitBeams(
        ship,
        combatant.side.id,
        target && aim
          ? { id: target.side.id, position: target.ship.position, aim: aim.body }
          : null,
        start,
      ),
    );
    const motion = target && seen.motions.get(target.side.id);
    slugs.push(
      ...fireKineticGuns(
        ship,
        combatant.side.id,
        target && motion && aim
          ? { id: target.side.id, motion: { ...motion, position: add(motion.position, aim.world) } }
          : null,
        TIME_STEP,
        nextMunitionId,
      ),
    );
    const defending = seen.pointDefenceTargets.get(combatant.side.id);
    if (defending) {
      bursts.push(...firePointDefence(ship, combatant.side.id, defending, start, TIME_STEP));
    }
    const salvoTarget = ship.weapons.salvo?.target ?? null;
    const launched = launchMissiles(
      ship,
      combatant.side.id,
      salvoTarget !== null && inBattle(salvoTarget) ? salvoTarget : null,
      seen.defence.get(combatant.side.id) ?? [],
      TIME_STEP,
      nextMunitionId,
    );
    const launches: BattleEvent[] = [];
    for (const { missile, launcher } of launched) {
      missiles.push(missile);
      const slot = componentSlots(ship.design)[ship.weapons.launchers[launcher]?.slot ?? -1];
      const place = { section: slot?.section ?? 'forward', mount: slot?.index ?? 0 };
      launchedFrom.set(missile.id, place);
      launches.push({
        type: 'launch',
        time: start,
        attacker: combatant.side.id,
        target: missile.target,
        munition: missile.id,
        ...place,
      });
    }
    return launches;
  };

  /** Missiles steer by what their guidance sees of their targets at the start of the step. */
  const guideMissiles = (seen: Snapshot) => {
    missiles = missiles.map((missile) => {
      const { target } = missile;
      const motion = targetsMissile(target)
        ? seen.missileMotions.get(target.munition)
        : seen.motions.get(target);
      return guideMissile(missile, motion ?? null, TIME_STEP);
    });
  };

  /**
   * Ships and munitions move after all have fired, so every beam, slug and missile leaves from
   * the same snapshot. Returns where each ship and munition was before it moved.
   */
  const move = (): Departures => {
    const ships = new Map(combatants.map(({ side, ship }) => [side.id, ship.position]));
    const munitions = new Map(
      [...slugs, ...missiles].map((munition) => [munition.id, munition.position]),
    );
    combatants.forEach(({ ship }) => {
      ship.position = add(ship.position, scale(ship.velocity, TIME_STEP));
    });
    slugs = slugs.map((slug) => ({
      ...slug,
      position: add(slug.position, scale(slug.velocity, TIME_STEP)),
    }));
    missiles = missiles.map((missile) => ({
      ...missile,
      position: add(missile.position, scale(missile.velocity, TIME_STEP)),
    }));
    return { ships, munitions };
  };

  /**
   * What reaches its target by the end of the step strikes it: beams, then point defence bursts,
   * each in the order fired, then slugs and missiles (see `resolveMunitions`). What landed on
   * each ship in the step before is forgotten first.
   */
  const resolveArrivals = (before: Departures, ctx: Omit<DamageContext, 'side'>) => {
    const { time } = ctx;
    const arriving = beams.filter((b) => b.arrival <= time + 1e-9);
    beams = beams.filter((b) => b.arrival > time + 1e-9);
    combatants.forEach((c) => {
      if (c.beamsLanding.length > 0) c.beamsLanding = [];
      if (c.impacts.length > 0) c.impacts = [];
    });
    for (const beam of arriving) resolveBeam(beam, ctx);
    missiles = munitions.resolveBursts(
      missiles,
      bursts.filter((b) => b.arrival <= time + 1e-9),
      ctx,
    );
    bursts = bursts.filter((b) => b.arrival > time + 1e-9);
    ({ slugs, missiles } = munitions.resolveMunitions({ slugs, missiles }, before, ctx));
  };

  /** Each ship's heat damages it at the end of the step if it runs too hot (see `overheat`). */
  const overheatShips = (ctx: Omit<DamageContext, 'side'>) => {
    combatants.forEach(({ side, ship }) => {
      overheat(ship, TIME_STEP, { ...ctx, side: side.id });
    });
  };

  /**
   * How the battle ended in the step, if it did. Ships that lost in it lose together; if all of
   * them did, nobody wins. A side that loses in the step that reaches the time limit still loses.
   */
  /**
   * Withdrawing ships that are gone by the end of the step: out of reach of every enemy weapon,
   * or `WITHDRAWAL_TIME` after their order.
   */
  const leave = (time: number) => {
    for (const c of combatants) {
      const since = c.ship.withdrawingSince;
      if (since === null || c.withdrawn) continue;
      const reached = combatants.some(
        (enemy) =>
          enemy !== c && distance(c.ship.position, enemy.ship.position) <= workingReach(enemy.ship),
      );
      c.withdrawn = !reached || time - since >= WITHDRAWAL_TIME - 1e-9;
    }
  };

  const judgeStep = (time: number): BattleOutcome | null => {
    const decided = judge(
      time,
      combatants.map(({ side, ship, withdrawn }) => ({
        side: side.id,
        loss: lossOf(ship) ?? (withdrawn ? { result: 'withdrawn' as const } : null),
      })),
    );
    if (decided) return decided;
    return timeLimit !== undefined && time >= timeLimit - 1e-9 ? noResult(time, setup.sides) : null;
  };

  const step = (): readonly BattleEvent[] => {
    if (outcome) return [];
    const start = steps * TIME_STEP;
    const seen = snapshot();
    aim(seen);
    const plans = combatants.map(plan);
    const launches: BattleEvent[] = [];
    combatants.forEach((c, i) => {
      drive(c, plans[i] ?? { heading: null, command: null });
      launches.push(...fire(c, seen, start));
    });
    guideMissiles(seen);
    const before = move();
    steps += 1;

    const time = steps * TIME_STEP;
    const events: BattleEvent[] = [...pending, ...launches];
    pending = [];
    const ctx = { time, random, events };
    resolveArrivals(before, ctx);
    overheatShips(ctx);
    leave(time);
    outcome = judgeStep(time);
    if (outcome) events.push({ type: 'battle-ended', time, outcome });
    record(events);
    return events;
  };

  return {
    sides: setup.sides,
    get time() {
      return steps * TIME_STEP;
    },
    get outcome() {
      return outcome;
    },
    giveOrder(sideId, order) {
      const { ship } = combatantOf(sideId);
      const checked = checkOrder(order);
      if (outcome) return;
      const refused =
        (ship.withdrawingSince !== null ? withdrawingRefused(checked) : null) ??
        (combatants.some((c) => c.side.id !== sideId && c.ship.withdrawingSince !== null)
          ? pursuitRefused(checked)
          : null);
      if (refused) throw new Error(refused);
      // Manual orders and manoeuvres replace each other: one or the other steers the ship.
      switch (checked.type) {
        case 'manoeuvre':
          ship.attitude = null;
          ship.burn = null;
          ship.manoeuvre = checked.goal === 'none' ? null : { order: checked, correcting: false };
          break;
        case 'attitude':
          ship.manoeuvre = null;
          ship.attitude = checked;
          break;
        case 'burn':
          ship.manoeuvre = null;
          ship.burn =
            checked.throttle > 0 && checked.duration > 0
              ? { throttle: checked.throttle, remaining: checked.duration }
              : null;
          break;
        case 'power':
          ship.priorities = checked.priorities;
          break;
        case 'radiators':
          ship.radiatorsDeployed = checked.deployed;
          break;
        case 'shields':
          ship.shieldsRaised = checked.raised;
          break;
        case 'weapons': {
          const target = checked.target === null ? null : combatantOf(checked.target);
          if (target?.side.id === sideId) throw new Error('A ship cannot target itself');
          const aim = checked.aim ?? null;
          if (aim) {
            if (!target) throw new Error('Aiming at a part needs a target');
            if (!aimablePart(ship, target.ship, aim)) {
              throw new Error(
                `The sensors do not make out the ${aim.section} section${aim.mount === null ? '' : ` mount ${String(aim.mount)}`} of the target`,
              );
            }
          }
          ship.weapons = { ...ship.weapons, target: checked.target, mode: checked.mode, aim };
          break;
        }
        case 'point-defence':
          ship.weapons = { ...ship.weapons, pointDefencePriority: checked.priority };
          break;
        case 'launch':
          ship.weapons = { ...ship.weapons, salvo: salvoOf(sideId, checked) };
          break;
        case 'anti-missile':
          ship.weapons = { ...ship.weapons, automaticDefence: checked.automatic };
          break;
        case 'withdraw': {
          ship.manoeuvre = null;
          ship.attitude = null;
          ship.burn = null;
          ship.withdrawingSince = steps * TIME_STEP;
          // The enemy may no longer pursue: its standing orders to do so are called off.
          for (const c of combatants) {
            if (c.side.id !== sideId && c.ship.manoeuvre) {
              if (pursuitRefused(c.ship.manoeuvre.order)) c.ship.manoeuvre = null;
            }
          }
          pending.push({ type: 'withdrawal', time: ship.withdrawingSince, side: sideId });
          break;
        }
      }
    },
    step,
    advance(seconds) {
      const count = Math.round(seconds / TIME_STEP);
      const events: BattleEvent[] = [];
      for (let i = 0; i < count; i++) events.push(...step());
      return events;
    },
    observe(sideId) {
      const own = combatantOf(sideId);
      return {
        time: steps * TIME_STEP,
        ownShip: observeOwnShip(own, contactOf(own), antiMissileEngagements(sideId, missiles)),
        contacts: combatants.filter((c) => c !== own).map((c) => observeContact(own.ship, c)),
        munitions: observeMunitions(slugs, missiles),
        events: [...(logs.get(sideId) ?? [])],
        outcome,
      };
    },
    endBattle(sideId) {
      if (outcome) return [];
      outcome = endedBy(steps * TIME_STEP, setup.sides, sideId);
      const events: BattleEvent[] = [{ type: 'battle-ended', time: outcome.time, outcome }];
      record(events);
      return events;
    },
  };
};
