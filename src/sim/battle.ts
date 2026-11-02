import { burstChance, incomingMissiles } from './antiMissile';
import { componentSlots } from './components';
import {
  impactBurst,
  impactKinetic,
  intactShape,
  irradiate,
  overheat,
  strike,
  type DamageContext,
} from './damage';
import {
  missileRole,
  type Design,
  type FragmentationWarheadDesign,
  type MissileRole,
  type NuclearWarheadDesign,
  type SectionKind,
} from './design';
import {
  involves,
  type BattleEvent,
  type HitEvent,
  type MunitionKind,
  type NuclearExposure,
} from './events';
import {
  manoeuvreCommand,
  manoeuvreThrottle,
  type ManoeuvreCommand,
  type ContactMotion,
} from './manoeuvre';
import { shapeRadius, slugPassed, sweepSlug, type Motion, type Slug, type Target } from './kinetic';
import {
  fuseTrigger,
  guideMissile,
  missileMassNow,
  targetsMissile,
  type Missile,
  type MissileTarget,
} from './missile';
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
  type LaunchOrder,
  type Order,
  type PointDefencePriority,
} from './orders';
import type { PointDefenceEngagement, Threat } from './pointDefence';
import { POWER_SYSTEMS, settlePowerAndHeat } from './power';
import { endedBy, judge, lossOf, noResult, type BattleOutcome } from './outcome';
import { IDENTITY, type Quat } from './quaternion';
import { createRandom } from './random';
import { burn, createShip, fireDrive, steer, type ShipState } from './ship';
import { TIME_STEP } from './time';
import { add, distance, dot, length, normalize, scale, sub, type Vec3 } from './vector';
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
} from './weapons';

export { TIME_STEP };
export type {
  BattleEvent,
  BattleOutcome,
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
  ContactObservation,
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
    case 'anti-missile':
    case 'radiators':
    case 'shields':
    case 'weapons':
      return order;
  }
};

/** How many recent events each side's observation keeps. */
const EVENT_LOG_LENGTH = 20;

/** A ship's shape as slugs and missiles meet it now. */
const targetOfMunitions = (ship: ShipState): Target => {
  const parts = intactShape(ship);
  return { parts, reach: shapeRadius(parts), orientation: ship.orientation };
};

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
    };
  });
  let steps = 0;
  const random = createRandom(setup.seed);
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
  const logs = new Map<SideId, BattleEvent[]>(setup.sides.map((side) => [side.id, []]));
  let outcome: BattleOutcome | null = null;

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

  /** Each ship's shape as munitions meet it, worked out once per step until it is struck. */
  const createShapes = () => {
    const shapes = new Map<SideId, Target>();
    return {
      of(c: Combatant): Target {
        const known = shapes.get(c.side.id);
        if (known) return known;
        const shape = targetOfMunitions(c.ship);
        shapes.set(c.side.id, shape);
        return shape;
      },
      struck(c: Combatant) {
        shapes.delete(c.side.id);
      },
    };
  };

  /**
   * A munition that moved from `from` to where it is now, while each ship moved from where it was
   * at `shipsBefore`: if its path crosses a ship other than the one that fired it, it strikes the
   * first such ship with its kinetic energy relative to the ship. Returns whether it struck.
   */
  const strikeDirectly = (
    munition: {
      readonly kind: MunitionKind;
      readonly attacker: SideId;
      readonly mass: number;
      readonly position: Vec3;
      readonly velocity: Vec3;
    },
    from: Vec3,
    shipsBefore: ReadonlyMap<SideId, Vec3>,
    shapes: ReturnType<typeof createShapes>,
    ctx: Omit<DamageContext, 'side'>,
  ): boolean => {
    for (const c of combatants) {
      if (c.side.id === munition.attacker) continue;
      const hit = sweepSlug(
        shapes.of(c),
        sub(from, shipsBefore.get(c.side.id) ?? c.ship.position),
        sub(munition.position, c.ship.position),
      );
      if (!hit) continue;
      const relative = sub(munition.velocity, c.ship.velocity);
      const energy = 0.5 * munition.mass * dot(relative, relative);
      impactKinetic(c.ship, hit, energy, munition.mass, { ...ctx, side: c.side.id });
      shapes.struck(c);
      c.impacts.push({ point: hit.point, energy });
      ctx.events.push({
        type: 'impact',
        time: ctx.time,
        attacker: munition.attacker,
        target: c.side.id,
        munition: munition.kind,
        section: hit.part.section,
        mount: hit.part.mount,
        energy,
        speed: length(relative),
      });
      return true;
    }
    return false;
  };

  /**
   * A missile with a nuclear warhead that moved from `from` to where it is now, while each ship
   * moved from where it was at `shipsBefore`. It goes off at the first point of its path where it
   * strikes a ship other than the one that launched it, or where its proximity fuse finds such a
   * ship within its detonation distance; its burst reaches every ship as each was at that moment
   * (see `irradiate`). Returns whether it went off.
   */
  const detonateNear = (
    missile: Missile,
    warhead: NuclearWarheadDesign,
    from: Vec3,
    shipsBefore: ReadonlyMap<SideId, Vec3>,
    shapes: ReturnType<typeof createShapes>,
    ctx: Omit<DamageContext, 'side'>,
  ): boolean => {
    /** Where a ship was part-way through the step, as a fraction of it. */
    const shipAt = (c: Combatant, along: number) => {
      const start = shipsBefore.get(c.side.id) ?? c.ship.position;
      return add(start, scale(sub(c.ship.position, start), along));
    };
    let trigger: { along: number; contact: boolean; ship: Combatant } | null = null;
    for (const c of combatants) {
      if (c.side.id === missile.attacker) continue;
      const start = sub(from, shipAt(c, 0));
      const end = sub(missile.position, c.ship.position);
      const hit = sweepSlug(shapes.of(c), start, end);
      const fuse =
        warhead.detonationDistance > 0 ? fuseTrigger(start, end, warhead.detonationDistance) : null;
      const options = [
        ...(hit ? [{ along: hit.along, contact: true }] : []),
        ...(fuse === null ? [] : [{ along: fuse, contact: false }]),
      ];
      for (const option of options) {
        if (!trigger || option.along < trigger.along) trigger = { ...option, ship: c };
      }
    }
    if (!trigger) return false;
    const { along, contact, ship: target } = trigger;
    const position = add(from, scale(sub(missile.position, from), along));
    const offset = sub(position, shipAt(target, along));
    // What the burst does to each ship follows the detonation in the events.
    const at = ctx.events.length;
    const exposures: NuclearExposure[] = combatants.flatMap((c) => {
      const taken = irradiate(c.ship, sub(position, shipAt(c, along)), warhead.yield, {
        ...ctx,
        side: c.side.id,
      });
      if (taken.length > 0) shapes.struck(c);
      return taken.map(({ part, distance, fluence, energy }) => ({
        side: c.side.id,
        section: part.section,
        mount: part.mount,
        distance,
        fluence,
        energy,
      }));
    });
    ctx.events.splice(at, 0, {
      type: 'detonation',
      time: ctx.time,
      attacker: missile.attacker,
      target: target.side.id,
      munition: missile.id,
      yield: warhead.yield,
      contact,
      position,
      offset,
      distance: length(offset),
      exposures,
    });
    return true;
  };

  /**
   * Point defence bursts meeting their targets, in the order fired. A burst at a missile still in
   * flight brings it down with the chance it was fired with, and the missile leaves the battle; a
   * burst at a ship strikes it (see `impactBurst`).
   */
  const resolveBursts = (
    arriving: readonly PointDefenceBurst[],
    ctx: Omit<DamageContext, 'side'>,
  ) => {
    for (const burst of arriving) {
      const defender = combatantOf(burst.attacker);
      const gun = defender.ship.weapons.pointDefence[burst.gun];
      const place = componentSlots(defender.ship.design)[gun?.slot ?? -1];
      const { engagement } = burst;
      if (engagement.kind === 'missile') {
        const missile = missiles.find((m) => m.id === engagement.munition);
        if (!missile || !(ctx.random() < burst.chance)) continue;
        missiles = missiles.filter((m) => m !== missile);
        defender.ship.weapons = {
          ...defender.ship.weapons,
          intercepts: defender.ship.weapons.intercepts + 1,
        };
        ctx.events.push({
          type: 'intercept',
          time: ctx.time,
          side: burst.attacker,
          attacker: missile.attacker,
          munition: missile.id,
          warhead: missile.design.warhead.type,
          weapon: 'point-defence',
          section: place?.section ?? 'forward',
          mount: place?.index ?? 0,
          antiMissile: null,
          position: missile.position,
          distance: distance(missile.position, defender.ship.position),
          chance: burst.chance,
        });
        continue;
      }
      const target = combatants.find((c) => c.side.id === engagement.side);
      if (!target) continue;
      const { rounds, roundMass, speed, spread } = burst;
      const landed = impactBurst(
        target.ship,
        burst.direction,
        { rounds, roundMass, roundEnergy: 0.5 * roundMass * speed ** 2, spread },
        { ...ctx, side: target.side.id },
      );
      if (!landed) continue;
      target.impacts.push({ point: landed.point, energy: landed.energy });
      ctx.events.push({
        type: 'impact',
        time: ctx.time,
        attacker: burst.attacker,
        target: target.side.id,
        munition: 'point-defence',
        section: landed.part.section,
        mount: landed.part.mount,
        energy: landed.energy,
        speed,
      });
    }
  };

  /**
   * Anti-missile missiles that moved from `before` to their positions now, as did the missiles
   * they are after: each bursts at the first point of its path where its proximity fuse finds its
   * target within its burst distance, bringing it down with the chance its fragments have (see
   * `burstChance`), and is spent either way. One whose target has left the battle destroys itself;
   * one that has passed its target for good with no propellant left to turn back flies on out of
   * the battle. Returns the ids of the missiles that leave: anti-missile missiles and the missiles
   * they brought down.
   */
  const burstFragmentation = (
    before: ReadonlyMap<number, Vec3>,
    ctx: Omit<DamageContext, 'side'>,
  ): Set<number> => {
    const gone = new Set<number>();
    for (const antiMissile of missiles) {
      const { warhead } = antiMissile.design;
      if (warhead.type !== 'fragmentation') continue;
      const { target } = antiMissile;
      const missile = targetsMissile(target)
        ? missiles.find((m) => m.id === target.munition && !gone.has(m.id))
        : undefined;
      if (!missile) {
        gone.add(antiMissile.id);
        continue;
      }
      const from = sub(
        before.get(antiMissile.id) ?? antiMissile.position,
        before.get(missile.id) ?? missile.position,
      );
      const to = sub(antiMissile.position, missile.position);
      const along = fuseTrigger(from, to, warhead.burstDistance);
      if (along === null) {
        const relative = { position: to, velocity: sub(antiMissile.velocity, missile.velocity) };
        if (antiMissile.propellantMass <= 0 && slugPassed(relative, warhead.burstDistance)) {
          gone.add(antiMissile.id);
        }
        continue;
      }
      gone.add(antiMissile.id);
      burst(antiMissile, warhead, missile, along, before, ctx, gone);
    }
    return gone;
  };

  /**
   * An anti-missile missile's fragmentation warhead bursting `along` the step's path near the
   * missile it is after (see `burstFragmentation`): it brings the missile down, adding it to
   * `gone`, or misses.
   */
  const burst = (
    antiMissile: Missile,
    warhead: FragmentationWarheadDesign,
    missile: Missile,
    along: number,
    before: ReadonlyMap<number, Vec3>,
    ctx: Omit<DamageContext, 'side'>,
    gone: Set<number>,
  ) => {
    const at = (m: Missile) => {
      const start = before.get(m.id) ?? m.position;
      return add(start, scale(sub(m.position, start), along));
    };
    const position = at(antiMissile);
    const missileAt = at(missile);
    const defender = combatantOf(antiMissile.attacker);
    const chance = burstChance(
      warhead,
      missile.design,
      sub(position, missileAt),
      sub(antiMissile.velocity, missile.velocity),
      sub(missile.velocity, defender.ship.velocity),
    );
    if (!(ctx.random() < chance)) {
      ctx.events.push({
        type: 'miss',
        time: ctx.time,
        side: antiMissile.attacker,
        attacker: missile.attacker,
        munition: missile.id,
        antiMissile: antiMissile.id,
        position,
        distance: distance(position, missileAt),
        chance,
      });
      return;
    }
    gone.add(missile.id);
    defender.ship.weapons = {
      ...defender.ship.weapons,
      intercepts: defender.ship.weapons.intercepts + 1,
    };
    const launcher = launchedFrom.get(antiMissile.id);
    ctx.events.push({
      type: 'intercept',
      time: ctx.time,
      side: antiMissile.attacker,
      attacker: missile.attacker,
      munition: missile.id,
      warhead: missile.design.warhead.type,
      weapon: 'anti-missile-missile',
      section: launcher?.section ?? 'forward',
      mount: launcher?.mount ?? 0,
      antiMissile: antiMissile.id,
      position: missileAt,
      distance: distance(missileAt, defender.ship.position),
      chance,
    });
  };

  /** Whether a munition has passed its target ship for good, so it can be forgotten. */
  const passedTarget = (
    munition: { readonly target: MissileTarget; readonly position: Vec3; readonly velocity: Vec3 },
    shapes: ReturnType<typeof createShapes>,
  ): boolean => {
    const target = combatants.find((c) => c.side.id === munition.target);
    if (!target) return true;
    return slugPassed(
      {
        position: sub(munition.position, target.ship.position),
        velocity: sub(munition.velocity, target.ship.velocity),
      },
      shapes.of(target).reach,
    );
  };

  /**
   * Slugs and missiles moving from `before` to their positions now. Anti-missile missiles burst
   * first (see `burstFragmentation`), so a missile they bring down strikes nothing. Then each
   * other munition strikes the first ship its path crosses (see `strikeDirectly`), except that a
   * missile with a nuclear warhead goes off near it (see `detonateNear`). A munition that strikes
   * or goes off leaves the battle. A slug that has passed its target for good flies on out of the
   * battle; so does a missile that has, once it has no propellant left to turn back.
   */
  const resolveMunitions = (
    before: ReadonlyMap<number, Vec3>,
    shipsBefore: ReadonlyMap<SideId, Vec3>,
    ctx: Omit<DamageContext, 'side'>,
  ) => {
    const shapes = createShapes();
    slugs = slugs.filter((slug) => {
      const from = before.get(slug.id) ?? slug.position;
      if (strikeDirectly({ ...slug, kind: 'slug' }, from, shipsBefore, shapes, ctx)) return false;
      return !passedTarget(slug, shapes);
    });
    const gone = burstFragmentation(before, ctx);
    missiles = missiles.filter((missile) => {
      if (gone.has(missile.id)) return false;
      const from = before.get(missile.id) ?? missile.position;
      const { warhead } = missile.design;
      switch (warhead.type) {
        case 'fragmentation':
          return true;
        case 'kinetic': {
          const munition = { ...missile, kind: 'missile' as const, mass: missileMassNow(missile) };
          if (strikeDirectly(munition, from, shipsBefore, shapes, ctx)) return false;
          break;
        }
        case 'nuclear':
          if (detonateNear(missile, warhead, from, shipsBefore, shapes, ctx)) return false;
          break;
      }
      return !(missile.propellantMass <= 0 && passedTarget(missile, shapes));
    });
  };

  const step = (): readonly BattleEvent[] => {
    if (outcome) return [];
    const start = steps * TIME_STEP;
    // Fire control sees every ship as it was at the start of the step, so the order of sides
    // never matters.
    const motions = new Map<SideId, Motion>(
      combatants.map(({ side, ship }) => [
        side.id,
        { position: ship.position, velocity: ship.velocity, acceleration: ship.acceleration },
      ]),
    );
    // So do missile guidance and missile defence, for missiles.
    const missileMotions = new Map<number, Motion>(
      missiles.map((m) => [
        m.id,
        { position: m.position, velocity: m.velocity, acceleration: m.acceleration },
      ]),
    );
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
    // Point defence sees the missiles aimed at its ship and its target as they were at the start
    // of the step; it leaves anti-missile missiles, which threaten only missiles, alone.
    const pointDefenceTargets = new Map<SideId, PointDefenceTargets>(
      combatants.map((c) => {
        const target = targetOf(c);
        const motion = target && motions.get(target.side.id);
        const threats = missiles.flatMap((m): Threat[] =>
          m.target !== c.side.id
            ? []
            : [
                {
                  id: m.id,
                  design: m.design,
                  motion: {
                    position: m.position,
                    velocity: m.velocity,
                    acceleration: m.acceleration,
                  },
                },
              ],
        );
        return [
          c.side.id,
          { threats, ship: target && motion ? { id: target.side.id, motion } : null },
        ];
      }),
    );
    // Weapons choose whether to fire first, so the drive knows what power they will ask for.
    combatants.forEach((c) => {
      const target = targetOf(c);
      aimWeapons(
        c.ship,
        target ? distance(c.ship.position, target.ship.position) : null,
        pointDefenceTargets.get(c.side.id),
      );
    });
    // Every ship plans from the same snapshot of positions, so the order of sides never matters.
    const launches: BattleEvent[] = [];
    const plans = combatants.map(
      (c): { heading: Vec3 | null; command: ManoeuvreCommand | null } => {
        const state = c.ship.manoeuvre;
        if (!state) return { heading: attitudeTarget(c), command: null };
        const command = manoeuvreCommand(c.ship, state, contactOf(c));
        return { heading: command.heading, command };
      },
    );
    combatants.forEach((combatant, i) => {
      const { ship } = combatant;
      const { heading, command } = plans[i] ?? { heading: null, command: null };
      steer(ship, heading, TIME_STEP);
      const coasting = ship.velocity;
      if (command && ship.manoeuvre) {
        ship.manoeuvre = { ...ship.manoeuvre, correcting: command.correcting };
        fireDrive(ship, manoeuvreThrottle(ship, command, TIME_STEP), TIME_STEP);
      } else {
        burn(ship, TIME_STEP);
      }
      ship.acceleration = scale(sub(ship.velocity, coasting), 1 / TIME_STEP);
      settlePowerAndHeat(ship, TIME_STEP);
      const target = targetOf(combatant);
      beams.push(
        ...emitBeams(
          ship,
          combatant.side.id,
          target ? { id: target.side.id, position: target.ship.position } : null,
          start,
        ),
      );
      const motion = target && motions.get(target.side.id);
      slugs.push(
        ...fireKineticGuns(
          ship,
          combatant.side.id,
          target && motion ? { id: target.side.id, motion } : null,
          TIME_STEP,
          nextMunitionId,
        ),
      );
      const defending = pointDefenceTargets.get(combatant.side.id);
      if (defending) {
        bursts.push(...firePointDefence(ship, combatant.side.id, defending, start, TIME_STEP));
      }
      const salvoTarget = ship.weapons.salvo?.target ?? null;
      const launched = launchMissiles(
        ship,
        combatant.side.id,
        salvoTarget !== null && inBattle(salvoTarget) ? salvoTarget : null,
        defence.get(combatant.side.id) ?? [],
        TIME_STEP,
        nextMunitionId,
      );
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
    });
    // Missiles steer by what their guidance sees of their targets at the start of the step.
    missiles = missiles.map((missile) => {
      const { target } = missile;
      const motion = targetsMissile(target)
        ? missileMotions.get(target.munition)
        : motions.get(target);
      return guideMissile(missile, motion ?? null, TIME_STEP);
    });
    // Ships and munitions move after all have fired, so every beam, slug and missile leaves from
    // the same snapshot.
    const shipsBefore = new Map(combatants.map(({ side, ship }) => [side.id, ship.position]));
    const munitionsBefore = new Map(
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
    steps += 1;

    // Beams that reach their targets by the end of the step strike them, in the order fired.
    const time = steps * TIME_STEP;
    const events: BattleEvent[] = [...launches];
    const arriving = beams.filter((b) => b.arrival <= time + 1e-9);
    beams = beams.filter((b) => b.arrival > time + 1e-9);
    combatants.forEach((c) => {
      if (c.beamsLanding.length > 0) c.beamsLanding = [];
      if (c.impacts.length > 0) c.impacts = [];
    });
    for (const beam of arriving) resolveBeam(beam, { time, random, events });
    resolveBursts(
      bursts.filter((b) => b.arrival <= time + 1e-9),
      { time, random, events },
    );
    bursts = bursts.filter((b) => b.arrival > time + 1e-9);
    resolveMunitions(munitionsBefore, shipsBefore, { time, random, events });
    combatants.forEach(({ side, ship }) => {
      overheat(ship, TIME_STEP, { side: side.id, time, random, events });
    });
    // Ships that lost in this step lose together; if all of them did, nobody wins.
    outcome = judge(
      time,
      combatants.map(({ side, ship }) => ({ side: side.id, loss: lossOf(ship) })),
    );
    // A side that loses in the step that reaches the time limit still loses.
    if (!outcome && timeLimit !== undefined && time >= timeLimit - 1e-9) {
      outcome = noResult(time, setup.sides);
    }
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
        case 'weapons':
          if (checked.target !== null && combatantOf(checked.target).side.id === sideId) {
            throw new Error('A ship cannot target itself');
          }
          ship.weapons = { ...ship.weapons, target: checked.target, mode: checked.mode };
          break;
        case 'point-defence':
          ship.weapons = { ...ship.weapons, pointDefencePriority: checked.priority };
          break;
        case 'launch':
          ship.weapons = { ...ship.weapons, salvo: salvoOf(sideId, checked) };
          break;
        case 'anti-missile':
          ship.weapons = { ...ship.weapons, automaticDefence: checked.automatic };
          break;
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
        contacts: combatants.filter((c) => c !== own).map(observeContact),
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
