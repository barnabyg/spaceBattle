import type { OwnShipObservation } from '../sim/battle';
import type { DriveDesign } from '../sim/design';
import { add, scale, type Vec3 } from '../sim/vector';

/** Integration step for projections, s. Coarser than the simulation; it is only for display. */
const PROJECTION_STEP = 5;

/**
 * Where the ship will be over the next `horizon` seconds if it holds its heading and finishes
 * its current burn, sampled every `interval` seconds, starting at its current position.
 */
export const projectPath = (
  ship: OwnShipObservation,
  drive: DriveDesign,
  horizon: number,
  interval: number,
): Vec3[] => {
  let position = ship.position;
  let velocity = ship.velocity;
  let mass = ship.mass;
  let propellant = ship.propellantMass;
  let burnLeft = ship.burn?.remaining ?? 0;
  const force = (ship.burn?.throttle ?? 0) * drive.thrust;
  const path = [position];
  let sinceSample = 0;
  for (let t = 0; t < horizon; t += PROJECTION_STEP) {
    const burnTime = Math.min(PROJECTION_STEP, burnLeft);
    const before = velocity;
    if (burnTime > 0 && propellant > 0 && force > 0) {
      const used = Math.min((force / drive.exhaustVelocity) * burnTime, propellant);
      velocity = add(
        velocity,
        scale(ship.nose, drive.exhaustVelocity * Math.log(mass / (mass - used))),
      );
      mass -= used;
      propellant -= used;
    }
    burnLeft -= burnTime;
    // Average the velocity over the step so the burn's displacement comes out right.
    position = add(position, scale(add(before, velocity), PROJECTION_STEP / 2));
    sinceSample += PROJECTION_STEP;
    if (sinceSample >= interval) {
      path.push(position);
      sinceSample = 0;
    }
  }
  return path;
};
