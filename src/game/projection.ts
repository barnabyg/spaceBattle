import type { OwnShipObservation } from '../sim/battle';
import type { DriveDesign } from '../sim/design';
import type { PlannedBurn } from '../sim/manoeuvre';
import { add, scale, type Vec3 } from '../sim/vector';

/** Integration step for projections, s. Coarser than the simulation; it is only for display. */
const PROJECTION_STEP = 5;

/** A planned burn and where the ship will be when it starts. */
export interface ProjectedBurn {
  readonly position: Vec3;
  readonly burn: PlannedBurn;
}

/**
 * The burns the ship expects to make: the manoeuvre's plan, or the rest of its current burn at
 * the throttle power and heat allow now.
 */
const burnsOf = (ship: OwnShipObservation): readonly PlannedBurn[] => {
  if (ship.manoeuvre) return ship.manoeuvre.plannedBurns;
  if (!ship.burn) return [];
  const throttle = Math.min(ship.burn.throttle, ship.power.driveLimit);
  return [{ start: 0, duration: ship.burn.remaining, direction: ship.nose, throttle }];
};

/**
 * Steps the ship forward through its planned burns, calling `visit` with the time and position
 * at the start of the run and after every step.
 */
const integrate = (
  ship: OwnShipObservation,
  drive: DriveDesign,
  horizon: number,
  visit: (time: number, position: Vec3) => void,
): void => {
  const burns = burnsOf(ship);
  let position = ship.position;
  let velocity = ship.velocity;
  let mass = ship.mass;
  let propellant = ship.propellantMass;
  visit(0, position);
  for (let t = 0; t < horizon; t += PROJECTION_STEP) {
    const before = velocity;
    for (const burn of burns) {
      const burnTime =
        Math.min(t + PROJECTION_STEP, burn.start + burn.duration) - Math.max(t, burn.start);
      const force = burn.throttle * drive.thrust;
      if (burnTime <= 0 || propellant <= 0 || force <= 0) continue;
      // Rocket equation: Δv = vₑ ln(m₀ / m₁).
      const used = Math.min((force / drive.exhaustVelocity) * burnTime, propellant);
      velocity = add(
        velocity,
        scale(burn.direction, drive.exhaustVelocity * Math.log(mass / (mass - used))),
      );
      mass -= used;
      propellant -= used;
    }
    // Average the velocity over the step so the burn's displacement comes out right.
    position = add(position, scale(add(before, velocity), PROJECTION_STEP / 2));
    visit(t + PROJECTION_STEP, position);
  }
};

/**
 * Where the ship will be over the next `horizon` seconds if it makes its planned burns (or
 * holds its heading and finishes its current burn), sampled every `interval` seconds,
 * starting at its current position.
 */
export const projectPath = (
  ship: OwnShipObservation,
  drive: DriveDesign,
  horizon: number,
  interval: number,
): Vec3[] => {
  const path: Vec3[] = [];
  let lastSample = -Infinity;
  integrate(ship, drive, horizon, (time, position) => {
    if (time - lastSample < interval - 1e-9) return;
    path.push(position);
    lastSample = time;
  });
  return path;
};

/** Where the ship will be when each manoeuvre burn planned within `horizon` seconds starts. */
export const projectBurns = (
  ship: OwnShipObservation,
  drive: DriveDesign,
  horizon: number,
): ProjectedBurn[] => {
  const pending = (ship.manoeuvre?.plannedBurns ?? []).filter((b) => b.start < horizon);
  const projected: ProjectedBurn[] = [];
  integrate(ship, drive, horizon, (time, position) => {
    while (pending[0] && pending[0].start < time + PROJECTION_STEP) {
      projected.push({ position, burn: pending[0] });
      pending.shift();
    }
  });
  return projected;
};
