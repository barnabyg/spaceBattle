import { componentSlots } from './components';
import { intactShape } from './damage';
import type { SensorDesign } from './design';
import type { ShapePart } from './shape';
import type { ShipState } from './ship';

/** How much of a contact a side's sensors make out, coarsest first. */
export type ContactDetail = 'position' | 'silhouette' | 'sections' | 'mounts';
export const CONTACT_DETAILS: readonly ContactDetail[] = [
  'position',
  'silhouette',
  'sections',
  'mounts',
];

/**
 * A feature is made out once the sensors resolve this many details across it: one detail as wide
 * as the feature shows only that something is there.
 */
export const RESOLVING_ELEMENTS = 2;
/**
 * How precisely a ship without a working sensor tracks a contact, rad: by its navigation cameras
 * alone, good enough to know where the contact is but hopeless for fire control at range.
 */
export const BLIND_TRACKING_ERROR = 1e-5;

/** The finest detail a sensor makes out at a range, m: the diffraction limit, 1.22·λ·r/D. */
export const sensorResolution = (sensor: SensorDesign, range: number): number =>
  (1.22 * sensor.wavelength * range) / sensor.aperture;

/** What a ship's sensors can do now. */
export interface SensorPower {
  /**
   * The finest angle its working sensors resolve, rad: the best sensor's 1.22·λ/D, coarser as its
   * integrity falls. Infinite without a working sensor.
   */
  readonly angularResolution: number;
  /** The angle it tracks a contact's position to, rad (see `SensorDesign.trackingError`). */
  readonly trackingError: number;
}

/**
 * The ship's best working sensors: a damaged sensor works in proportion to its integrity, so it
 * resolves and tracks as if its mirror were that much smaller. Without a working sensor the ship
 * makes out nothing but where the contact is, and tracks it to `BLIND_TRACKING_ERROR`.
 */
export const sensorPower = (ship: ShipState): SensorPower => {
  let angularResolution = Infinity;
  let trackingError = BLIND_TRACKING_ERROR;
  componentSlots(ship.design).forEach((slot, i) => {
    const integrity = ship.integrity[i] ?? 0;
    if (slot.component.type !== 'sensor' || integrity <= 0) return;
    angularResolution = Math.min(
      angularResolution,
      sensorResolution(slot.component, 1) / integrity,
    );
    trackingError = Math.min(trackingError, slot.component.trackingError / integrity);
  });
  return { angularResolution, trackingError };
};

/** The largest extent of a box, m. */
const extent = (min: ShapePart['min'], max: ShapePart['max']): number =>
  Math.max(max.x - min.x, max.y - min.y, max.z - min.z);

/** What one side's sensors make out of a ship at a range. */
export interface Perception {
  /** The finest detail made out at the contact, m; infinite without a working sensor. */
  readonly resolution: number;
  readonly detail: ContactDetail;
  /**
   * The ship's outline once its whole silhouette is made out, none before: its intact sections,
   * and any intact mount large enough to make out, such as a deployed radiator.
   */
  readonly outline: readonly ShapePart[];
  /** The intact sections and mounts made out, each of them aimable; a mount only with its section. */
  readonly parts: readonly ShapePart[];
}

/**
 * What a ship with `sensors` makes out of `target` at `range`. Its position and motion are always
 * known. A feature is made out once the sensors resolve `RESOLVING_ELEMENTS` details across its
 * largest extent: first the ship's silhouette, then each section, then each mount on a section
 * made out. Larger sections and mounts, such as deployed radiators, show up first.
 */
export const perceive = (sensors: SensorPower, target: ShipState, range: number): Perception => {
  const resolution = sensors.angularResolution * range;
  const smallest = RESOLVING_ELEMENTS * resolution;
  const intact = intactShape(target);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const part of intact) {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], part.min[axis]);
      max[axis] = Math.max(max[axis], part.max[axis]);
    }
  }
  if (intact.length === 0 || extent(min, max) < smallest) {
    return { resolution, detail: 'position', outline: [], parts: [] };
  }
  const sections = intact.filter(
    (part) => part.mount === null && extent(part.min, part.max) >= smallest,
  );
  const mounts = intact.filter(
    (part) =>
      part.mount !== null &&
      sections.some((section) => section.section === part.section) &&
      extent(part.min, part.max) >= smallest,
  );
  return {
    resolution,
    detail: mounts.length > 0 ? 'mounts' : sections.length > 0 ? 'sections' : 'silhouette',
    outline: intact.filter((part) => part.mount === null || extent(part.min, part.max) >= smallest),
    parts: [...sections, ...mounts],
  };
};
