import type { ContactObservation, SideObservation } from '../sim/battle';
import { dot, length, sub, type Vec3 } from '../sim/vector';

interface Moving {
  /** m */
  readonly position: Vec3;
  /** m/s */
  readonly velocity: Vec3;
}

/** How another ship moves as seen from the own ship. */
export interface RelativeMotion {
  /** Full three-dimensional distance between the observed positions, m. */
  readonly separation: number;
  /** The other ship's velocity minus the own ship's, m/s. */
  readonly relativeVelocity: Vec3;
  /** The size of the relative velocity, m/s. */
  readonly relativeSpeed: number;
  /**
   * How fast the separation falls, m/s: positive while the ships close, negative while they draw
   * apart, and zero when they share a position.
   */
  readonly closingSpeed: number;
}

/** How `other` moves relative to `own`. */
export const relativeMotion = (own: Moving, other: Moving): RelativeMotion => {
  const relativeVelocity = sub(other.velocity, own.velocity);
  const offset = sub(other.position, own.position);
  const separation = length(offset);
  // Adding zero turns −0 into 0, so a still contact does not read as closing at "−0".
  const closingSpeed = (separation > 0 ? -dot(offset, relativeVelocity) / separation : 0) + 0;
  return { separation, relativeVelocity, relativeSpeed: length(relativeVelocity), closingSpeed };
};

/** The contact the captain follows: the weapons target, or else the first contact. */
export const followedContact = ({
  ownShip,
  contacts,
}: SideObservation): ContactObservation | undefined =>
  contacts.find((c) => c.sideId === ownShip.weapons.target) ?? contacts[0];
