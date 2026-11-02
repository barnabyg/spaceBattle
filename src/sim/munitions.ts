import type { SideId, SideSetup } from './battle';
import { burstChance } from './antiMissile';
import { componentSlots } from './components';
import { impactBurst, impactKinetic, intactShape, irradiate, type DamageContext } from './damage';
import type { FragmentationWarheadDesign, NuclearWarheadDesign, SectionKind } from './design';
import type { MunitionKind, NuclearExposure } from './events';
import { shapeRadius, slugPassed, sweepSlug, type Slug, type Target } from './kinetic';
import {
  fuseTrigger,
  missileMassNow,
  targetsMissile,
  type Missile,
  type MissileTarget,
} from './missile';
import type { ImpactLanding } from './observation';
import type { ShipState } from './ship';
import { add, distance, dot, length, scale, sub, type Vec3 } from './vector';
import type { PointDefenceBurst } from './weapons';

/** A ship in the battle as munitions meet it. */
export interface ShipInBattle {
  readonly side: SideSetup;
  readonly ship: ShipState;
  /** What struck the ship in this step; each munition that strikes it is added. */
  readonly impacts: ImpactLanding[];
}

/** Slugs and missiles in flight, each in the order fired. */
export interface InFlight {
  readonly slugs: Slug[];
  readonly missiles: Missile[];
}

/** Where each ship and munition was before it moved in a step. */
export interface Departures {
  /** By side. */
  readonly ships: ReadonlyMap<SideId, Vec3>;
  /** By munition id. */
  readonly munitions: ReadonlyMap<number, Vec3>;
}

/** A ship's shape as slugs and missiles meet it now. */
export const targetOfMunitions = (ship: ShipState): Target => {
  const parts = intactShape(ship);
  return { parts, reach: shapeRadius(parts), orientation: ship.orientation };
};

/** Each ship's shape as munitions meet it, worked out once per step until it is struck. */
const createShapes = () => {
  const shapes = new Map<SideId, Target>();
  return {
    of(c: ShipInBattle): Target {
      const known = shapes.get(c.side.id);
      if (known) return known;
      const shape = targetOfMunitions(c.ship);
      shapes.set(c.side.id, shape);
      return shape;
    },
    struck(c: ShipInBattle) {
      shapes.delete(c.side.id);
    },
  };
};

type Shapes = ReturnType<typeof createShapes>;

/**
 * How munitions meet their targets in a battle among `ships`, in the battle's order:
 * point defence bursts (see `resolveBursts`), and slugs and missiles at the end of each step's
 * move (see `resolveMunitions`). `launchedFrom` is where the launcher that launched each
 * missile is.
 */
export const createMunitions = (
  ships: readonly ShipInBattle[],
  launchedFrom: ReadonlyMap<number, { readonly section: SectionKind; readonly mount: number }>,
) => {
  const shipOf = (sideId: SideId): ShipInBattle => {
    const ship = ships.find((c) => c.side.id === sideId);
    if (!ship) throw new Error(`Unknown side ${sideId}`);
    return ship;
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
    shapes: Shapes,
    ctx: Omit<DamageContext, 'side'>,
  ): boolean => {
    for (const c of ships) {
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
    shapes: Shapes,
    ctx: Omit<DamageContext, 'side'>,
  ): boolean => {
    /** Where a ship was part-way through the step, as a fraction of it. */
    const shipAt = (c: ShipInBattle, along: number) => {
      const start = shipsBefore.get(c.side.id) ?? c.ship.position;
      return add(start, scale(sub(c.ship.position, start), along));
    };
    let trigger: { along: number; contact: boolean; ship: ShipInBattle } | null = null;
    for (const c of ships) {
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
    const exposures: NuclearExposure[] = ships.flatMap((c) => {
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
    inFlight: Missile[],
    arriving: readonly PointDefenceBurst[],
    ctx: Omit<DamageContext, 'side'>,
  ): Missile[] => {
    let missiles = inFlight;
    for (const burst of arriving) {
      const defender = shipOf(burst.attacker);
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
      const target = ships.find((c) => c.side.id === engagement.side);
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
    return missiles;
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
    missiles: readonly Missile[],
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
    const defender = shipOf(antiMissile.attacker);
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
    shapes: Shapes,
  ): boolean => {
    const target = ships.find((c) => c.side.id === munition.target);
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
    inFlight: InFlight,
    { ships: shipsBefore, munitions: before }: Departures,
    ctx: Omit<DamageContext, 'side'>,
  ): InFlight => {
    const shapes = createShapes();
    const slugs = inFlight.slugs.filter((slug) => {
      const from = before.get(slug.id) ?? slug.position;
      if (strikeDirectly({ ...slug, kind: 'slug' }, from, shipsBefore, shapes, ctx)) return false;
      return !passedTarget(slug, shapes);
    });
    const gone = burstFragmentation(inFlight.missiles, before, ctx);
    const missiles = inFlight.missiles.filter((missile) => {
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
    return { slugs, missiles };
  };

  return { resolveBursts, resolveMunitions };
};
