import type { ArmourType, ComponentType } from '../sim/design';

/**
 * The game's balance numbers in one place: what things cost. Prices are in credits; a modest
 * frigate costs about 8 million.
 */
export const BALANCE = {
  /** Price of each type of component, per kg of it; a magazine's ammunition is extra. */
  componentPrice: {
    drive: 30,
    thrusters: 15,
    reactor: 40,
    capacitor: 20,
    magazine: 10,
    'magnetic-shield': 35,
    'coolant-shield': 30,
    radiator: 10,
    laser: 40,
    'charged-particle-beam': 45,
    'neutral-particle-beam': 45,
    'kinetic-gun': 25,
    'point-defence': 30,
    launcher: 20,
    sensor: 60,
  } satisfies Readonly<Record<ComponentType, number>>,
  /** Price of a hull's bare structure, per kg. */
  structurePrice: 2,
  /** Price of armour, per kg. */
  armourPrice: { heavy: 3, ablative: 6 } satisfies Readonly<Record<ArmourType, number>>,
  /** Price of propellant, per kg. */
  propellantPrice: 0.2,
  /** Price of a kinetic gun's slug. */
  slugPrice: 50,
  /** Price of a point defence round. */
  roundPrice: 0.5,
  /** Price of a missile, per kg of its launch mass. */
  missilePrice: 10,
} as const;
