import { PROTON_REST_ENERGY } from './beams';
import { componentSlots } from './components';
import {
  designComponentsOfType,
  type CoolantShieldDesign,
  type Design,
  type MagneticShieldDesign,
  type SectionKind,
} from './design';
import { thermalLimit, thermalProperties } from './heat';
import type { ShipState } from './ship';

/**
 * Shields: powered components inside a ship's sections, raised or lowered by the captain's
 * shields order, drawing power under the 'shields' priority while raised. A magnetic shield's
 * field wraps the whole ship and bends charged particle beams away; a coolant shield carries laser
 * heat from its own section's armour into the ship's heat. Neither does anything else, and
 * neither works without power.
 */

/** Laser power each section's coolant shields are already carrying this step, W. */
export type CoolantLoad = Readonly<Record<SectionKind, number>>;

export const NO_COOLANT_LOAD: CoolantLoad = { forward: 0, middle: 0, engine: 0 };

/** Each design's shield slots by type, as `componentSlots` numbers them. */
const shieldSlots = new WeakMap<Design, ReadonlyMap<string, readonly number[]>>();

const slotsOfShields = (design: Design, type: string): readonly number[] => {
  let byType = shieldSlots.get(design);
  if (!byType) {
    const slots = componentSlots(design);
    byType = new Map(
      (['magnetic-shield', 'coolant-shield'] as const).map((t) => [
        t,
        slots.flatMap((slot, i) => (slot.component.type === t ? [i] : [])),
      ]),
    );
    shieldSlots.set(design, byType);
  }
  return byType.get(type) ?? [];
};

/** Each working shield of a type with its integrity, and the section it is in. */
const working = <T extends MagneticShieldDesign | CoolantShieldDesign>(
  ship: ShipState,
  type: T['type'],
): { readonly shield: T; readonly section: SectionKind; readonly integrity: number }[] => {
  const slots = componentSlots(ship.design);
  return slotsOfShields(ship.design, type).flatMap((i) => {
    const slot = slots[i];
    const integrity = ship.integrity[i] ?? 0;
    return slot && integrity > 0
      ? [{ shield: slot.component as T, section: slot.section, integrity }]
      : [];
  });
};

/** What the shields draw at full power, each in proportion to its integrity, W. */
const fullShieldPower = (ship: ShipState): number =>
  [
    ...working<MagneticShieldDesign>(ship, 'magnetic-shield'),
    ...working<CoolantShieldDesign>(ship, 'coolant-shield'),
  ].reduce((total, { shield, integrity }) => total + shield.power * integrity, 0);

/**
 * Electrical power the shields ask for this step, W: their full power while raised, as far as the
 * ship's temperature allows, and none while lowered.
 */
export const shieldDemand = (ship: ShipState): number =>
  ship.shieldsRaised
    ? fullShieldPower(ship) * thermalLimit(ship.heat / thermalProperties(ship.design).heatCapacity)
    : 0;

/** The share of their full power the shields were given in this step (0–1). */
export const shieldsPowered = (ship: ShipState): number => {
  const full = fullShieldPower(ship);
  return full > 0 ? Math.min(1, ship.powerFlow.systems.shields.supplied / full) : 0;
};

/** A proton's momentum times c at a kinetic energy, from E² = (pc)² + (mc²)², J. */
const protonMomentum = (energy: number): number =>
  Math.sqrt(energy * energy + 2 * energy * PROTON_REST_ENERGY);

/** The kinetic energy of a proton whose momentum times c is `momentum`, J. */
const protonEnergy = (momentum: number): number =>
  Math.sqrt(momentum * momentum + PROTON_REST_ENERGY ** 2) - PROTON_REST_ENERGY;

/**
 * The momentum times c of the hardest protons the magnetic shields turn away entirely now, J.
 * The bending power of their fields adds up; each field goes with its coils' integrity and the
 * square root of the power they get, as a coil's current does.
 */
const deflectingMomentum = (ship: ShipState): number =>
  Math.sqrt(shieldsPowered(ship)) *
  working<MagneticShieldDesign>(ship, 'magnetic-shield').reduce(
    (total, { shield, integrity }) => total + integrity * protonMomentum(shield.maxParticleEnergy),
    0,
  );

/**
 * The kinetic energy of the hardest protons a design's magnetic shields turn away entirely at
 * full power, J; zero without one.
 */
export const designFullDeflection = (design: Design): number =>
  protonEnergy(
    designComponentsOfType(design, 'magnetic-shield').reduce(
      (total, shield) => total + protonMomentum(shield.maxParticleEnergy),
      0,
    ),
  );

/** The kinetic energy of the hardest protons the magnetic shields turn away entirely now, J. */
export const fullDeflection = (ship: ShipState): number => protonEnergy(deflectingMomentum(ship));

/**
 * The share (0–1) of a charged particle beam of protons of `particleEnergy` J that the magnetic
 * shields turn away from the ship. The field bends each proton through an angle in proportion to
 * its strength over the proton's momentum; protons bent far enough miss the ship, and of a harder
 * beam, bent through only part of that angle, only that part of it misses.
 */
export const deflectedShare = (ship: ShipState, particleEnergy: number): number =>
  Math.min(1, deflectingMomentum(ship) / protonMomentum(particleEnergy));

/**
 * The laser power a section's coolant shields can carry away now, W: their capacity by their
 * integrity, in proportion to the power their pumps get.
 */
export const coolantCapacity = (ship: ShipState, section: SectionKind): number =>
  shieldsPowered(ship) *
  working<CoolantShieldDesign>(ship, 'coolant-shield').reduce(
    (total, s) => (s.section === section ? total + s.shield.capacity * s.integrity : total),
    0,
  );

/**
 * A laser landing `power` W on a section with coolant shields: they carry as much of it as they
 * have capacity left for this step into the ship's heat, and the rest burns the armour. Returns
 * the power they carried, W.
 */
export const absorbLaser = (
  ship: ShipState,
  section: SectionKind,
  power: number,
  dt: number,
): number => {
  const spare = coolantCapacity(ship, section) - ship.coolantLoad[section];
  const absorbed = Math.min(power, Math.max(0, spare));
  if (!(absorbed > 0)) return 0;
  ship.coolantLoad = { ...ship.coolantLoad, [section]: ship.coolantLoad[section] + absorbed };
  ship.heat += absorbed * dt;
  ship.heatFlow = { ...ship.heatFlow, absorbed: ship.heatFlow.absorbed + absorbed };
  ship.ledger = { ...ship.ledger, heatAbsorbed: ship.ledger.heatAbsorbed + absorbed * dt };
  return absorbed;
};
