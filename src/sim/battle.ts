import type { Design } from './design';
import {
  manoeuvreCommand,
  manoeuvreThrottle,
  observeManoeuvre,
  type ManoeuvreCommand,
  type ManoeuvreObservation,
  type ManoeuvreTarget,
} from './manoeuvre';
import { thermalLimit, thermalProperties } from './heat';
import type { AttitudeOrder, Order } from './orders';
import {
  POWER_SYSTEMS,
  powerPlant,
  settlePowerAndHeat,
  type EnergyLedger,
  type PowerShare,
  type PowerSystem,
} from './power';
import { IDENTITY, rotate, type Quat } from './quaternion';
import {
  burn,
  createShip,
  deltaVOf,
  driveLimit,
  fireDrive,
  massProperties,
  noseOf,
  steer,
  temperatureOf,
  type BurnState,
  type ShipState,
} from './ship';
import { TIME_STEP } from './time';
import { add, length, normalize, scale, sub, type Vec3 } from './vector';

export { TIME_STEP };

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
  /** Body frame to world; the identity points the nose along +x. */
  readonly orientation?: Quat;
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

/** A ship's power: its ranking, where power went in the last step, and what is stored. */
export interface PowerObservation {
  /** Highest priority first. */
  readonly priorities: readonly PowerSystem[];
  /** Electrical output in the last step, W. */
  readonly reactorOutput: number;
  /** The most the reactor can produce, W. */
  readonly reactorCapacity: number;
  /** What each system asked for and got in the last step, W; for capacitors, charging. */
  readonly systems: Readonly<Record<PowerSystem, PowerShare>>;
  /** Power drawn from the capacitors in the last step, W. */
  readonly discharge: number;
  /** Energy in the capacitors, J. */
  readonly stored: number;
  /** J */
  readonly storageCapacity: number;
  /** The fraction of the drive's full thrust that power and heat allow now. */
  readonly driveLimit: number;
}

/** A ship's heat and how fast it is coming and going. */
export interface HeatObservation {
  /** Heat held in the ship, J: its heat capacity times its temperature. */
  readonly heat: number;
  /** J/K */
  readonly heatCapacity: number;
  /** K */
  readonly temperature: number;
  /** Heat generated in the last step, W. */
  readonly generated: number;
  /** Heat radiated into space in the last step, W. */
  readonly radiated: number;
  readonly radiatorsDeployed: boolean;
  /** Radiating area now exposed, m². */
  readonly radiatorArea: number;
  /** The fraction of their full power systems may use at this temperature. */
  readonly thermalLimit: number;
}

/** A side's own ship, which it knows in full. */
export interface OwnShipObservation {
  readonly sideId: SideId;
  readonly designName: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly orientation: Quat;
  /** World unit vector along the ship's long axis. */
  readonly nose: Vec3;
  /** World frame, rad/s. */
  readonly angularVelocity: Vec3;
  /** kg */
  readonly mass: number;
  /** kg */
  readonly propellantMass: number;
  /** m/s */
  readonly deltaV: number;
  /** Drive thrust applied in the last step, N. */
  readonly thrust: number;
  /** Thruster torque applied in the last step (body frame), N·m. */
  readonly torque: Vec3;
  readonly attitude: AttitudeOrder | null;
  readonly burn: BurnState | null;
  /** The standing manoeuvre order and its plan; null under manual control. */
  readonly manoeuvre: ManoeuvreObservation | null;
  readonly power: PowerObservation;
  readonly heat: HeatObservation;
  /** Where the ship's energy has gone since the battle began. */
  readonly energyLedger: EnergyLedger;
}

/** An enemy ship as a side perceives it; its position, motion and orientation are known. */
export interface ContactObservation {
  readonly sideId: SideId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly orientation: Quat;
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
  /** Gives an order to a side's ship; it takes effect from the next step. */
  giveOrder(sideId: SideId, order: Order): void;
  /** Advances the battle by one fixed time step. */
  step(): void;
  /** Advances the battle by whole time steps covering `seconds`. */
  advance(seconds: number): void;
  /** What one side knows about the battle. */
  observe(sideId: SideId): SideObservation;
}

interface Combatant {
  readonly side: SideSetup;
  readonly ship: ShipState;
}

const checkOrder = (order: Order): Order => {
  switch (order.type) {
    case 'burn':
      if (!(order.throttle >= 0 && order.throttle <= 1)) throw new Error('Throttle must be 0–1');
      if (!(order.duration >= 0 && Number.isFinite(order.duration))) {
        throw new Error('Burn duration must be a non-negative number of seconds');
      }
      return order;
    case 'attitude':
      if (order.mode !== 'direction') return order;
      if (!(length(order.direction) > 0)) {
        throw new Error('An attitude direction needs a length');
      }
      return { ...order, direction: normalize(order.direction) };
    case 'manoeuvre':
      if (order.goal === 'none' || order.goal === 'match-velocity') return order;
      if (!(order.range > 0 && Number.isFinite(order.range))) {
        throw new Error('A manoeuvre range must be a positive number of metres');
      }
      return order;
    case 'power': {
      const { priorities } = order;
      const complete =
        priorities.length === POWER_SYSTEMS.length &&
        POWER_SYSTEMS.every((system) => priorities.includes(system));
      if (!complete) {
        throw new Error(`A power order must rank each of ${POWER_SYSTEMS.join(', ')} once`);
      }
      return { ...order, priorities: [...priorities] };
    }
    case 'radiators':
      return order;
  }
};

const observePower = (ship: ShipState): PowerObservation => {
  const plant = powerPlant(ship.design);
  return {
    priorities: ship.priorities,
    reactorOutput: ship.powerFlow.reactorOutput,
    reactorCapacity: plant.reactorOutput,
    systems: ship.powerFlow.systems,
    discharge: ship.powerFlow.discharge,
    stored: ship.storedEnergy,
    storageCapacity: plant.storageCapacity,
    driveLimit: driveLimit(ship),
  };
};

const observeHeat = (ship: ShipState): HeatObservation => {
  const thermal = thermalProperties(ship.design);
  const temperature = temperatureOf(ship);
  return {
    heat: ship.heat,
    heatCapacity: thermal.heatCapacity,
    temperature,
    generated: ship.heatFlow.generated,
    radiated: ship.heatFlow.radiated,
    radiatorsDeployed: ship.radiatorsDeployed,
    radiatorArea: ship.radiatorsDeployed ? thermal.area.deployed : thermal.area.retracted,
    thermalLimit: thermalLimit(temperature),
  };
};

export const createBattle = (setup: BattleSetup): Battle => {
  if (setup.sides.length !== setup.scenario.starts.length) {
    throw new Error('A scenario needs one start for each side');
  }
  const combatants: Combatant[] = setup.sides.map((side, i) => {
    const start = setup.scenario.starts[i];
    if (!start) throw new Error(`No start for side ${side.id}`);
    return {
      side,
      ship: createShip(side.design, start.position, start.velocity, start.orientation ?? IDENTITY),
    };
  });
  let steps = 0;

  const combatantOf = (sideId: SideId): Combatant => {
    const combatant = combatants.find((c) => c.side.id === sideId);
    if (!combatant) throw new Error(`Unknown side ${sideId}`);
    return combatant;
  };
  const enemyOf = (combatant: Combatant): Combatant | undefined =>
    combatants.find((c) => c !== combatant);

  const attitudeTarget = (combatant: Combatant): Vec3 | null => {
    const { ship } = combatant;
    const order = ship.attitude;
    if (!order) return null;
    if (order.mode === 'direction') return order.direction;
    const enemy = enemyOf(combatant);
    if (!enemy) return null;
    const towards = normalize(sub(enemy.ship.position, ship.position));
    return order.mode === 'enemy' ? towards : scale(towards, -1);
  };

  /** What the ship knows of the enemy for its autopilot: the contact's position and velocity. */
  const contactOf = (combatant: Combatant): ManoeuvreTarget | null => {
    const enemy = enemyOf(combatant);
    return enemy ? { position: enemy.ship.position, velocity: enemy.ship.velocity } : null;
  };

  const step = (): void => {
    // Every ship plans from the same snapshot of positions, so the order of sides never matters.
    const plans = combatants.map(
      (c): { heading: Vec3 | null; command: ManoeuvreCommand | null } => {
        const state = c.ship.manoeuvre;
        if (!state) return { heading: attitudeTarget(c), command: null };
        const command = manoeuvreCommand(c.ship, state, contactOf(c));
        return { heading: command.heading, command };
      },
    );
    combatants.forEach(({ ship }, i) => {
      const { heading, command } = plans[i] ?? { heading: null, command: null };
      steer(ship, heading, TIME_STEP);
      if (command && ship.manoeuvre) {
        ship.manoeuvre = { ...ship.manoeuvre, correcting: command.correcting };
        fireDrive(ship, manoeuvreThrottle(ship, command, TIME_STEP), TIME_STEP);
      } else {
        burn(ship, TIME_STEP);
      }
      settlePowerAndHeat(ship, TIME_STEP);
      ship.position = add(ship.position, scale(ship.velocity, TIME_STEP));
    });
    steps += 1;
  };

  return {
    sides: setup.sides,
    get time() {
      return steps * TIME_STEP;
    },
    giveOrder(sideId, order) {
      const { ship } = combatantOf(sideId);
      const checked = checkOrder(order);
      // Manual orders and manoeuvres replace each other: one or the other steers the ship.
      switch (checked.type) {
        case 'manoeuvre':
          ship.attitude = null;
          ship.burn = null;
          ship.manoeuvre = checked.goal === 'none' ? null : { order: checked, correcting: false };
          break;
        case 'attitude':
          ship.manoeuvre = null;
          ship.attitude = checked;
          break;
        case 'burn':
          ship.manoeuvre = null;
          ship.burn =
            checked.throttle > 0 && checked.duration > 0
              ? { throttle: checked.throttle, remaining: checked.duration }
              : null;
          break;
        case 'power':
          ship.priorities = checked.priorities;
          break;
        case 'radiators':
          ship.radiatorsDeployed = checked.deployed;
          break;
      }
    },
    step,
    advance(seconds) {
      const count = Math.round(seconds / TIME_STEP);
      for (let i = 0; i < count; i++) step();
    },
    observe(sideId) {
      const own = combatantOf(sideId);
      const { ship } = own;
      return {
        time: steps * TIME_STEP,
        ownShip: {
          sideId,
          designName: own.side.design.name,
          position: ship.position,
          velocity: ship.velocity,
          orientation: ship.orientation,
          nose: noseOf(ship),
          angularVelocity: rotate(ship.orientation, ship.angularVelocity),
          mass: massProperties(ship.design, ship.propellantMass).mass,
          propellantMass: ship.propellantMass,
          deltaV: deltaVOf(ship),
          thrust: ship.thrust,
          torque: ship.torque,
          attitude: ship.attitude,
          burn: ship.burn,
          manoeuvre: ship.manoeuvre ? observeManoeuvre(ship, ship.manoeuvre, contactOf(own)) : null,
          power: observePower(ship),
          heat: observeHeat(ship),
          energyLedger: ship.ledger,
        },
        contacts: combatants
          .filter((c) => c !== own)
          .map(({ side, ship: s }) => ({
            sideId: side.id,
            position: s.position,
            velocity: s.velocity,
            orientation: s.orientation,
          })),
      };
    },
  };
};
