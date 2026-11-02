import { laserResistance } from './armour';
import type { SideId } from './battle';
import { componentSlots } from './components';
import type { ArmourType, SectionKind } from './design';
import type { BattleEvent } from './events';
import { DAMAGE_TEMPERATURE, thermalProperties } from './heat';
import { HULLS } from './hull';
import { penetrationDepth, type SlugHit } from './kinetic';
import { conjugate, rotate } from './quaternion';
import type { Random } from './random';
import { firstHit, shipShape, type ShapePart } from './shape';
import type { ShipState } from './ship';
import { TIME_STEP } from './time';
import { add, length, normalize, scale, sub, vec3, type Vec3 } from './vector';
import { spotRadius, type Beam, type MagazineState } from './weapons';

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
/** The share of a nuclear warhead's yield that leaves as X-rays in vacuum. */
export const X_RAY_FRACTION = 0.8;
/**
 * X-ray fluence that wrecks a mounted component, J/m²: 10 cal/cm², enough to flash-heat and spall
 * the surface of mirrors, sensors, coolant channels and wiring.
 */
export const MOUNT_WRECK_FLUENCE = 4.184e5;
/** X-ray fluence too small to count, J/m²: far below anything that harms a component. */
const NEGLIGIBLE_FLUENCE = 100;
/** A burst is never counted as nearer than this to the middle of a part, m. */
const NEAREST_BURST = 1;
/**
 * The chance that the wreck of a magazine sets off a nuclear warhead in it. Warheads this small
 * and light are not built to survive their magazine burning or blowing up around them.
 */
export const COOK_OFF_CHANCE = 0.25;
/** The share of its yield a nuclear warhead releases when set off by its magazine's wreck. */
export const FIZZLE_FRACTION = 0.1;
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
  /** Where on the part the beam lands, in the ship's body frame, m. */
  readonly point: Vec3;
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

/**
 * Takes `loss` (a fraction of full integrity) off a component, reporting it if it is lost. A
 * magazine that is lost loses the ammunition in it, and may set off nuclear warheads in it (see
 * `explodeMagazine`).
 */
const damageComponent = (ship: ShipState, slot: number, loss: number, ctx: DamageContext) => {
  const before = ship.integrity[slot] ?? 0;
  if (before <= 0 || !(loss > 0)) return;
  const after = before - loss > NEGLIGIBLE ? before - loss : 0;
  ship.integrity = ship.integrity.map((value, i) => (i === slot ? after : value));
  const place = componentSlots(ship.design)[slot];
  if (after > 0 || !place) return;
  const held = ship.ammunition.find((m) => m.slot === slot);
  if (held) {
    ship.ammunition = ship.ammunition.map((m) =>
      m.slot === slot ? { ...m, slugs: 0, missiles: 0 } : m,
    );
  }
  ctx.events.push({
    type: 'component-lost',
    time: ctx.time,
    side: ctx.side,
    section: place.section,
    mounted: place.mounted,
    index: place.index,
    component: place.component.type,
  });
  if (held) explodeMagazine(ship, place.section, place.index, held, ctx);
};

/**
 * A magazine lost with nuclear missiles in it: the fire and blast that wrecked it set off each
 * warhead's high explosive with a chance of `COOK_OFF_CHANCE`, and a warhead set off that way
 * fizzles, releasing `FIZZLE_FRACTION` of its yield. That goes off inside the section, so its
 * armour does not help: the section's structure takes all of it, and fails if it is enough, as
 * even one fizzle of a kiloton warhead is for any hull. Contained by the hull around it, it does
 * no harm beyond the section; a ship whose middle section fails this way is destroyed.
 */
const explodeMagazine = (
  ship: ShipState,
  kind: SectionKind,
  index: number,
  held: MagazineState,
  ctx: DamageContext,
) => {
  const warhead = held.missile?.warhead;
  if (warhead?.type !== 'nuclear') return;
  let warheads = 0;
  for (let i = 0; i < held.missiles; i++) {
    if (ctx.random() < COOK_OFF_CHANCE) warheads += 1;
  }
  if (warheads === 0) return;
  const energy = warheads * FIZZLE_FRACTION * warhead.yield;
  ctx.events.push({
    type: 'magazine-explosion',
    time: ctx.time,
    side: ctx.side,
    section: kind,
    index,
    warheads,
    energy,
  });
  const section = ship.sections[kind];
  if (section.structure <= 0) return;
  const left = section.structure - energy / (structureMass(ship, kind) * STRUCTURE_WRECK_ENERGY);
  if (left > NEGLIGIBLE) {
    ship.sections[kind] = { ...section, structure: left };
  } else {
    failSection(ship, kind, ctx);
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
 * A hit on a section carrying `energy` J that would reach `depthIn` metres into the section's
 * armour if the armour took all of it. Armour is one thickness per section, worn as if every hit
 * landed on the same spot (aim is perfect in Phase 1); the energy left once the hit is through
 * goes partly into the section's structure and partly into one component inside, until that is
 * wrecked.
 */
const damageSection = (
  ship: ShipState,
  kind: SectionKind,
  energy: number,
  depthIn: (armour: ArmourType) => number,
  ctx: DamageContext,
) => {
  const design = ship.design.sections.find((s) => s.kind === kind);
  const state = ship.sections[kind];
  if (!design) return;
  let inside = energy;
  if (state.armour > 0) {
    const depth = depthIn(design.armour.type);
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
  shipShape(ship.design, ship.propellantMass, ship.radiatorsDeployed, ship.ammunitionSpent).filter(
    (part) =>
      ship.sections[part.section].structure > 0 &&
      (part.mount === null ||
        (ship.integrity[slotOf(ship, part.section, true, part.mount)] ?? 0) > 0),
  );

/** A hit carrying `energy` J on a mount, which sits outside the armour and takes all of it. */
const damageMount = (ship: ShipState, part: ShapePart, energy: number, ctx: DamageContext) => {
  const slot = slotOf(ship, part.section, true, part.mount ?? -1);
  const mass = componentSlots(ship.design)[slot]?.component.mass ?? 1;
  damageComponent(ship, slot, energy / (mass * COMPONENT_WRECK_ENERGY), ctx);
};

/**
 * A beam reaching a ship. It is aimed at the centre of mass and lands on whatever its line of
 * fire reaches first on the ship's actual shape. The part takes the beam's intensity over the
 * part's silhouette, or the whole beam if its spot is smaller. On a section it burns through the
 * armour at the rate its intensity allows, I / (ρ·e) metres per second. Mounts sit outside the
 * armour, so a mounted component takes the energy directly.
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
  if (hit.part.mount === null) {
    const depthIn = (armour: ArmourType) => (intensity * TIME_STEP) / laserResistance(armour);
    damageSection(ship, hit.part.section, energy, depthIn, ctx);
  } else {
    damageMount(ship, hit.part, energy, ctx);
  }
  const point = scale(body, hit.distance - RAY_START);
  return { part: hit.part, power, intensity, spotRadius: radius, point };
};

/**
 * A slug or a missile with a kinetic warhead striking a ship with its kinetic energy, `energy` J,
 * on the part its path meets first, as a penetrator of `slugMass` kg.
 * On a section it punches as deep into the armour as its energy allows; a mounted component
 * takes all of it.
 */
export const impactKinetic = (
  ship: ShipState,
  hit: SlugHit,
  energy: number,
  slugMass: number,
  ctx: DamageContext,
): void => {
  ship.ledger = { ...ship.ledger, hitEnergy: ship.ledger.hitEnergy + energy };
  if (hit.part.mount === null) {
    const depthIn = (armour: ArmourType) => penetrationDepth(energy, slugMass, armour);
    damageSection(ship, hit.part.section, energy, depthIn, ctx);
  } else {
    damageMount(ship, hit.part, energy, ctx);
  }
};

/** What a nuclear burst delivered to one part of a ship. */
export interface Exposure {
  readonly part: ShapePart;
  /** From the burst to the middle of the part, m. */
  readonly distance: number;
  /** J/m² */
  readonly fluence: number;
  /** J */
  readonly energy: number;
}

/** The largest face of a part's box, m². */
const largestFace = (part: ShapePart): number => {
  const x = part.max.x - part.min.x;
  const y = part.max.y - part.min.y;
  const z = part.max.z - part.min.z;
  return Math.max(x * y, y * z, x * z);
};

/**
 * A nuclear burst of `yieldEnergy` J at `burst`, relative to the ship's centre of mass in world
 * axes. In vacuum there is no blast: `X_RAY_FRACTION` of the yield leaves as X-rays, spreading
 * evenly over the sphere around the burst, so each part takes a fluence (energy per area) of
 * fX·Y / (4πr²) at its distance r, over its silhouette seen from the burst, but never more than
 * the half of the X-rays one side of anything can face. A part is shadowed, and takes nothing,
 * when a section stands between it and the burst; mounts are too slight to shadow anything.
 *
 * X-rays deposit their energy in the outer micrometres of what they strike. On a section they boil
 * the armour away as a laser does, fluence / (ρ·e) metres deep, so a near miss barely marks it;
 * what gets through the armour goes inside. A mount fails by its surface, whatever its mass: it is
 * wrecked once the fluence over its broadest face reaches `MOUNT_WRECK_FLUENCE`, so a near miss
 * strips radiators and weapons. Returns what each part took, leaving out parts the burst barely
 * reached.
 */
export const irradiate = (
  ship: ShipState,
  burst: Vec3,
  yieldEnergy: number,
  ctx: DamageContext,
): readonly Exposure[] => {
  const parts = intactShape(ship);
  const sections = parts.filter((part) => part.mount === null);
  const origin = rotate(conjugate(ship.orientation), burst);
  const xRays = X_RAY_FRACTION * yieldEnergy;
  const exposures = parts.flatMap((part): Exposure[] => {
    const offset = sub(scale(add(part.min, part.max), 0.5), origin);
    const distance = Math.max(NEAREST_BURST, length(offset));
    const fluence = xRays / (4 * Math.PI * distance ** 2);
    if (fluence < NEGLIGIBLE_FLUENCE) return [];
    const direction = length(offset) > 0 ? normalize(offset) : vec3(1, 0, 0);
    const seen = firstHit([part], origin, direction);
    if (!seen) return [];
    const shadow = firstHit(
      sections.filter((s) => s !== part),
      origin,
      direction,
    );
    if (shadow && shadow.distance < seen.distance) return [];
    const energy = Math.min(fluence * seen.projectedArea, xRays / 2);
    return [{ part, distance, fluence, energy }];
  });
  for (const { part, fluence, energy } of exposures) {
    ship.ledger = { ...ship.ledger, hitEnergy: ship.ledger.hitEnergy + energy };
    if (part.mount === null) {
      const depthIn = (armour: ArmourType) => fluence / laserResistance(armour);
      damageSection(ship, part.section, energy, depthIn, ctx);
    } else {
      const slot = slotOf(ship, part.section, true, part.mount);
      damageComponent(ship, slot, energy / (largestFace(part) * MOUNT_WRECK_FLUENCE), ctx);
    }
  }
  return exposures;
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
