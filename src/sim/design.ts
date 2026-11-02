export const HULL_SIZES = ['frigate', 'cruiser', 'battleship'] as const;
export type HullSize = (typeof HULL_SIZES)[number];

/** A reusable blueprint for a ship. */
export interface Design {
  readonly id: string;
  readonly name: string;
  readonly hullSize: HullSize;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (data: Record<string, unknown>, key: string, where: string): string => {
  const value = data[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
};

/** Reads a design from untrusted data, such as a design file, throwing if it is invalid. */
export const parseDesign = (data: unknown): Design => {
  if (!isRecord(data)) throw new Error('Design: expected an object');
  const id = requireString(data, 'id', 'Design');
  const where = `Design "${id}"`;
  const name = requireString(data, 'name', where);
  const hullSize = requireString(data, 'hullSize', where);
  if (!(HULL_SIZES as readonly string[]).includes(hullSize)) {
    throw new Error(`${where}: unknown hull size "${hullSize}"`);
  }
  return { id, name, hullSize: hullSize as HullSize };
};
