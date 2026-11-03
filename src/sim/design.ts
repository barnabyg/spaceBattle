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

/** What every particle beam weapon has: an accelerator and the emitter that aims its beam. */
interface ParticleBeamBase {
  /** kg */
  readonly mass: number;
  /** Power carried off in the beam while firing, W. */
  readonly beamPower: number;
  /**
   * Fraction of the electrical power drawn that the accelerator puts into its particles; the
   * rest is heat (0–1).
   */
  readonly efficiency: number;
  /** Diameter of the beam as it leaves the emitter, m. */
  readonly aperture: number;
  /** Half-angle the beam spreads at as it leaves, from its particles' spread of motion, rad. */
  readonly divergence: number;
}

/**
 * A weapon firing a beam of charged particles (protons) at near light speed. Its own charge
 * pushes the beam apart, so it spreads faster the further it goes.
 */
export interface ChargedParticleBeamDesign extends ParticleBeamBase {
  readonly type: 'charged-particle-beam';
  /** Kinetic energy of each proton, J; the faster they are, the less they push apart. */
  readonly particleEnergy: number;
}

/**
 * A weapon firing a beam of neutral hydrogen atoms: negative ions accelerated, then stripped of
 * their extra electron. It stays tight, but much of the beam is lost in the stripping.
 */
export interface NeutralParticleBeamDesign extends ParticleBeamBase {
  readonly type: 'neutral-particle-beam';
}

export type ParticleBeamDesign = ChargedParticleBeamDesign | NeutralParticleBeamDesign;

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

/**
 * A short-range, rapid-fire gun that shoots down incoming missiles. It fires bursts of small
 * rounds that spread in a narrow cone, so it hits a missile more often the closer it is. Each
 * burst takes the rounds' ½mv² over its efficiency in electrical energy, and its rounds from a
 * magazine. Its captain can let it fire on the enemy ship too, which its rounds barely mark.
 */
export interface PointDefenceDesign {
  readonly type: 'point-defence';
  /** kg */
  readonly mass: number;
  /** Mass of each round, kg. */
  readonly roundMass: number;
  /** Speed it gives a round relative to the ship, m/s. */
  readonly muzzleVelocity: number;
  /** Fraction of the electrical energy drawn that the rounds carry off; the rest is heat (0–1). */
  readonly efficiency: number;
  /** Rounds in each burst. */
  readonly roundsPerBurst: number;
  /** Bursts per second, given full power. */
  readonly burstRate: number;
  /** Half-angle of the cone its rounds spread through, rad. */
  readonly dispersion: number;
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

/**
 * The warhead of an anti-missile missile. Its proximity fuse sets it off near the enemy missile it
 * is after, and it bursts into a cloud of fragments flung ahead through a cone; at the speeds
 * missiles meet, a single fragment wrecks a missile. It does nothing to ships.
 */
export interface FragmentationWarheadDesign {
  readonly type: 'fragmentation';
  /** How many fragments it bursts into. */
  readonly fragments: number;
  /** Mass of each fragment, kg; together they are part of the missile's dry mass. */
  readonly fragmentMass: number;
  /** How close to its target missile the proximity fuse sets it off, m. */
  readonly burstDistance: number;
  /** Half-angle of the cone its fragments spread through, rad; less than a right angle. */
  readonly spread: number;
}

export type WarheadDesign =
  KineticWarheadDesign | NuclearWarheadDesign | FragmentationWarheadDesign;
export const WARHEAD_TYPES = ['kinetic', 'nuclear', 'fragmentation'] as const;
export type WarheadType = WarheadDesign['type'];

/**
 * What a missile is for: striking enemy ships, or, with a fragmentation warhead, intercepting
 * enemy missiles as an anti-missile missile.
 */
export type MissileRole = 'anti-ship' | 'anti-missile';

/** What a missile design is for, by its warhead. */
export const missileRole = (missile: MissileDesign): MissileRole =>
  missile.warhead.type === 'fragmentation' ? 'anti-missile' : 'anti-ship';

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
 * Stores ammunition inside a section: slugs for the ship's kinetic guns, rounds for its point
 * defence, or missiles of one design for its launchers; only one of them. It starts every battle
 * full.
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
  /** How many point defence rounds it holds. */
  readonly rounds: number;
  /** How many missiles it holds. */
  readonly missiles: number;
  /** The missiles it holds; null when it holds none. */
  readonly missile: MissileDesign | null;
}

/**
 * A shield whose field coils, inside a section, wrap the whole ship in a magnetic field that bends
 * charged particle beams away; it has no effect on any other weapon. A proton is bent through an
 * angle in proportion to the field over its momentum, so the field turns softer beams clear of
 * the ship entirely and only part of a harder one. Its coils' power holds the field up: the field
 * goes as the square root of the power they get, and with their integrity.
 */
export interface MagneticShieldDesign {
  readonly type: 'magnetic-shield';
  /** kg */
  readonly mass: number;
  /** Electrical power its coils draw while it is raised, W; all of it ends up as heat. */
  readonly power: number;
  /**
   * Kinetic energy of the most energetic protons it turns away entirely at full power and
   * integrity, J. Of a beam of harder protons it turns away the share of this one's momentum to
   * theirs.
   */
  readonly maxParticleEnergy: number;
}

/**
 * A shield of pumped coolant channels beneath a section's armour. Where a laser lands on the
 * section it carries the beam's heat away from the point of impact into the ship's heat, for the
 * radiators to shed, so the armour does not burn away. It protects only the section it is in, and
 * has no effect on particle beams, which heat the armour through its depth, or on slugs.
 */
export interface CoolantShieldDesign {
  readonly type: 'coolant-shield';
  /** kg */
  readonly mass: number;
  /** Electrical power its pumps draw while it is raised, W; all of it ends up as heat. */
  readonly power: number;
  /**
   * The most laser power it can carry away at full power and integrity, W; with less power its
   * pumps carry less, in proportion.
   */
  readonly capacity: number;
}

export type ShieldDesign = MagneticShieldDesign | CoolantShieldDesign;

/**
 * A telescope that observes other ships. Diffraction sets the finest detail it makes out: at range
 * r, about 1.22·λ·r/D (see `sensorResolution`), so a larger mirror or a shorter wavelength makes
 * out more from further off. It also tracks a contact's position for fire control, to within an
 * angle of `trackingError`.
 */
export interface SensorDesign {
  readonly type: 'sensor';
  /** kg */
  readonly mass: number;
  /** Diameter of its mirror, m. */
  readonly aperture: number;
  /** The wavelength it observes at, m. */
  readonly wavelength: number;
  /**
   * The angle it tracks a contact's position to, as a standard deviation across the line of
   * sight, rad: the smaller, the more precise.
   */
  readonly trackingError: number;
}
export type ShieldType = ShieldDesign['type'];

/** Components that sit inside a section's armour. */
export type InternalComponentDesign =
  | DriveDesign
  | ThrustersDesign
  | ReactorDesign
  | CapacitorDesign
  | MagazineDesign
  | MagneticShieldDesign
  | CoolantShieldDesign;
/** Components that must be exposed, on a section's mounts. */
export type MountedComponentDesign =
  | RadiatorDesign
  | LaserDesign
  | ChargedParticleBeamDesign
  | NeutralParticleBeamDesign
  | KineticGunDesign
  | PointDefenceDesign
  | LauncherDesign
  | SensorDesign;
export type ComponentDesign = InternalComponentDesign | MountedComponentDesign;
export type ComponentType = ComponentDesign['type'];

const INTERNAL_TYPES = [
  'drive',
  'thrusters',
  'reactor',
  'capacitor',
  'magazine',
  'magnetic-shield',
  'coolant-shield',
] as const;
const MOUNTED_TYPES = [
  'radiator',
  'laser',
  'charged-particle-beam',
  'neutral-particle-beam',
  'kinetic-gun',
  'point-defence',
  'launcher',
  'sensor',
] as const;

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
  /** The delta-v held back for withdrawal, m/s. */
  readonly reserve: number;
}

const componentsOf = new WeakMap<
  Design,
  readonly { component: ComponentDesign; section: SectionKind }[]
>();

/** Every component of a design, inside sections and on mounts, with the section it belongs to. */
export const designComponents = (
  design: Design,
): readonly { component: ComponentDesign; section: SectionKind }[] => {
  // Designs never change, and the battle asks for their components many times a step.
  const cached = componentsOf.get(design);
  if (cached) return cached;
  const components = design.sections.flatMap((section) =>
    [...section.components, ...section.mounts].map((component) => ({
      component,
      section: section.kind,
    })),
  );
  componentsOf.set(design, components);
  return components;
};

const componentsOfType = new WeakMap<Design, Map<ComponentType, readonly ComponentDesign[]>>();

/** All of a design's components of one type. */
export const designComponentsOfType = <T extends ComponentType>(
  design: Design,
  type: T,
): readonly Extract<ComponentDesign, { type: T }>[] => {
  let byType = componentsOfType.get(design);
  if (!byType) {
    byType = new Map();
    componentsOfType.set(design, byType);
  }
  let found = byType.get(type);
  if (!found) {
    found = designComponents(design)
      .map(({ component }) => component)
      .filter((component) => component.type === type);
    byType.set(type, found);
  }
  return found as readonly Extract<ComponentDesign, { type: T }>[];
};

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
    case 'charged-particle-beam':
      return {
        ...parseParticleBeam(data, mass, where),
        type,
        particleEnergy: requireNumber(data, 'particleEnergy', where),
      };
    case 'neutral-particle-beam':
      return { ...parseParticleBeam(data, mass, where), type };
    case 'kinetic-gun':
      return {
        type,
        mass,
        slugMass: requireNumber(data, 'slugMass', where),
        muzzleVelocity: requireNumber(data, 'muzzleVelocity', where),
        efficiency: requireFraction(data, 'efficiency', where),
        rateOfFire: requireNumber(data, 'rateOfFire', where),
      };
    case 'point-defence': {
      const roundsPerBurst = requireNumber(data, 'roundsPerBurst', where);
      if (!Number.isInteger(roundsPerBurst)) {
        throw new Error(`${where}: "roundsPerBurst" must be a whole number`);
      }
      return {
        type,
        mass,
        roundMass: requireNumber(data, 'roundMass', where),
        muzzleVelocity: requireNumber(data, 'muzzleVelocity', where),
        efficiency: requireFraction(data, 'efficiency', where),
        roundsPerBurst,
        burstRate: requireNumber(data, 'burstRate', where),
        dispersion: requireNumber(data, 'dispersion', where),
      };
    }
    case 'launcher':
      return { type, mass, reloadTime: requireNumber(data, 'reloadTime', where) };
    case 'sensor':
      return {
        type,
        mass,
        aperture: requireNumber(data, 'aperture', where),
        wavelength: requireNumber(data, 'wavelength', where),
        trackingError: requireNumber(data, 'trackingError', where),
      };
    case 'magazine':
      return parseMagazine(data, mass, where);
    case 'magnetic-shield':
      return {
        type,
        mass,
        power: requireNumber(data, 'power', where),
        maxParticleEnergy: requireNumber(data, 'maxParticleEnergy', where),
      };
    case 'coolant-shield':
      return {
        type,
        mass,
        power: requireNumber(data, 'power', where),
        capacity: requireNumber(data, 'capacity', where),
      };
  }
};

const parseParticleBeam = (data: Record<string, unknown>, mass: number, where: string) => ({
  mass,
  beamPower: requireNumber(data, 'beamPower', where),
  efficiency: requireFraction(data, 'efficiency', where),
  aperture: requireNumber(data, 'aperture', where),
  divergence: requireNumber(data, 'divergence', where),
});

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
    case 'fragmentation': {
      const fragments = requireNumber(data, 'fragments', where);
      if (!Number.isInteger(fragments)) {
        throw new Error(`${where}: "fragments" must be a whole number`);
      }
      const spread = requireNumber(data, 'spread', where);
      if (spread >= Math.PI / 2) throw new Error(`${where}: "spread" must be under a right angle`);
      return {
        type,
        fragments,
        fragmentMass: requireNumber(data, 'fragmentMass', where),
        burstDistance: requireNumber(data, 'burstDistance', where),
        spread,
      };
    }
  }
};

const parseMissile = (data: unknown, where: string): MissileDesign => {
  if (!isRecord(data)) throw new Error(`${where}: "missile" must be an object`);
  const missile: MissileDesign = {
    name: requireString(data, 'name', where),
    dryMass: requireNumber(data, 'dryMass', where),
    propellantMass: requireNumber(data, 'propellantMass', where, { positive: false }),
    thrust: requireNumber(data, 'thrust', where),
    exhaustVelocity: requireNumber(data, 'exhaustVelocity', where),
    warhead: parseWarhead(data.warhead, `${where} warhead`),
  };
  const { warhead } = missile;
  if (
    warhead.type === 'fragmentation' &&
    warhead.fragments * warhead.fragmentMass >= missile.dryMass
  ) {
    throw new Error(`${where}: "dryMass" must be more than the warhead's fragments`);
  }
  return missile;
};

const parseMagazine = (data: Record<string, unknown>, mass: number, where: string) => {
  const slugs = requireCount(data, 'slugs', where);
  const rounds = requireCount(data, 'rounds', where);
  const missiles = requireCount(data, 'missiles', where);
  const kinds = [slugs, rounds, missiles].filter((count) => count > 0).length;
  if (kinds > 1) throw new Error(`${where}: a magazine holds slugs, rounds or missiles, not more`);
  if (kinds === 0) throw new Error(`${where}: a magazine needs slugs, rounds or missiles`);
  if (missiles === 0) {
    if (data.missile !== undefined && data.missile !== null) {
      throw new Error(`${where}: "missile" needs "missiles"`);
    }
    return { type: 'magazine', mass, slugs, rounds, missiles, missile: null } as const;
  }
  const missile = parseMissile(data.missile, `${where} missile`);
  if (missiles * missileMass(missile) >= mass) {
    throw new Error(`${where}: "mass" must be more than the missiles it holds`);
  }
  return { type: 'magazine', mass, slugs, rounds, missiles, missile } as const;
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
  const reserve = requireNumber(data, 'reserve', where, { positive: false });
  if (!Array.isArray(data.sections)) throw new Error(`${where}: "sections" must be a list`);
  const sections = data.sections.map((s) => parseSection(s, where));
  if (sections.map((s) => s.kind).join() !== SECTION_KINDS.join()) {
    throw new Error(`${where}: needs exactly the sections ${SECTION_KINDS.join(', ')}, in order`);
  }
  const design: Design = { id, name, hullSize, sections, propellantMass, reserve };
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
  const pointDefence = designComponentsOfType(design, 'point-defence');
  if (pointDefence.length > 0 && !magazines.some((m) => m.rounds > 0)) {
    throw new Error(`${where}: point defence needs a magazine for its rounds`);
  }
  const heaviestRound = Math.max(0, ...pointDefence.map((gun) => gun.roundMass));
  if (magazines.some((m) => m.rounds * heaviestRound >= m.mass)) {
    throw new Error(`${where}: a magazine's "mass" must be more than the rounds it holds`);
  }
  if (
    designComponentsOfType(design, 'launcher').length > 0 &&
    !magazines.some((m) => m.missiles > 0)
  ) {
    throw new Error(`${where}: launchers need a magazine of missiles`);
  }
  // Orders name the missiles to launch, so a name stands for one missile design.
  const missiles = new Map<string, string>();
  for (const { missile } of magazines) {
    if (!missile) continue;
    const known = missiles.get(missile.name);
    if (known !== undefined && known !== JSON.stringify(missile)) {
      throw new Error(`${where}: two different missiles are named "${missile.name}"`);
    }
    missiles.set(missile.name, JSON.stringify(missile));
  }
  return design;
};
