export const HULL_SIZES = ['frigate', 'cruiser', 'battleship'] as const;
export type HullSize = (typeof HULL_SIZES)[number];

/** Sections from nose to tail. */
export const SECTION_KINDS = ['forward', 'middle', 'engine'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The main engine; it pushes along the ship's long axis. */
export interface DriveDesign {
  readonly type: 'drive';
  /** kg */
  readonly mass: number;
  /** Thrust at full throttle, N. */
  readonly thrust: number;
  /** m/s */
  readonly exhaustVelocity: number;
}

/** Small jets that rotate the ship. */
export interface ThrustersDesign {
  readonly type: 'thrusters';
  /** kg */
  readonly mass: number;
  /** The largest torque they can apply about any axis, N·m. */
  readonly torque: number;
}

export type ComponentDesign = DriveDesign | ThrustersDesign;
export type ComponentType = ComponentDesign['type'];

export interface SectionDesign {
  readonly kind: SectionKind;
  /** Components inside the section's armour. */
  readonly components: readonly ComponentDesign[];
}

/** A reusable blueprint for a ship. */
export interface Design {
  readonly id: string;
  readonly name: string;
  readonly hullSize: HullSize;
  /** One of each section kind, from nose to tail. */
  readonly sections: readonly SectionDesign[];
  /** Propellant carried at the start of a battle, kg. */
  readonly propellantMass: number;
}

/** Every component of a design, with the section it sits in. */
export const designComponents = (
  design: Design,
): readonly { component: ComponentDesign; section: SectionKind }[] =>
  design.sections.flatMap((section) =>
    section.components.map((component) => ({ component, section: section.kind })),
  );

/** The design's single component of a type that every design has exactly one of. */
export const designComponent = <T extends ComponentType>(
  design: Design,
  type: T,
): Extract<ComponentDesign, { type: T }> => {
  const found = designComponents(design).find(({ component }) => component.type === type);
  if (!found) throw new Error(`Design "${design.id}" has no ${type}`);
  return found.component as Extract<ComponentDesign, { type: T }>;
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
  const type = requireOneOf(data, 'type', ['drive', 'thrusters'] as const, where);
  const mass = requireNumber(data, 'mass', where);
  switch (type) {
    case 'drive':
      return {
        type,
        mass,
        thrust: requireNumber(data, 'thrust', where),
        exhaustVelocity: requireNumber(data, 'exhaustVelocity', where),
      };
    case 'thrusters':
      return { type, mass, torque: requireNumber(data, 'torque', where) };
  }
};

const parseSection = (data: unknown, where: string): SectionDesign => {
  if (!isRecord(data)) throw new Error(`${where}: expected a section object`);
  const kind = requireOneOf(data, 'kind', SECTION_KINDS, where);
  const components = data.components;
  if (!Array.isArray(components)) throw new Error(`${where}: "components" must be a list`);
  return {
    kind,
    components: components.map((c, i) => parseComponent(c, `${where} ${kind} component ${i + 1}`)),
  };
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
  for (const type of ['drive', 'thrusters'] as const) {
    const count = designComponents(design).filter(
      ({ component }) => component.type === type,
    ).length;
    if (count !== 1) throw new Error(`${where}: needs exactly one ${type}, has ${count}`);
  }
  if (
    !designComponents(design).some((c) => c.component.type === 'drive' && c.section === 'engine')
  ) {
    throw new Error(`${where}: the drive must be in the engine section`);
  }
  return design;
};
