import { componentSlots } from '../sim/components';
import { designComponentsOfType, parseDesign, type Design } from '../sim/design';
import { IDENTITY } from '../sim/quaternion';
import { createShip, fullCondition, type ShipCondition } from '../sim/ship';
import { ZERO } from '../sim/vector';
import type { Campaign, CampaignShip } from './campaign';

/** What a campaign file says it is. */
export const CAMPAIGN_FILE_FORMAT = 'space-battle-campaign';
/**
 * The version campaign files are written in. Version 1 held each ship without its condition, as
 * campaigns were before repairs; its ships load as built. Version 2 adds each ship's condition.
 */
export const CAMPAIGN_FILE_VERSION = 2;

/** A campaign as the text of a campaign file, in the current version. */
export const saveCampaign = (campaign: Campaign): string =>
  `${JSON.stringify(
    { format: CAMPAIGN_FILE_FORMAT, version: CAMPAIGN_FILE_VERSION, campaign },
    null,
    2,
  )}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Thrown for anything wrong inside a file that says it is a campaign. */
const damaged = (): Error => new Error('This campaign file is damaged and cannot be loaded.');

const count = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw damaged();
  return value;
};

const text = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') throw damaged();
  return value;
};

const design = (value: unknown): Design => {
  try {
    return parseDesign(value);
  } catch {
    throw damaged();
  }
};

/**
 * A condition saved for a design with its drive whole, before drive units, as it is for the
 * design in units: each unit as damaged as the whole drive was. Any other condition is unchanged.
 */
const inDriveUnits = (
  saved: unknown,
  built: Design,
  condition: ShipCondition | undefined,
): ShipCondition | undefined => {
  const units = designComponentsOfType(built, 'drive').length;
  const savedDrives =
    isRecord(saved) && Array.isArray(saved.sections)
      ? saved.sections
          .flatMap((s: unknown) =>
            isRecord(s) && Array.isArray(s.components) ? (s.components as unknown[]) : [],
          )
          .filter((c) => isRecord(c) && c.type === 'drive').length
      : units;
  // Read from a file, the integrity is unchecked until the ship is built from it.
  const integrity: unknown = condition?.integrity;
  if (!condition || !Array.isArray(integrity) || savedDrives !== 1 || units === 1) {
    return condition;
  }
  const values = integrity as readonly unknown[];
  const first = componentSlots(built).findIndex((slot) => slot.component.type === 'drive');
  const drive = values[first];
  if (typeof drive !== 'number') return condition;
  return {
    ...condition,
    integrity: [
      ...values.slice(0, first),
      ...Array.from({ length: units }, () => drive),
      ...values.slice(first + 1),
    ] as number[],
  };
};

/** A ship as a file holds it; a version 1 ship has no condition and comes as built. */
const ship = (value: unknown, version: number): CampaignShip => {
  if (!isRecord(value)) throw damaged();
  const built = design(value.design);
  const condition =
    version === 1
      ? fullCondition(built)
      : inDriveUnits(value.design, built, value.condition as ShipCondition | undefined);
  try {
    // A ship of the design in this condition must be one a battle would take.
    if (!condition) throw damaged();
    createShip(built, ZERO, ZERO, IDENTITY, condition);
  } catch {
    throw damaged();
  }
  return { id: text(value.id), name: text(value.name), design: built, condition };
};

/**
 * Reads a campaign file of any version. Throws, with a message for the player, a file that is not
 * a campaign, comes from a newer version of the game, or is damaged.
 */
export const loadCampaign = (fileText: string): Campaign => {
  let data: unknown;
  try {
    data = JSON.parse(fileText);
  } catch {
    throw new Error('This is not a campaign file.');
  }
  if (!isRecord(data) || data.format !== CAMPAIGN_FILE_FORMAT) {
    throw new Error('This is not a campaign file.');
  }
  const { version } = data;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw damaged();
  if (version > CAMPAIGN_FILE_VERSION) {
    throw new Error('This campaign file comes from a newer version of the game.');
  }
  const campaign = data.campaign;
  if (!isRecord(campaign)) throw damaged();
  const { credits, hangar, designs } = campaign;
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) throw damaged();
  if (!Array.isArray(hangar) || !Array.isArray(designs)) throw damaged();
  return {
    credits,
    hangar: hangar.map((s: unknown) => ship(s, version)),
    designs: designs.map(design),
    seed: count(campaign.seed),
    battles: count(campaign.battles),
    shipsBuilt: count(campaign.shipsBuilt),
  };
};
