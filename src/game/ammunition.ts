import type { OwnShipObservation } from '../sim/battle';
import type { MissileRole } from '../sim/design';

/** Ammunition of a kind counts as low once this share of a full load or less is left. */
export const LOW_AMMUNITION = 0.25;

/** How much of one kind of ammunition a ship has left. */
export interface AmmunitionStock {
  /** What it is, as a heading, e.g. "Slugs". */
  readonly name: string;
  /** What it is in a count, e.g. "slugs" in "412 of 600 slugs". */
  readonly noun: string;
  readonly left: number;
  /** A full load, as the magazines hold when the battle begins with them full. */
  readonly capacity: number;
  readonly level: 'ok' | 'low' | 'empty';
}

const stock = (name: string, noun: string, left: number, capacity: number): AmmunitionStock => ({
  name,
  noun,
  left,
  capacity,
  level: left <= 0 ? 'empty' : left <= LOW_AMMUNITION * capacity ? 'low' : 'ok',
});

/** Missiles of a role left, and a full load of them. */
const missiles = (ship: OwnShipObservation, role: MissileRole) => {
  const designs = ship.weapons.ammunition.missileDesigns.filter((d) => d.role === role);
  return {
    left: designs.reduce((n, d) => n + d.missiles, 0),
    capacity: designs.reduce((n, d) => n + d.capacity, 0),
  };
};

/** Each kind of ammunition the ship's magazines are built to hold, and how much is left. */
export const ammunitionStocks = (ship: OwnShipObservation): AmmunitionStock[] => {
  const { slugs, slugCapacity, rounds, roundCapacity } = ship.weapons.ammunition;
  const antiShip = missiles(ship, 'anti-ship');
  const antiMissile = missiles(ship, 'anti-missile');
  return [
    ...(slugCapacity > 0 ? [stock('Slugs', 'slugs', slugs, slugCapacity)] : []),
    ...(roundCapacity > 0 ? [stock('Point defence rounds', 'rounds', rounds, roundCapacity)] : []),
    ...(antiShip.capacity > 0
      ? [stock('Missiles', 'missiles', antiShip.left, antiShip.capacity)]
      : []),
    ...(antiMissile.capacity > 0
      ? [
          stock(
            'Anti-missile missiles',
            'anti-missile missiles',
            antiMissile.left,
            antiMissile.capacity,
          ),
        ]
      : []),
  ];
};
