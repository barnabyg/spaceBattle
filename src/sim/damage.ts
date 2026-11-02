import { laserResistance } from './armour';
import type { SideId } from './battle';
import { componentSlots } from './components';
import type { SectionKind } from './design';
import type { BattleEvent } from './events';
import { DAMAGE_TEMPERATURE, thermalProperties } from './heat';
import { HULLS } from './hull';
import { conjugate, rotate } from './quaternion';
import type { Random } from './random';
import { firstHit, shipShape, type ShapePart } from './shape';
import type { ShipState } from './ship';
import { TIME_STEP } from './time';
import { normalize, scale, sub } from './vector';
import { spotRadius, type Beam } from './weapons';

/**
 * Energy that wrecks a component, per kilogram of it, J/kg. A beam need only cut and melt the
 * parts that matter, far less than it would take to vaporise the whole thing.
 */
export const COMPONENT_WRECK_ENERGY = 1e6;
/** Energy that breaks through a section's structure, per kilogram of structure, J/kg. */
export const STRUCTURE_WRECK_ENERGY = 1e6;
/** The share of a beam's energy past the armour that the structure takes; the rest a component. */
export const STRUCTURE_SHARE = 0.5;
/** Integrity every component loses per second for each kelvin above the damage temperature. */
export const OVERHEAT_DAMAGE_RATE = 1e-4;
/** Integrity below this counts as none, so rounding crumbs never leave a part half-alive. */
const NEGLIGIBLE = 1e-9;
/** Rays are cast from this far out along the line of fire, well clear of any ship, m. */
const RAY_START = 10_000;

/** Who is being damaged and when, the battle's chance, and where to report what happens. */
export interface DamageContext {
  readonly side: SideId;
  readonly time: number;
  readonly random: Random;
  readonly events: BattleEvent[];
}

/** Where a beam landed and with how much. */
export interface Strike {
  readonly part: ShapePart;
  /** Beam power landing on the part, W. */
  readonly power: number;
  /** W/m² */
  readonly intensity: number;
  /** m */
  readonly spotRadius: number;
}

/** The part of the hull's structure mass in a section, by its share of the volume, kg. */
const structureMass = (ship: ShipState, kind: SectionKind): number => {
  const hull = HULLS[ship.design.hullSize];
  const volume = (s: { length: number; width: number; height: number }) =>
    s.length * s.width * s.height;
  const total = hull.sections.reduce((sum, s) => sum + volume(s), 0);
  const shape = hull.sections.find((s) => s.kind === kind);
  return shape ? (hull.structureMass * volume(shape)) / total : 0;
};

const slotOf = (ship: ShipState, section: SectionKind, mounted: boolean, index: number) =>
  componentSlots(ship.design).findIndex(
    (s) => s.section === section && s.mounted === mounted && s.index === index,
  );

/** Takes `loss` (a fraction of full integrity) off a component, reporting it if it is lost. */
const damageComponent = (ship: ShipState, slot: number, loss: number, ctx: DamageContext) => {
  const before = ship.integrity[slot] ?? 0;
  if (before <= 0 || !(loss > 0)) return;
  const after = before - loss > NEGLIGIBLE ? before - loss : 0;
  ship.integrity = ship.integrity.map((value, i) => (i === slot ? after : value));
  const place = componentSlots(ship.design)[slot];
  if (after === 0 && place) {
    ctx.events.push({
      type: 'component-lost',
      time: ctx.time,
      side: ctx.side,
      section: place.section,
      mounted: place.mounted,
      index: place.index,
      component: place.component.type,
    });
  }
};

/** A section whose structure is broken through is lost, and everything in and on it. */
const failSection = (ship: ShipState, kind: SectionKind, ctx: DamageContext) => {
  ship.sections[kind] = { ...ship.sections[kind], structure: 0, struck: null };
  ctx.events.push({ type: 'structural-failure', time: ctx.time, side: ctx.side, section: kind });
  componentSlots(ship.design).forEach((place, slot) => {
    if (place.section === kind) damageComponent(ship, slot, 1, ctx);
  });
};

/**
 * The working component inside a section that a beam through the armour bores into next,
 * chosen at random with the chance in proportion to mass; null when none is left.
 */
const pickStruck = (ship: ShipState, kind: SectionKind, random: Random): number | null => {
  const candidates = componentSlots(ship.design).flatMap((place, slot) =>
    place.section === kind && !place.mounted && (ship.integrity[slot] ?? 0) > 0
      ? [{ slot, mass: place.component.mass }]
      : [],
  );
  const total = candidates.reduce((sum, c) => sum + c.mass, 0);
  let pick = random() * total;
  for (const c of candidates) {
    pick -= c.mass;
    if (pick < 0) return c.slot;
  }
  return candidates.at(-1)?.slot ?? null;
};

/**
 * A beam landing on a section. It burns through the armour at the rate its intensity allows,
 * I / (ρ·e) metres per second; armour is one thickness per section, worn as if every hit landed
 * on the same spot (aim is perfect in Phase 1). Energy past the armour goes partly into the
 * section's structure and partly into one component inside, until that is wrecked.
 */
const damageSection = (
  ship: ShipState,
  kind: SectionKind,
  energy: number,
  intensity: number,
  ctx: DamageContext,
) => {
  const design = ship.design.sections.find((s) => s.kind === kind);
  const state = ship.sections[kind];
  if (!design) return;
  let inside = energy;
  if (state.armour > 0) {
    const depth = (intensity * TIME_STEP) / laserResistance(design.armour.type);
    if (depth < state.armour) {
      ship.sections[kind] = { ...state, armour: state.armour - depth };
      return;
    }
    inside = energy * (1 - state.armour / depth);
    ship.sections[kind] = { ...state, armour: 0 };
    ctx.events.push({ type: 'armour-breached', time: ctx.time, side: ctx.side, section: kind });
  }
  if (!(inside > 0)) return;
  const current = ship.sections[kind];
  let struck = current.struck;
  if (struck === null || (ship.integrity[struck] ?? 0) <= 0) {
    struck = pickStruck(ship, kind, ctx.random);
  }
  const toComponent = struck === null ? 0 : inside * (1 - STRUCTURE_SHARE);
  const left =
    current.structure -
    (inside - toComponent) / (structureMass(ship, kind) * STRUCTURE_WRECK_ENERGY);
  const structure = left > NEGLIGIBLE ? left : 0;
  ship.sections[kind] = { ...current, structure, struck };
  if (struck !== null) {
    const mass = componentSlots(ship.design)[struck]?.component.mass ?? 1;
    damageComponent(ship, struck, toComponent / (mass * COMPONENT_WRECK_ENERGY), ctx);
  }
  if (structure === 0) failSection(ship, kind, ctx);
};

/** The parts of a ship still there: sections not yet failed and mounts not yet wrecked. */
export const intactShape = (ship: ShipState): readonly ShapePart[] =>
  shipShape(ship.design, ship.propellantMass, ship.radiatorsDeployed).filter(
    (part) =>
      ship.sections[part.section].structure > 0 &&
      (part.mount === null ||
        (ship.integrity[slotOf(ship, part.section, true, part.mount)] ?? 0) > 0),
  );

/**
 * A beam reaching a ship. It is aimed at the centre of mass and lands on whatever its line of
 * fire reaches first on the ship's actual shape. The part takes the beam's intensity over the
 * part's silhouette, or the whole beam if its spot is smaller. Mounts sit outside the armour, so
 * a mounted component takes the energy directly.
 */
export const strike = (ship: ShipState, beam: Beam, ctx: DamageContext): Strike | null => {
  const direction = normalize(sub(ship.position, beam.origin));
  const body = rotate(conjugate(ship.orientation), direction);
  const hit = firstHit(intactShape(ship), scale(body, -RAY_START), body);
  if (!hit) return null;
  const radius = spotRadius(beam, beam.range);
  const intensity = beam.power / (Math.PI * radius ** 2);
  const power = Math.min(beam.power, intensity * hit.projectedArea);
  const energy = power * TIME_STEP;
  ship.ledger = { ...ship.ledger, hitEnergy: ship.ledger.hitEnergy + energy };
  const { section, mount } = hit.part;
  if (mount === null) {
    damageSection(ship, section, energy, intensity, ctx);
  } else {
    const slot = slotOf(ship, section, true, mount);
    const mass = componentSlots(ship.design)[slot]?.component.mass ?? 1;
    damageComponent(ship, slot, energy / (mass * COMPONENT_WRECK_ENERGY), ctx);
  }
  return { part: hit.part, power, intensity, spotRadius: radius };
};

/** Above the damage temperature every component loses integrity, faster the hotter it is. */
export const overheat = (ship: ShipState, dt: number, ctx: DamageContext): void => {
  const temperature = ship.heat / thermalProperties(ship.design).heatCapacity;
  if (temperature <= DAMAGE_TEMPERATURE) return;
  const loss = OVERHEAT_DAMAGE_RATE * (temperature - DAMAGE_TEMPERATURE) * dt;
  ship.integrity.forEach((_, slot) => {
    damageComponent(ship, slot, loss, ctx);
  });
};
