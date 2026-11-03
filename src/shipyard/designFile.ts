import { parseDesign, type Design } from '../sim/design';
import { buildDesign, specificationOf } from './shipyard';

/** What a design file says it is. */
export const DESIGN_FILE_FORMAT = 'space-battle-design';
/**
 * The version design files are written in. Version 1 was a bare design, as the hand-made design
 * data files are; version 2 wraps it with the format and version.
 */
export const DESIGN_FILE_VERSION = 2;

/** A design as the text of a design file, in the current version. */
export const exportDesign = (design: Design): string =>
  `${JSON.stringify({ format: DESIGN_FILE_FORMAT, version: DESIGN_FILE_VERSION, design }, null, 2)}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The design data in a file of any version, before it is checked. */
const designData = (text: string): unknown => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a design file.');
  }
  if (!isRecord(data)) throw new Error('This is not a design file.');
  // Version 1: a bare design.
  if (data.format === undefined && 'sections' in data) return data;
  if (data.format !== DESIGN_FILE_FORMAT) throw new Error('This is not a design file.');
  const { version } = data;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 2) {
    throw new Error('This design file has no version this game can read.');
  }
  if (version > DESIGN_FILE_VERSION) {
    throw new Error('This design file comes from a newer version of the game.');
  }
  return data.design;
};

/**
 * Reads a design file of any version, as the shipyard would build it: named "<name> class", its
 * components where the file puts them. Throws, with a message for the player, a file that is
 * not a valid design or would not pass the shipyard's checks.
 */
export const importDesign = (text: string): Design => {
  const design = parseDesign(designData(text));
  const built = buildDesign(specificationOf(design));
  if (built.errors.length > 0) {
    throw new Error(`The design is not valid: ${built.errors.join(' ')}`);
  }
  return built.design;
};
