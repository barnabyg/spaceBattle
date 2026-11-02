import { designComponent, designComponentsOfType, type Design } from './design';
import { BASE_TEMPERATURE, radiatedPower, thermalProperties } from './heat';
import type { ShipState } from './ship';

/**
 * What the captain ranks in a power order. 'capacitors' is the priority of charging them; it
 * also marks the line above which systems may draw on stored energy.
 */
export const POWER_SYSTEMS = ['drive', 'shields', 'weapons', 'capacitors'] as const;
export type PowerSystem = (typeof POWER_SYSTEMS)[number];
/** The systems that use power. Shields and weapons draw nothing until a design has them. */
export type PowerConsumer = Exclude<PowerSystem, 'capacitors'>;

/** Every ship starts a battle with this ranking: stored energy may cover any system. */
export const DEFAULT_PRIORITIES: readonly PowerSystem[] = [
  'shields',
  'weapons',
  'drive',
  'capacitors',
];

/** What a system asked for and got, W. */
export interface PowerShare {
  readonly demand: number;
  readonly supplied: number;
}

/** How power flowed in one step, W. */
export interface PowerFlow {
  /** For capacitors, their charging. */
  readonly systems: Readonly<Record<PowerSystem, PowerShare>>;
  /** Electrical power the reactor produced. */
  readonly reactorOutput: number;
  /** Power drawn from the capacitors. */
  readonly discharge: number;
}

/**
 * Running totals of where a ship's energy has gone since the battle began, J. Electrical energy
 * balances as reactorGenerated + capacitorDischarged = Σ delivered + capacitorCharged, and heat
 * as heatGenerated − heatRadiated = the change in the ship's heat.
 */
export interface EnergyLedger {
  /** Electrical energy the reactor generated. */
  readonly reactorGenerated: number;
  /** Heat the reactor gave off generating it. */
  readonly reactorHeat: number;
  /** Electrical energy delivered to each system. */
  readonly delivered: Readonly<Record<PowerConsumer, number>>;
  readonly capacitorCharged: number;
  readonly capacitorDischarged: number;
  /** The part of the drive's energy carried off in its exhaust; the rest became heat. */
  readonly driveExhaust: number;
  /** Heat from the reactor and from every system's waste. */
  readonly heatGenerated: number;
  readonly heatRadiated: number;
}

export const EMPTY_LEDGER: EnergyLedger = {
  reactorGenerated: 0,
  reactorHeat: 0,
  delivered: { drive: 0, shields: 0, weapons: 0 },
  capacitorCharged: 0,
  capacitorDischarged: 0,
  driveExhaust: 0,
  heatGenerated: 0,
  heatRadiated: 0,
};

const NO_SHARE: PowerShare = { demand: 0, supplied: 0 };
export const IDLE_FLOW: PowerFlow = {
  systems: { drive: NO_SHARE, shields: NO_SHARE, weapons: NO_SHARE, capacitors: NO_SHARE },
  reactorOutput: 0,
  discharge: 0,
};

/** A design's reactor and its capacitors taken together. */
export interface PowerPlant {
  /** W */
  readonly reactorOutput: number;
  readonly reactorEfficiency: number;
  /** J */
  readonly storageCapacity: number;
  /** W */
  readonly maxCharge: number;
  /** W */
  readonly maxDischarge: number;
}

const plants = new WeakMap<Design, PowerPlant>();

export const powerPlant = (design: Design): PowerPlant => {
  const cached = plants.get(design);
  if (cached) return cached;
  const reactor = designComponent(design, 'reactor');
  const capacitors = designComponentsOfType(design, 'capacitor');
  const sum = (f: (c: (typeof capacitors)[number]) => number) =>
    capacitors.reduce((total, c) => total + f(c), 0);
  const result: PowerPlant = {
    reactorOutput: reactor.output,
    reactorEfficiency: reactor.efficiency,
    storageCapacity: sum((c) => c.capacity),
    maxCharge: sum((c) => c.maxCharge),
    maxDischarge: sum((c) => c.maxDischarge),
  };
  plants.set(design, result);
  return result;
};

/**
 * Shares power out over a step of `dt` seconds in priority order. The reactor serves each
 * system in turn up to its output. Systems ranked above 'capacitors' may also draw on stored
 * energy to cover what the reactor cannot; the 'capacitors' entry charges them from whatever
 * the reactor has left at that point, and systems below it get only the reactor's remainder.
 */
export const allocatePower = (
  plant: PowerPlant,
  priorities: readonly PowerSystem[],
  stored: number,
  demands: Readonly<Record<PowerConsumer, number>>,
  dt: number,
): PowerFlow => {
  let reactorLeft = plant.reactorOutput;
  let storeLeft = Math.min(plant.maxDischarge, stored / dt);
  let discharge = 0;
  const systems: Record<PowerSystem, PowerShare> = { ...IDLE_FLOW.systems };
  for (const system of priorities) {
    if (system === 'capacitors') {
      const demand = Math.min(plant.maxCharge, Math.max(0, plant.storageCapacity - stored) / dt);
      const supplied = Math.min(demand, reactorLeft);
      reactorLeft -= supplied;
      storeLeft = 0;
      systems.capacitors = { demand, supplied };
      continue;
    }
    const demand = demands[system];
    const fromReactor = Math.min(demand, reactorLeft);
    const fromStore = Math.min(demand - fromReactor, storeLeft);
    reactorLeft -= fromReactor;
    storeLeft -= fromStore;
    discharge += fromStore;
    systems[system] = { demand, supplied: fromReactor + fromStore };
  }
  return { systems, reactorOutput: plant.reactorOutput - reactorLeft, discharge };
};

/** The power each system can have this step if it asks for `demands`, W. */
export const powerFlowOf = (
  ship: ShipState,
  demands: Readonly<Record<PowerConsumer, number>>,
  dt: number,
): PowerFlow =>
  allocatePower(powerPlant(ship.design), ship.priorities, ship.storedEnergy, demands, dt);

/**
 * Settles the step's power and heat once the drive has fired: shares out power, moves energy in
 * and out of the capacitors, adds the waste heat and radiates heat away at the ship's
 * temperature, keeping the ledger.
 */
export const settlePowerAndHeat = (ship: ShipState, dt: number): void => {
  const drive = designComponent(ship.design, 'drive');
  const plant = powerPlant(ship.design);
  const thermal = thermalProperties(ship.design);
  const flow = powerFlowOf(ship, { drive: ship.driveEnergy.used / dt, shields: 0, weapons: 0 }, dt);
  const { drive: driveShare, shields, weapons, capacitors } = flow.systems;
  ship.powerFlow = {
    ...flow,
    // The drive asked for what its ordered throttle needs; power and heat may have held it back.
    systems: { ...flow.systems, drive: { ...driveShare, demand: ship.driveEnergy.wanted / dt } },
  };
  ship.storedEnergy = Math.min(
    plant.storageCapacity,
    Math.max(0, ship.storedEnergy + (capacitors.supplied - flow.discharge) * dt),
  );

  // A reactor of efficiency η gives off (1 − η)/η of its electrical output as heat. Shields and
  // weapons turn all their power into heat until they have somewhere else to send it.
  const reactorHeat =
    (flow.reactorOutput * (1 - plant.reactorEfficiency)) / plant.reactorEfficiency;
  const driveHeat = driveShare.supplied * drive.wasteHeatFraction;
  const generated = reactorHeat + driveHeat + shields.supplied + weapons.supplied;
  const emittance = ship.radiatorsDeployed
    ? thermal.emittance.deployed
    : thermal.emittance.retracted;
  // The coolant loop bypasses the radiators rather than chill the ship below its base temperature.
  const surplus = ship.heat - thermal.heatCapacity * BASE_TEMPERATURE;
  const radiated = Math.min(
    radiatedPower(emittance, ship.heat / thermal.heatCapacity),
    Math.max(0, surplus / dt + generated),
  );
  ship.heat += (generated - radiated) * dt;
  ship.heatFlow = { generated, radiated };

  const ledger = ship.ledger;
  ship.ledger = {
    reactorGenerated: ledger.reactorGenerated + flow.reactorOutput * dt,
    reactorHeat: ledger.reactorHeat + reactorHeat * dt,
    delivered: {
      drive: ledger.delivered.drive + driveShare.supplied * dt,
      shields: ledger.delivered.shields + shields.supplied * dt,
      weapons: ledger.delivered.weapons + weapons.supplied * dt,
    },
    capacitorCharged: ledger.capacitorCharged + capacitors.supplied * dt,
    capacitorDischarged: ledger.capacitorDischarged + flow.discharge * dt,
    driveExhaust: ledger.driveExhaust + (driveShare.supplied - driveHeat) * dt,
    heatGenerated: ledger.heatGenerated + generated * dt,
    heatRadiated: ledger.heatRadiated + radiated * dt,
  };
};
