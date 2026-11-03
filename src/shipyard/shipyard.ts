import { HULLS } from '../sim/hull';
import { deltaVWith, massProperties } from '../sim/ship';
import { designCost } from './cost';
import {
  parseDesign,
  SECTION_KINDS,
  type ArmourDesign,
  type ComponentDesign,
  type ComponentType,
  type Design,
  type HullSize,
  type InternalComponentDesign,
  type MountedComponentDesign,
  type SectionKind,
} from '../sim/design';

/** One component of a specification, and the section the player put it in, if they did. */
export interface SpecifiedComponent {
  readonly component: ComponentDesign;
  /** A manual placement; the shipyard places the component itself when it is left out. */
  readonly section?: SectionKind;
}

/** What the player asks the shipyard for: everything about a design but where its parts go. */
export interface ShipSpecification {
  /** The class's name; the design is called "<name> class". */
  readonly name: string;
  readonly hullSize: HullSize;
  readonly components: readonly SpecifiedComponent[];
  readonly armour: Readonly<Record<SectionKind, ArmourDesign>>;
  /** Propellant carried at the start of a battle, kg. */
  readonly propellantMass: number;
  /** The delta-v held back for withdrawal, m/s. */
  readonly reserve: number;
}

/**
 * The share of a section's box that components and tanks may fill; the rest is the structure
 * itself, crew spaces, access ways and conduits.
 */
export const USABLE_VOLUME_SHARE = 0.5;

/** Propellant is stored as a dense liquid in tanks in the middle section, kg/m³. */
export const PROPELLANT_DENSITY = 1000;

/**
 * How densely each type of component packs its mass, kg/m³: reactors, magazines and capacitors
 * are dense; mirrors, accelerators and folded radiator panels take room for their mass.
 */
const DENSITY: Readonly<Record<ComponentType, number>> = {
  drive: 200,
  thrusters: 400,
  reactor: 250,
  capacitor: 500,
  magazine: 800,
  'magnetic-shield': 300,
  'coolant-shield': 300,
  'long-range-scanner': 200,
  'signal-interceptor': 300,
  radiator: 150,
  laser: 100,
  'charged-particle-beam': 100,
  'neutral-particle-beam': 100,
  'kinetic-gun': 150,
  'point-defence': 300,
  launcher: 100,
  sensor: 50,
};

/** The room a component takes in its section, m³; a mounted one's machinery sits inside. */
export const componentVolume = (component: ComponentDesign): number =>
  component.mass / DENSITY[component.type];

/** The room a hull's section has for components and tanks, m³. */
export const sectionVolume = (hullSize: HullSize, kind: SectionKind): number => {
  const shape = HULLS[hullSize].sections.find((s) => s.kind === kind);
  return shape ? shape.length * shape.width * shape.height * USABLE_VOLUME_SHARE : 0;
};

const MOUNTED_TYPES: ReadonlySet<ComponentType> = new Set([
  'radiator',
  'laser',
  'charged-particle-beam',
  'neutral-particle-beam',
  'kinetic-gun',
  'point-defence',
  'launcher',
  'sensor',
]);

export const isMounted = (component: ComponentDesign): component is MountedComponentDesign =>
  MOUNTED_TYPES.has(component.type);

const WEAPON_TYPES: ReadonlySet<ComponentType> = new Set([
  'laser',
  'charged-particle-beam',
  'neutral-particle-beam',
  'kinetic-gun',
  'point-defence',
  'launcher',
]);

/**
 * Where the shipyard tries to put a component, most wanted first: the drive in the engine
 * section; the reactor, thrusters and magnetic shield buried in the middle; radiators along the
 * middle's long sides; sensors forward; a magazine of nuclear missiles anywhere but the middle,
 * where it would take the ship with it. Weapons and coolant shields take each section in turn
 * (see `placeAutomatically`).
 */
const preferredSections = (component: ComponentDesign): readonly SectionKind[] => {
  switch (component.type) {
    case 'drive':
      return ['engine'];
    case 'reactor':
    case 'thrusters':
    case 'magnetic-shield':
      return ['middle', 'forward', 'engine'];
    case 'radiator':
      return ['middle', 'engine', 'forward'];
    case 'sensor':
    case 'capacitor':
      return ['forward', 'middle', 'engine'];
    case 'magazine':
      return component.missile?.warhead.type === 'nuclear'
        ? ['forward', 'engine', 'middle']
        : ['middle', 'forward', 'engine'];
    default:
      return SECTION_KINDS;
  }
};

/** Volume in use in each section. */
type Loads = Record<SectionKind, number>;

/** The order a spread component tries the sections in, starting from the `turn`th. */
const inTurn = (turn: number): readonly SectionKind[] => {
  // Middle first: it is the largest section and the hardest to reach.
  const order = ['middle', 'forward', 'engine'] as const;
  return order.map((_, i) => order[(turn + i) % order.length] ?? 'middle');
};

/**
 * Where each component goes: a manual placement stands; the rest are placed largest first, each
 * in the first of its wanted sections it fits, or the first wanted if it fits nowhere (the
 * section is then over its volume). Weapons and coolant shields are spread, each type taking the
 * sections in turn, so one hit cannot silence every gun and every section has its coolant.
 */
const placeAutomatically = (spec: ShipSpecification): SectionKind[] => {
  const loads: Loads = { forward: 0, middle: spec.propellantMass / PROPELLANT_DENSITY, engine: 0 };
  const placed: (SectionKind | null)[] = spec.components.map(({ component, section }) => {
    if (!section) return null;
    loads[section] += componentVolume(component);
    return section;
  });
  const turns = new Map<ComponentType, number>();
  const order = spec.components
    .map((c, i) => ({ ...c, i }))
    .filter((c) => !c.section)
    .sort((a, b) => componentVolume(b.component) - componentVolume(a.component) || a.i - b.i);
  for (const { component, i } of order) {
    let wanted = preferredSections(component);
    if (WEAPON_TYPES.has(component.type) || component.type === 'coolant-shield') {
      const turn = turns.get(component.type) ?? 0;
      turns.set(component.type, turn + 1);
      wanted = inTurn(turn);
    }
    const volume = componentVolume(component);
    const section =
      wanted.find((kind) => loads[kind] + volume <= sectionVolume(spec.hullSize, kind)) ??
      wanted[0] ??
      'middle';
    loads[section] += volume;
    placed[i] = section;
  }
  return placed.map((section) => section ?? 'middle');
};

/** A design's id from its class name. */
export const designIdFor = (name: string): string =>
  `yard-${
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unnamed'
  }`;

const CLASS_SUFFIX = ' class';

/**
 * The specification that builds a design again: its components section by section, each placed
 * where the design has it.
 */
export const specificationOf = (design: Design): ShipSpecification => ({
  name: design.name.endsWith(CLASS_SUFFIX)
    ? design.name.slice(0, -CLASS_SUFFIX.length)
    : design.name,
  hullSize: design.hullSize,
  components: design.sections.flatMap((s) =>
    [...s.components, ...s.mounts].map((component) => ({ component, section: s.kind })),
  ),
  armour: Object.fromEntries(design.sections.map((s) => [s.kind, s.armour])) as Record<
    SectionKind,
    ArmourDesign
  >,
  propellantMass: design.propellantMass,
  reserve: design.reserve,
});

/** The thickest armour the shipyard fits, m. */
export const MAX_ARMOUR_THICKNESS = 1;

const SINGLE_COMPONENTS = [
  ['drive', 'a drive', 'drives'],
  ['reactor', 'a reactor', 'reactors'],
  ['thrusters', 'thrusters', 'sets of thrusters'],
] as const;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const whole = (value: number) => Math.round(value).toLocaleString('en-GB');
const kmPerS = (metresPerSecond: number) =>
  `${(metresPerSecond / 1000).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} km/s`;

/** What makes a built design invalid, in plain words for the player. */
const validate = (
  spec: ShipSpecification,
  design: Design,
  loads: readonly SectionLoad[],
): string[] => {
  const errors: string[] = [];
  const all = spec.components.map((c) => c.component);
  const count = (type: ComponentType) => all.filter((c) => c.type === type).length;
  if (spec.name.trim() === '') errors.push('Name the design.');
  for (const [type, one, many] of SINGLE_COMPONENTS) {
    const n = count(type);
    if (n === 0) errors.push(`Needs ${one}.`);
    if (n > 1) errors.push(`Has ${n} ${many}; a design takes exactly one.`);
  }
  if (
    design.sections.some((s) => s.kind !== 'engine' && s.components.some((c) => c.type === 'drive'))
  ) {
    errors.push('The drive must be in the engine section.');
  }
  for (const { kind, volume, used } of loads) {
    if (used > volume + 1e-9) {
      errors.push(
        `${capitalise(kind)} section is over its volume: ${whole(used)} of ${whole(volume)} m³.`,
      );
    }
  }
  const magazines = all.filter((c) => c.type === 'magazine');
  if (count('kinetic-gun') > 0 && !magazines.some((m) => m.slugs > 0)) {
    errors.push('Kinetic guns need a magazine of slugs.');
  }
  if (count('launcher') > 0 && !magazines.some((m) => m.missiles > 0)) {
    errors.push('Launchers need a magazine of missiles.');
  }
  if (count('point-defence') > 0 && !magazines.some((m) => m.rounds > 0)) {
    errors.push('Point defence needs a magazine of rounds.');
  }
  for (const kind of SECTION_KINDS) {
    const { thickness } = spec.armour[kind];
    if (!(thickness >= 0 && thickness <= MAX_ARMOUR_THICKNESS)) {
      errors.push(
        `${capitalise(kind)} armour must be from 0 to ${whole(MAX_ARMOUR_THICKNESS * 1000)} mm thick.`,
      );
    }
  }
  if (!(spec.propellantMass >= 0 && Number.isFinite(spec.propellantMass))) {
    errors.push('Propellant must be a mass of 0 or more.');
  }
  if (!(spec.reserve >= 0 && Number.isFinite(spec.reserve))) {
    errors.push('The reserve must be a delta-v of 0 or more.');
  } else if (count('drive') === 1 && errors.length === 0) {
    const deltaV = deltaVWith(design);
    if (spec.reserve >= deltaV) {
      errors.push(
        `The reserve of ${kmPerS(spec.reserve)} must be less than the delta-v of ${kmPerS(deltaV)}.`,
      );
    }
  }
  if (errors.length === 0) {
    // Anything else the battle would refuse, such as two different missiles of the same name.
    try {
      parseDesign(JSON.parse(JSON.stringify(design)));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
};

/** What the shipyard makes of a specification. */
export interface ShipyardResult {
  /** The design as built, whether or not it is valid; only a valid one may be saved or used. */
  readonly design: Design;
  /** What makes the design invalid, in plain words; none when it is valid. */
  readonly errors: readonly string[];
  /** Where each of the specification's components went, in its order. */
  readonly placement: readonly SectionKind[];
  /** The ship's mass with a full load of propellant and ammunition, kg. */
  readonly mass: number;
  /** What a ship of the design costs to build, credits (see `designCost`). */
  readonly cost: number;
  /** Each section's room and how much of it is used, m³, from nose to tail. */
  readonly sections: readonly SectionLoad[];
}

export interface SectionLoad {
  readonly kind: SectionKind;
  /** m³ */
  readonly volume: number;
  /** m³; the middle section's includes the propellant tanks. */
  readonly used: number;
}

/**
 * Builds a specification into a design: places its components, then checks the result. Its
 * components are placed automatically, except those the player placed by hand.
 */
export const buildDesign = (spec: ShipSpecification): ShipyardResult => {
  const placement = placeAutomatically(spec);
  const sections = SECTION_KINDS.map((kind) => {
    const here = spec.components.filter((_, i) => placement[i] === kind).map((c) => c.component);
    return {
      kind,
      armour: spec.armour[kind],
      components: here.filter((c): c is InternalComponentDesign => !isMounted(c)),
      mounts: here.filter(isMounted),
    };
  });
  const design: Design = {
    id: designIdFor(spec.name),
    name: `${spec.name.trim()} class`,
    hullSize: spec.hullSize,
    sections,
    propellantMass: spec.propellantMass,
    reserve: spec.reserve,
  };
  const loads = SECTION_KINDS.map((kind) => ({
    kind,
    volume: sectionVolume(spec.hullSize, kind),
    used: spec.components.reduce(
      (total, { component }, i) =>
        placement[i] === kind ? total + componentVolume(component) : total,
      kind === 'middle' ? spec.propellantMass / PROPELLANT_DENSITY : 0,
    ),
  }));
  return {
    design,
    errors: validate(spec, design, loads),
    placement,
    mass: massProperties(design, design.propellantMass).mass,
    cost: designCost(design),
    sections: loads,
  };
};
