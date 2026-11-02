import type { Design } from './design';
import { add, scale, type Vec3 } from './vector';

/** The fixed simulation time step, in seconds. */
export const TIME_STEP = 0.1;

export type SideId = string;
export type Commander = 'player' | 'computer';

export interface SideSetup {
  readonly id: SideId;
  readonly name: string;
  readonly commander: Commander;
  readonly design: Design;
}

/** Where each side's ship starts, in the same order as the battle's sides. */
export interface ShipStart {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface Scenario {
  readonly name: string;
  readonly starts: readonly ShipStart[];
}

export interface BattleSetup {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly sides: readonly SideSetup[];
}

/** A side's own ship, which it knows in full. */
export interface OwnShipObservation {
  readonly sideId: SideId;
  readonly designName: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** An enemy ship as a side perceives it; its position and motion are always known. */
export interface ContactObservation {
  readonly sideId: SideId;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface SideObservation {
  readonly time: number;
  readonly ownShip: OwnShipObservation;
  readonly contacts: readonly ContactObservation[];
}

export interface Battle {
  readonly sides: readonly SideSetup[];
  /** Simulated seconds since the battle began. */
  readonly time: number;
  /** Advances the battle by one fixed time step. */
  step(): void;
  /** Advances the battle by whole time steps covering `seconds`. */
  advance(seconds: number): void;
  /** What one side knows about the battle. */
  observe(sideId: SideId): SideObservation;
}

interface ShipState {
  readonly side: SideSetup;
  position: Vec3;
  velocity: Vec3;
}

export const createBattle = (setup: BattleSetup): Battle => {
  if (setup.sides.length !== setup.scenario.starts.length) {
    throw new Error('A scenario needs one start for each side');
  }
  const ships: ShipState[] = setup.sides.map((side, i) => {
    const start = setup.scenario.starts[i];
    if (!start) throw new Error(`No start for side ${side.id}`);
    return { side, position: start.position, velocity: start.velocity };
  });
  let steps = 0;

  const shipOf = (sideId: SideId): ShipState => {
    const ship = ships.find((s) => s.side.id === sideId);
    if (!ship) throw new Error(`Unknown side ${sideId}`);
    return ship;
  };

  const step = (): void => {
    for (const ship of ships) {
      ship.position = add(ship.position, scale(ship.velocity, TIME_STEP));
    }
    steps += 1;
  };

  return {
    sides: setup.sides,
    get time() {
      return steps * TIME_STEP;
    },
    step,
    advance(seconds) {
      const count = Math.round(seconds / TIME_STEP);
      for (let i = 0; i < count; i++) step();
    },
    observe(sideId) {
      const own = shipOf(sideId);
      return {
        time: steps * TIME_STEP,
        ownShip: {
          sideId,
          designName: own.side.design.name,
          position: own.position,
          velocity: own.velocity,
        },
        contacts: ships
          .filter((s) => s !== own)
          .map((s) => ({ sideId: s.side.id, position: s.position, velocity: s.velocity })),
      };
    },
  };
};
