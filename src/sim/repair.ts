import { componentSlots } from './components';
import type { Design } from './design';
import type { ComponentAddress } from './orders';
import type { ShipState } from './ship';

/** Integrity the crew restores to the component they repair each second (0–1). */
export const REPAIR_RATE = 0.002;
/** A field repair brings a component back no further than this integrity (0–1). */
export const REPAIR_CAP = 0.75;
/** Work stops while the component's section has been hit within this long, s. */
export const REPAIR_PAUSE = 30;

/** The component slot at an address in a design, or −1 if there is none there. */
export const slotAt = (design: Design, address: ComponentAddress): number =>
  componentSlots(design).findIndex(
    (s) =>
      s.section === address.section && s.mounted === address.mounted && s.index === address.index,
  );

/** Why the crew cannot repair the component at `address`, or null if they can. */
export const repairRefused = (ship: ShipState, address: ComponentAddress): string | null => {
  const slot = slotAt(ship.design, address);
  if (slot < 0) return 'There is no such component';
  const integrity = ship.integrity[slot] ?? 0;
  if (integrity <= 0) return 'A wrecked component cannot be repaired in battle';
  if (integrity >= REPAIR_CAP) return 'It is already as sound as a field repair can make it';
  return null;
};

/** How the repair under way stands: working, or paused while the section is under fire. */
export const repairState = (ship: ShipState, time: number): 'working' | 'paused' | null => {
  const slot = ship.repairing;
  if (slot === null) return null;
  const section = componentSlots(ship.design)[slot]?.section;
  if (!section) return null;
  return time - ship.sections[section].lastHit < REPAIR_PAUSE ? 'paused' : 'working';
};

/**
 * The crew's work over `dt` s at battle time `time`: the component under repair gains
 * `REPAIR_RATE` integrity a second up to `REPAIR_CAP`, unless its section was hit within
 * `REPAIR_PAUSE`. They stop once it reaches the cap, or if it is wrecked meanwhile.
 */
export const repairStep = (ship: ShipState, time: number, dt: number): void => {
  const slot = ship.repairing;
  if (slot === null) return;
  const integrity = ship.integrity[slot] ?? 0;
  if (integrity <= 0 || integrity >= REPAIR_CAP) {
    ship.repairing = null;
    return;
  }
  if (repairState(ship, time) !== 'working') return;
  const repaired = Math.min(REPAIR_CAP, integrity + REPAIR_RATE * dt);
  ship.integrity = ship.integrity.map((value, i) => (i === slot ? repaired : value));
  if (repaired >= REPAIR_CAP) ship.repairing = null;
};
