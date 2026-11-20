import type { BattleEvent, SideObservation } from '../sim/battle';
import { effectiveRange } from '../sim/beams';
import { kineticGunRange } from '../sim/kinetic';
import { targetsMissile } from '../sim/missile';
import { distance } from '../sim/vector';
import { closestPass, type ClosestPass } from './relativeMotion';

/** What an advance runs the battle until: the captain's next decision point. */
export type AdvanceCondition =
  /** The contact comes within reach of one of the side's own working weapons. */
  | { readonly type: 'own-reach' }
  /** The side's ship comes within reach of an enemy weapon its sensors have made out. */
  | { readonly type: 'enemy-reach' }
  /** The separation to the contact reaches a distance, closing or opening, m. */
  | { readonly type: 'separation'; readonly distance: number }
  /** Either side launches a missile at a ship. */
  | { readonly type: 'launch' }
  /** The ships pass closest and start drawing apart. */
  | { readonly type: 'closest-pass' }
  /** This much battle time has passed, s. */
  | { readonly type: 'duration'; readonly seconds: number };

/** The battle time an advance runs for when told to wait, s: ten minutes. */
export const ADVANCE_DURATION = 600;

/** How far the side is from its contact, m; null with no contact. */
export const separationOf = (observation: SideObservation): number | null => {
  const contact = observation.contacts[0];
  return contact ? distance(observation.ownShip.position, contact.position) : null;
};

/**
 * How far the side's own working weapons reach, m: the effective range fire control uses for each
 * weapon that is not lost, leaving out those kept for missiles. Zero without any.
 */
export const ownReach = (observation: SideObservation): number =>
  Math.max(
    0,
    ...observation.ownShip.weapons.readiness.flatMap((weapon) =>
      weapon.status === 'lost' || weapon.rangeKind === 'defensive' || weapon.range === null
        ? []
        : [weapon.range],
    ),
  );

/**
 * How far the enemy weapons the side's sensors make out on its contact reach, m: beam weapons to
 * their effective range and kinetic guns to fire control's. Zero while none is made out; missiles
 * are left out, as their reach does not show on the launcher.
 */
export const knownEnemyReach = (observation: SideObservation): number => {
  const contact = observation.contacts[0];
  if (!contact) return 0;
  return Math.max(
    0,
    ...contact.mounts.map(({ component }) => {
      switch (component.type) {
        case 'laser':
        case 'charged-particle-beam':
        case 'neutral-particle-beam':
          return effectiveRange(component);
        case 'kinetic-gun':
          return kineticGunRange(component);
        default:
          return 0;
      }
    }),
  );
};

/** Where the side's ship and its contact pass closest if neither burns; null unless closing. */
export const passAhead = (observation: SideObservation): ClosestPass | null => {
  const contact = observation.contacts[0];
  return contact ? closestPass(observation.ownShip, contact) : null;
};

/**
 * The pass ahead, if the ships come within reach of a weapon either side is known to have: the
 * side's own working weapons, or the enemy's its sensors make out. Null otherwise.
 */
export const passInReach = (observation: SideObservation): ClosestPass | null => {
  const pass = passAhead(observation);
  return pass && pass.separation <= Math.max(ownReach(observation), knownEnemyReach(observation))
    ? pass
    : null;
};

/**
 * The test for one advance, fixed when it starts: whether its condition holds given the side's
 * observation after a step and that step's events. A separation goal is met closing from above
 * or opening from below, whichever way the battle stood at the start.
 */
export type AdvanceTest = (observation: SideObservation, events: readonly BattleEvent[]) => boolean;

/**
 * The test for an advance from `observation`, or why it cannot start: its condition already
 * holds, or there is nothing to measure it by.
 */
export const advanceTest = (
  condition: AdvanceCondition,
  observation: SideObservation,
): AdvanceTest | string => {
  const separation = separationOf(observation);
  switch (condition.type) {
    case 'own-reach': {
      if (separation === null) return 'No contact';
      const reach = ownReach(observation);
      if (reach === 0) return 'No weapon with a reach';
      if (separation <= reach) return 'Already within reach of our weapons';
      return (next) => {
        const range = separationOf(next);
        return range !== null && range <= ownReach(next);
      };
    }
    case 'enemy-reach': {
      if (separation === null) return 'No contact';
      if (separation <= knownEnemyReach(observation)) return 'Already within known enemy reach';
      return (next) => {
        const range = separationOf(next);
        return range !== null && range <= knownEnemyReach(next);
      };
    }
    case 'separation': {
      const goal = condition.distance;
      if (!(goal > 0) || !Number.isFinite(goal)) return 'Enter a separation above 0 km';
      if (separation === null) return 'No contact';
      if (separation === goal) return 'Already at that separation';
      const closing = separation > goal;
      return (next) => {
        const range = separationOf(next);
        return range !== null && (closing ? range <= goal : range >= goal);
      };
    }
    case 'closest-pass':
      if (separation === null) return 'No contact';
      if (!passAhead(observation)) return 'The ships are not closing';
      return (next) => passAhead(next) === null;
    case 'launch':
      return (_, events) =>
        events.some((event) => event.type === 'launch' && !targetsMissile(event.target));
    case 'duration': {
      const until = observation.time + condition.seconds;
      return (next) => next.time >= until - 1e-9;
    }
  }
};
