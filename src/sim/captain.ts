import type { OwnShipObservation, SideId, SideObservation, SideSetup } from './battle';
import { BASE_TEMPERATURE, OVERHEAT_TEMPERATURE } from './heat';
import type {
  LaunchOrder,
  ManoeuvreOrder,
  Order,
  PowerOrder,
  RadiatorsOrder,
  WeaponsOrder,
} from './orders';
import type { PowerSystem } from './power';
import { distance } from './vector';
import { designReach } from './weapons';

/**
 * A side's commander as the battle sees it: it decides on orders from what its side observes,
 * and may remember what it saw before. It never touches the ship itself.
 */
export interface Captain {
  readonly side: SideId;
  /** The orders to give now; none when the standing orders already do what it wants. */
  decide(observation: SideObservation): readonly Order[];
}

/** A ship that outranges its enemy holds at this fraction of its own reach. */
const STANDOFF_FRACTION = 0.95;
/** A ship that cannot outrange its enemy closes to this fraction of its own reach. */
const CLOSE_FRACTION = 0.5;
/** A ship with no working weapons opens the range to this multiple of the enemy's reach. */
const DISENGAGE_FRACTION = 1.1;
/** Within this multiple of the longer reach a ship is fighting, not just manoeuvring. */
const FIGHTING_FRACTION = 1.05;
/** Radiators deploy above this temperature, K... */
const DEPLOY_TEMPERATURE = BASE_TEMPERATURE + 0.5 * (OVERHEAT_TEMPERATURE - BASE_TEMPERATURE);
/** ...and once out, stay out until the ship cools below this, K. */
const RETRACT_TEMPERATURE = BASE_TEMPERATURE + 0.2 * (OVERHEAT_TEMPERATURE - BASE_TEMPERATURE);
/** With no fire either way and the range not shrinking for this long, the captain closes in, s. */
const PATIENCE = 1_800;
/** The range must shrink by this fraction to count as getting somewhere. */
const PROGRESS_FRACTION = 0.01;
/** Ordered ranges within this fraction of each other count as the same order. */
const RANGE_TOLERANCE = 0.01;

/** Shields draw nothing yet, so their place in the ranking matters little. */
const COMBAT_PRIORITIES: readonly PowerSystem[] = ['weapons', 'shields', 'drive', 'capacitors'];
const MANOEUVRE_PRIORITIES: readonly PowerSystem[] = ['drive', 'shields', 'weapons', 'capacitors'];

/** How far the ship's missiles reach while it has a working launcher and missiles left, m. */
const missileReach = ({ weapons }: OwnShipObservation): number =>
  weapons.ammunition.missiles > 0 && weapons.launchers.some((l) => l.integrity > 0)
    ? Math.max(0, ...weapons.ammunition.missileDesigns.map((missile) => missile.reach))
    : 0;

/**
 * The furthest the ship's working weapons fire, m: its lasers and particle beams, its kinetic
 * guns while it has slugs left, and its missiles while it has missiles and a launcher. Zero once
 * none is left.
 */
const ownReach = (ship: OwnShipObservation): number => {
  const { weapons } = ship;
  return Math.max(
    missileReach(ship),
    ...[
      ...weapons.lasers,
      ...weapons.particleBeams,
      ...(weapons.ammunition.slugs > 0 ? weapons.kineticGuns : []),
    ]
      .filter((weapon) => weapon.integrity > 0)
      .map((weapon) => weapon.effectiveRange),
  );
};

/** Whether an order is already standing, so giving it again would change nothing. */
const inForce = (ship: OwnShipObservation, order: Order): boolean => {
  switch (order.type) {
    case 'weapons':
      return ship.weapons.target === order.target && ship.weapons.mode === order.mode;
    case 'radiators':
      return ship.heat.radiatorsDeployed === order.deployed;
    case 'launch':
      return (
        ship.weapons.salvo?.target === order.target &&
        ship.weapons.salvo.remaining === order.missiles
      );
    case 'power':
      return order.priorities.every((system, i) => ship.power.priorities[i] === system);
    case 'manoeuvre': {
      const standing = ship.manoeuvre;
      if (order.goal === 'none') return standing === null;
      if (standing?.goal !== order.goal) return false;
      if (order.goal === 'match-velocity' || standing.range === null) return true;
      return Math.abs(standing.range - order.range) <= RANGE_TOLERANCE * order.range;
    }
    default:
      return false;
  }
};

/**
 * A basic computer captain for one side. It knows the designs in the battle, so it knows how far
 * the enemy's weapons reach (contacts show every detail until sensors arrive), and otherwise
 * decides only from its side's observations.
 *
 * It targets the enemy and fires freely throughout, and launches a salvo of missiles, one from
 * each working launcher, whenever the enemy is within their reach and none of its missiles is
 * still in flight. If it outranges the enemy it holds just
 * inside its own reach, out of the enemy's; otherwise it closes to where its beams bite hard.
 * If neither side fires and the range stops shrinking for a while, it gives up on standing off
 * and closes in for good. It ranks weapons first in a fight and the drive first otherwise, and
 * deploys its radiators to fight or to cool down, retracting them when cool and out of reach.
 */
export const createComputerCaptain = (side: SideId, sides: readonly SideSetup[]): Captain => {
  const enemies = sides.filter((s) => s.id !== side);
  const enemyReach = Math.max(0, ...enemies.map((enemy) => designReach(enemy.design)));
  /** When the battle last got somewhere, s, and the range to measure progress from, m. */
  let progress: { time: number; range: number } | null = null;
  let pressing = false;

  /** Notes fire either way or a shrinking range; a long spell of neither sends it in. */
  const notice = (observation: SideObservation, range: number) => {
    const { ownShip, time } = observation;
    const { weapons, appearance } = ownShip;
    const engaged =
      [...weapons.lasers, ...weapons.particleBeams, ...weapons.kineticGuns].some(
        (weapon) => weapon.firing,
      ) ||
      weapons.salvo !== null ||
      observation.munitions.length > 0 ||
      appearance.beamsLanding.length > 0 ||
      appearance.impacts.length > 0;
    if (!progress || engaged || range < progress.range * (1 - PROGRESS_FRACTION)) {
      progress = { time, range };
    } else {
      // Drifting apart is no progress, but closing back in from there is.
      progress = { time: progress.time, range: Math.max(progress.range, range) };
      if (time - progress.time > PATIENCE) pressing = true;
    }
  };

  /** Where to manoeuvre; nowhere when neither side has a weapon to fight with. */
  const manoeuvre = (reach: number): ManoeuvreOrder | null => {
    if (reach === 0) {
      return enemyReach > 0
        ? { type: 'manoeuvre', goal: 'open', range: DISENGAGE_FRACTION * enemyReach }
        : null;
    }
    const standoff = STANDOFF_FRACTION * reach;
    return !pressing && standoff > enemyReach
      ? { type: 'manoeuvre', goal: 'hold', range: standoff }
      : { type: 'manoeuvre', goal: 'close', range: CLOSE_FRACTION * reach };
  };

  return {
    side,
    decide(observation) {
      const enemy = observation.contacts[0];
      if (observation.outcome || !enemy) return [];
      const ship = observation.ownShip;
      const range = distance(ship.position, enemy.position);
      notice(observation, range);
      const reach = ownReach(ship);
      const fighting = range <= FIGHTING_FRACTION * Math.max(reach, enemyReach);
      const hot =
        ship.heat.temperature >
        (ship.heat.radiatorsDeployed ? RETRACT_TEMPERATURE : DEPLOY_TEMPERATURE);
      const weapons: WeaponsOrder = { type: 'weapons', target: enemy.sideId, mode: 'fire-freely' };
      const radiators: RadiatorsOrder = { type: 'radiators', deployed: fighting || hot };
      const power: PowerOrder = {
        type: 'power',
        priorities: fighting ? COMBAT_PRIORITIES : MANOEUVRE_PRIORITIES,
      };
      const course = manoeuvre(reach);
      const orders: Order[] = [weapons, ...(course ? [course] : []), radiators, power];
      const inFlight = observation.munitions.some(
        (m) => m.kind === 'missile' && m.attacker === side,
      );
      if (range <= missileReach(ship) && !inFlight && ship.weapons.salvo === null) {
        const launchers = ship.weapons.launchers.filter((l) => l.integrity > 0).length;
        const salvo: LaunchOrder = { type: 'launch', target: enemy.sideId, missiles: launchers };
        orders.push(salvo);
      }
      return orders.filter((order) => !inForce(ship, order));
    },
  };
};
