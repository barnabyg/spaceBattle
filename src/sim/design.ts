export const HULL_SIZES = ['frigate', 'cruiser', 'battleship'] as const;
export type HullSize = (typeof HULL_SIZES)[number];

/** Sections from nose to tail. */
export const SECTION_KINDS = ['forward', 'middle', 'engine'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The drive; it pushes along the ship's long axis. */
export interface DriveDesign {
  readonly type: 'drive';
  /** kg */
  readonly mass: number;
  /** Thrust at full throttle, N. */
  readonly thrust: number;
  /** m/s */
  readonly exhaustVelocity: number;
  /**
   * Electrical power drawn at full throttle, W, in proportion to thrust. It runs ignition and
   * the magnetic nozzle; the exhaust's kinetic energy comes mostly from the propellant itself.
   */
  readonly power: number;
  /** Fraction of the drive's electrical power that ends up as heat in the ship (0–1). */
  readonly wasteHeatFraction: number;
}

/** Small jets that rotate the ship. */
export interface ThrustersDesign {
  readonly type: 'thrusters';
  /** kg */
  readonly mass: number;
  /** The largest torque they can apply about any axis, N·m. */
  readonly torque: number;
}

/** Generates the ship's power; it only produces what the ship draws. */
export interface ReactorDesign {
  readonly type: 'reactor';
  /** kg */
  readonly mass: number;
  /** Electrical output at full power, W. */
  readonly output: number;
  /** Fraction of the reactor's thermal power that becomes electrical power; the rest is heat. */
  readonly efficiency: number;
}

/** Stores power for later use. */
export interface CapacitorDesign {
  readonly type: 'capacitor';
  /** kg */
  readonly mass: number;
  /** Energy it can hold, J. */
  readonly capacity: number;
  /** Fastest it can charge, W. */
  readonly maxCharge: number;
  /** Fastest it can discharge, W. */
  readonly maxDischarge: number;
}

/** Sheds heat into space from its surface; it sheds more when deployed. */
export interface RadiatorDesign {
  readonly type: 'radiator';
  /** kg */
  readonly mass: number;
  /** Radiating area when deployed, both faces counted, m². */
  readonly deployedArea: number;
  /** Radiating area left exposed when retracted against the hull, m². */
  readonly retractedArea: number;
  /** How close its surface comes to a perfect black body (0–1). */
  readonly emissivity: number;
}

/** A weapon firing light; its beam spreads by diffraction, so it weakens with range. */
export interface LaserDesign {
  readonly type: 'laser';
  /** kg */
  readonly mass: number;
  /** Power carried off in the beam while firing, W. */
  readonly beamPower: number;
  /** Fraction of the electrical power drawn that leaves in the beam; the rest is heat (0–1). */
  readonly efficiency: number;
  /** Diameter of the focusing mirror, m. */
  readonly aperture: number;
  /** m */
  readonly wavelength: number;
}

/**
 * A weapon firing solid slugs accelerated electromagnetically. Each shot takes ½mv²/efficiency
 * of electrical energy, which it draws from the ship between shots, and one slug of ammunition.
 */
export interface KineticGunDesign {
  readonly type: 'kinetic-gun';
  /** kg */
  readonly mass: number;
  /** Mass of each slug, kg. */
  readonly slugMass: number;
  /** Speed it gives a slug relative to the ship, m/s. */
  readonly muzzleVelocity: number;
  /** Fraction of the electrical energy drawn that the slug carries off; the rest is heat (0–1). */
  readonly efficiency: number;
  /** Shots per second, given full power. */
  readonly rateOfFire: number;
}

/** A missile warhead: what it does on reaching its target. */
export interface KineticWarheadDesign {
  /** Destroys by hitting the target directly, with the whole missile's kinetic energy. */
  readonly type: 'kinetic';
}

/** The energy of a kiloton of TNT, J. */
export const KILOTON = 4.184e12;
/** The largest yield a nuclear warhead may have for now, J: 10 kt. */
export const MAX_NUCLEAR_YIELD = 10 * KILOTON;

/**
 * A low-yield nuclear warhead. Its proximity fuse sets it off near the target, which it damages
 * with radiation and heat that fall with the square of distance; or it goes off on striking it.
 */
export interface NuclearWarheadDesign {
  readonly type: 'nuclear';
  /** Energy released, J; at most `MAX_NUCLEAR_YIELD`. */
  readonly yield: number;
  /**
   * How close to the target's centre of mass the proximity fuse sets it off, m; at 0 it goes off
   * only on striking the target.
   */
  readonly detonationDistance: number;
}

export type WarheadDesign = KineticWarheadDesign | NuclearWarheadDesign;
export const WARHEAD_TYPES = ['kinetic', 'nuclear'] as const;
export type WarheadType = WarheadDesign['type'];

/**
 * A guided missile: a point mass with its own drive, which can point its thrust any way, and its
 * own propellant, so its own delta-v by the rocket equation. It is ammunition, held in a
 * magazine and fired from a launcher.
 */
export interface MissileDesign {
  readonly name: string;
  /** Everything but its propellant: body, drive, guidance and warhead, kg. */
  readonly dryMass: number;
  /** kg */
  readonly propellantMass: number;
  /** Its drive's thrust at full throttle, N. */
  readonly thrust: number;
  /** m/s */
  readonly exhaustVelocity: number;
  readonly warhead: WarheadDesign;
}

/** A missile's mass as launched, with all its propellant, kg. */
export const missileMass = (missile: MissileDesign): number =>
  missile.dryMass + missile.propellantMass;

/** A mounted component that fires missiles from the ship's magazines, one at a time. */
export interface LauncherDesign {
  readonly type: 'launcher';
  /** kg */
  readonly mass: number;
  /** Time to load the next missile after a launch, s. */
  readonly reloadTime: number;
}

/**
 * Stores ammunition inside a section: slugs for the ship's kinetic guns, or missiles of one
 * design for its launchers, never both. It starts every battle full.
 */
export interface MagazineDesign {
  readonly type: 'magazine';
  /**
   * kg, with its ammunition. The ship gets lighter by each slug fired or missile launched from
   * it.
   */
  readonly mass: number;
  /** How many slugs it holds. */
  readonly slugs: number;
  /** How many missiles it holds. */
  readonly missiles: number;
  /** The missiles it holds; null when it holds none. */
  readonly missile: MissileDesign | null;
}

/** Components that sit inside a section's armour. */
export type InternalComponentDesign =
  DriveDesign | ThrustersDesign | ReactorDesign | CapacitorDesign | MagazineDesign;
/** Components that must be exposed, on a section's mounts. */
export type MountedComponentDesign =
  RadiatorDesign | LaserDesign | KineticGunDesign | LauncherDesign;
export type ComponentDesign = InternalComponentDesign | MountedComponentDesign;
export type ComponentType = ComponentDesign['type'];

const INTERNAL_TYPES = ['drive', 'thrusters', 'reactor', 'capacitor', 'magazine'] as const;
const MOUNTED_TYPES = ['radiator', 'laser', 'kinetic-gun', 'launcher'] as const;

export const ARMOUR_TYPES = ['heavy', 'ablative'] as const;
export type ArmourType = (typeof ARMOUR_TYPES)[number];

/** A section's armour: one type, one thickness over its whole outer surface. */
export interface ArmourDesign {
  readonly type: ArmourType;
  /** m */
  readonly thickness: number;
}

/** A section with no armour. */
export const NO_ARMOUR: ArmourDesign = { type: 'heavy', thickness: 0 };

export interface SectionDesign {
  readonly kind: SectionKind;
  readonly armour: ArmourDesign;
  /** Components inside the section's armour. */
  readonly components: readonly InternalComponentDesign[];
  /** Exposed components on the outside of the section. */
  readonly mounts: readonly MountedComponentDesign[];
}

/** A reusable design for a ship: a hull plus the components in each section. */
export interface Design {
  readonly id: string;
  readonly name: string;
  readonly hullSize: HullSize;
  /** One of each section kind, from nose to tail. */
  readonly sections: readonly SectionDesign[];
  /** Propellant carried at the start of a battle, kg. */
  readonly propellantMass: number;
}

/** Every component of a design, inside sections and on mounts, with the section it belongs to. */
export const designComponents = (
  design: Design,
): readonly { component: ComponentDesign; section: SectionKind }[] =>
  design.sections.flatMap((section) =>
    [...section.components, ...section.mounts].map((component) => ({
      component,
      section: section.kind,
    })),
  );

/** All of a design's components of one type. */
export const designComponentsOfType = <T extends ComponentType>(
  design: Design,
  type: T,
): readonly Extract<ComponentDesign, { type: T }>[] =>
  designComponents(design)
    .map(({ component }) => component)
    .filter(
      (component): component is Extract<ComponentDesign, { type: T }> => component.type === type,
    );

/** The design's single component of a type that every design has exactly one of. */
export const designComponent = <T extends 'drive' | 'thrusters' | 'reactor'>(
  design: Design,
  type: T,
): Extract<ComponentDesign, { type: T }> => {
  const found = designComponentsOfType(design, type)[0];
  if (!found) throw new Error(`Design "${design.id}" has no ${type}`);
  return found;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (data: Record<string, unknown>, key: string, where: string): string => {
  const value = data[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
};

const requireNumber = (
  data: Record<string, unknown>,
  key: string,
  where: string,
  { positive = true } = {},
): number => {
  const value = data[key];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (positive && value === 0)
  ) {
    throw new Error(
      `${where}: "${key}" must be a ${positive ? 'positive' : 'non-negative'} number`,
    );
  }
  return value;
};

/** A number from 0 to 1, or above 0 to 1 when it must be positive. */
const requireFraction = (
  data: Record<string, unknown>,
  key: string,
  where: string,
  { positive = true } = {},
): number => {
  const value = data[key];
  if (typeof value !== 'number' || !(value <= 1 && (positive ? value > 0 : value >= 0))) {
    throw new Error(
      `${where}: "${key}" must be a fraction ${positive ? 'above 0' : 'from 0'} to 1`,
    );
  }
  return value;
};

const requireOneOf = <T extends string>(
  data: Record<string, unknown>,
  key: string,
  options: readonly T[],
  where: string,
): T => {
  const value = requireString(data, key, where);
  if (!(options as readonly string[]).includes(value)) {
    throw new Error(`${where}: unknown ${key} "${value}"`);
  }
  return value as T;
};

const parseComponent = (data: unknown, where: string): ComponentDesign => {
  if (!isRecord(data)) throw new Error(`${where}: expected a component object`);
  const type = requireOneOf(data, 'type', [...INTERNAL_TYPES, ...MOUNTED_TYPES], where);
  const mass = requireNumber(data, 'mass', where);
  switch (type) {
    case 'drive':
      return {
        type,
        mass,
        thrust: requireNumber(data, 'thrust', where),
        exhaustVelocity: requireNumber(data, 'exhaustVelocity', where),
        power: requireNumber(data, 'power', where),
        wasteHeatFraction: requireFraction(data, 'wasteHeatFraction', where, { positive: false }),
      };
    case 'thrusters':
      return { type, mass, torque: requireNumber(data, 'torque', where) };
    case 'reactor':
      return {
        type,
        mass,
        output: requireNumber(data, 'output', where),
        efficiency: requireFraction(data, 'efficiency', where),
      };
    case 'capacitor':
      return {
        type,
        mass,
        capacity: requireNumber(data, 'capacity', where),
        maxCharge: requireNumber(data, 'maxCharge', where),
        maxDischarge: requireNumber(data, 'maxDischarge', where),
      };
    case 'radiator': {
      const deployedArea = requireNumber(data, 'deployedArea', where);
      const retractedArea = requireNumber(data, 'retractedArea', where, { positive: false });
      if (retractedArea > deployedArea) {
        throw new Error(`${where}: "retractedArea" must not exceed "deployedArea"`);
      }
      return {
        type,
        mass,
        deployedArea,
        retractedArea,
        emissivity: requireFraction(data, 'emissivity', where),
      };
    }
    case 'laser':
      return {
        type,
        mass,
        beamPower: requireNumber(data, 'beamPower', where),
        efficiency: requireFraction(data, 'efficiency', where),
        aperture: requireNumber(data, 'aperture', where),
        wavelength: requireNumber(data, 'wavelength', where),
      };
    case 'kinetic-gun':
      return {
        type,
        mass,
        slugMass: requireNumber(data, 'slugMass', where),
        muzzleVelocity: requireNumber(data, 'muzzleVelocity', where),
        efficiency: requireFraction(data, 'efficiency', where),
        rateOfFire: requireNumber(data, 'rateOfFire', where),
      };
    case 'launcher':
      return { type, mass, reloadTime: requireNumber(data, 'reloadTime', where) };
    case 'magazine':
      return parseMagazine(data, mass, where);
  }
};

const requireCount = (data: Record<string, unknown>, key: string, where: string): number => {
  if (data[key] === undefined) return 0;
  const count = requireNumber(data, key, where, { positive: false });
  if (!Number.isInteger(count)) throw new Error(`${where}: "${key}" must be a whole number`);
  return count;
};

const parseWarhead = (data: unknown, where: string): WarheadDesign => {
  if (!isRecord(data)) throw new Error(`${where}: "warhead" must be an object`);
  const type = requireOneOf(data, 'type', WARHEAD_TYPES, where);
  switch (type) {
    case 'kinetic':
      return { type };
    case 'nuclear': {
      const energy = requireNumber(data, 'yield', where);
      if (energy > MAX_NUCLEAR_YIELD) {
        throw new Error(`${where}: "yield" must be at most 10 kt (${MAX_NUCLEAR_YIELD} J)`);
      }
      return {
        type,
        yield: energy,
        detonationDistance: requireNumber(data, 'detonationDistance', where, { positive: false }),
      };
    }
  }
};

const parseMissile = (data: unknown, where: string): MissileDesign => {
  if (!isRecord(data)) throw new Error(`${where}: "missile" must be an object`);
  return {
    name: requireString(data, 'name', where),
    dryMass: requireNumber(data, 'dryMass', where),
    propellantMass: requireNumber(data, 'propellantMass', where, { positive: false }),
    thrust: requireNumber(data, 'thrust', where),
    exhaustVelocity: requireNumber(data, 'exhaustVelocity', where),
    warhead: parseWarhead(data.warhead, `${where} warhead`),
  };
};

const parseMagazine = (data: Record<string, unknown>, mass: number, where: string) => {
  const slugs = requireCount(data, 'slugs', where);
  const missiles = requireCount(data, 'missiles', where);
  if (slugs > 0 && missiles > 0) {
    throw new Error(`${where}: a magazine holds slugs or missiles, not both`);
  }
  if (slugs + missiles === 0) throw new Error(`${where}: a magazine needs slugs or missiles`);
  if (missiles === 0) {
    if (data.missile !== undefined) throw new Error(`${where}: "missile" needs "missiles"`);
    return { type: 'magazine', mass, slugs, missiles, missile: null } as const;
  }
  const missile = parseMissile(data.missile, `${where} missile`);
  if (missiles * missileMass(missile) >= mass) {
    throw new Error(`${where}: "mass" must be more than the missiles it holds`);
  }
  return { type: 'magazine', mass, slugs, missiles, missile } as const;
};

const parseArmour = (data: unknown, where: string): ArmourDesign => {
  if (data === undefined) return NO_ARMOUR;
  if (!isRecord(data)) throw new Error(`${where}: "armour" must be an object`);
  return {
    type: requireOneOf(data, 'type', ARMOUR_TYPES, `${where} armour`),
    thickness: requireNumber(data, 'thickness', `${where} armour`, { positive: false }),
  };
};

const isMounted = (component: ComponentDesign): component is MountedComponentDesign =>
  (MOUNTED_TYPES as readonly string[]).includes(component.type);

const parseSection = (data: unknown, where: string): SectionDesign => {
  if (!isRecord(data)) throw new Error(`${where}: expected a section object`);
  const kind = requireOneOf(data, 'kind', SECTION_KINDS, where);
  const { components: componentData, mounts: mountData = [] } = data;
  if (!Array.isArray(componentData)) throw new Error(`${where}: "components" must be a list`);
  if (!Array.isArray(mountData)) throw new Error(`${where}: "mounts" must be a list`);
  const components = componentData.map((c, i) => {
    const component = parseComponent(c, `${where} ${kind} component ${i + 1}`);
    if (isMounted(component)) {
      throw new Error(`${where}: a ${component.type} goes on a mount, not inside a section`);
    }
    return component;
  });
  const mounts = mountData.map((c, i) => {
    const component = parseComponent(c, `${where} ${kind} mount ${i + 1}`);
    if (!isMounted(component)) {
      throw new Error(`${where}: a ${component.type} goes inside a section, not on a mount`);
    }
    return component;
  });
  return { kind, armour: parseArmour(data.armour, `${where} ${kind}`), components, mounts };
};

/** Reads a design from untrusted data, such as a design file, throwing if it is invalid. */
export const parseDesign = (data: unknown): Design => {
  if (!isRecord(data)) throw new Error('Design: expected an object');
  const id = requireString(data, 'id', 'Design');
  const where = `Design "${id}"`;
  const name = requireString(data, 'name', where);
  const hullSize = requireOneOf(data, 'hullSize', HULL_SIZES, where);
  const propellantMass = requireNumber(data, 'propellantMass', where, { positive: false });
  if (!Array.isArray(data.sections)) throw new Error(`${where}: "sections" must be a list`);
  const sections = data.sections.map((s) => parseSection(s, where));
  if (sections.map((s) => s.kind).join() !== SECTION_KINDS.join()) {
    throw new Error(`${where}: needs exactly the sections ${SECTION_KINDS.join(', ')}, in order`);
  }
  const design: Design = { id, name, hullSize, sections, propellantMass };
  for (const type of ['drive', 'thrusters', 'reactor'] as const) {
    const count = designComponentsOfType(design, type).length;
    if (count !== 1) throw new Error(`${where}: needs exactly one ${type}, has ${count}`);
  }
  if (
    !designComponents(design).some((c) => c.component.type === 'drive' && c.section === 'engine')
  ) {
    throw new Error(`${where}: the drive must be in the engine section`);
  }
  const magazines = designComponentsOfType(design, 'magazine');
  const guns = designComponentsOfType(design, 'kinetic-gun');
  if (guns.length > 0 && !magazines.some((m) => m.slugs > 0)) {
    throw new Error(`${where}: kinetic guns need a magazine for their slugs`);
  }
  // Any gun may fire a magazine's slugs, so it must weigh more than its slugs for the heaviest.
  const heaviestSlug = Math.max(0, ...guns.map((gun) => gun.slugMass));
  if (magazines.some((m) => m.slugs * heaviestSlug >= m.mass)) {
    throw new Error(`${where}: a magazine's "mass" must be more than the slugs it holds`);
  }
  if (
    designComponentsOfType(design, 'launcher').length > 0 &&
    !magazines.some((m) => m.missiles > 0)
  ) {
    throw new Error(`${where}: launchers need a magazine of missiles`);
  }
  return design;
};
