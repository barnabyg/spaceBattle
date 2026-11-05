import type { OwnShipObservation } from '../sim/battle';
import type { ComponentType } from '../sim/design';

/** Fitted parts remain present in observations even after destruction. */
export const hasEquipment = (ship: OwnShipObservation, ...types: readonly ComponentType[]) =>
  ship.sections.some((section) =>
    [...section.components, ...section.mounts].some((part) => types.includes(part.type)),
  );

export const hasPoweredWeapons = (ship: OwnShipObservation) =>
  hasEquipment(ship, 'laser', 'charged-particle-beam', 'neutral-particle-beam', 'kinetic-gun');
