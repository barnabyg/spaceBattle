import { componentSlots } from './components';
import { intactShape, overheat, strike, type DamageContext } from './damage';
import type { ArmourType, ComponentType, Design, SectionKind } from './design';
import { involves, type BattleEvent, type HitEvent } from './events';
import {
  manoeuvreCommand,
  manoeuvreThrottle,
  observeManoeuvre,
  type ManoeuvreCommand,
  type ManoeuvreObservation,
  type ContactMotion,
} from './manoeuvre';
import { thermalLimit, thermalProperties, workingRadiators } from './heat';
import type { AttitudeOrder, FireMode, Order } from './orders';
import {
  POWER_SYSTEMS,
  powerPlantOf,
  settlePowerAndHeat,
  type EnergyLedger,
  type PowerShare,
  type PowerSystem,
} from './power';
import { endedBy, judge, lossOf, type BattleOutcome } from './outcome';
import { IDENTITY, rotate, type Quat } from './quaternion';
import { createRandom } from './random';
import type { ShapePart } from './shape';
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
import { add, distance, length, normalize, scale, sub, type Vec3 } from './vector';
import { aimWeapons, effectiveRange, emitBeams, type Beam } from './weapons';

export { TIME_STEP };
export type { BattleEvent, BattleOutcome };

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

/** A component and how much more damage it can take. */
export interface ComponentObservation {
  readonly type: ComponentType;
  /** 0–1; it works in proportion and stops at zero. */
  readonly integrity: number;
}

/** A section's armour, structure and components. */
export interface SectionObservation {
  readonly kind: SectionKind;
  readonly armour: {
    readonly type: ArmourType;
    /** As designed, m. */
    readonly thickness: number;
    /** Left at the point of fire, m. */
    readonly remaining: number;
  };
  /** Integrity of the section's own structure (0–1); at zero it has failed and is lost. */
  readonly structure: number;
  /** Inside the armour. */
  readonly components: readonly ComponentObservation[];
  readonly mounts: readonly ComponentObservation[];
}

/** One laser and what it is doing. */
export interface LaserObservation {
  readonly section: SectionKind;
  /** Its place in the section's mounts. */
  readonly mount: number;
  readonly integrity: number;
  /** Whether it put power into its beam in the last step. */
  readonly firing: boolean;
  /** Power it put into its beam in the last step, W. */
  readonly beamPower: number;
  /** Beam power at full integrity, W. */
  readonly fullBeamPower: number;
  /** How far it fires: out to where its beam keeps a useful intensity, m. */
  readonly effectiveRange: number;
}

/** The ship's weapons: the captain's weapons order, the lasers and the latest hit scored. */
export interface WeaponsObservation {
  readonly target: SideId | null;
  readonly mode: FireMode;
  readonly lasers: readonly LaserObservation[];
  readonly lastHit: HitEvent | null;
}

/** A beam landing on a ship. */
export interface BeamLanding {
  /** Where it lands, in the ship's body frame (centre of mass at the origin, nose along +x), m. */
  readonly point: Vec3;
  /** Beam power landing, W. */
  readonly power: number;
  /** m */
  readonly spotRadius: number;
}

/** How a ship looks from outside: what an instrument view needs to draw it. */
export interface ShipAppearance {
  /** kg; with the design it sets the centre of mass, the origin of the body frame. */
  readonly propellantMass: number;
  readonly radiatorsDeployed: boolean;
  /** The ship's temperature, which its radiators glow with, K. */
  readonly temperature: number;
  /** Drive thrust applied in the last step, N. */
  readonly thrust: number;
  /** The parts still there, in the body frame: sections not failed, mounts not wrecked. */
  readonly parts: readonly ShapePart[];
  /** Where beams landed on the ship in the last step. */
  readonly beamsLanding: readonly BeamLanding[];
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
  /** From nose to tail. */
  readonly sections: readonly SectionObservation[];
  readonly weapons: WeaponsObservation;
  readonly appearance: ShipAppearance;
}

/** An enemy ship as a side perceives it; its position, motion and orientation are known. */
export interface ContactObservation {
  readonly sideId: SideId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly orientation: Quat;
  /** Full detail until sensors limit what a side can make out (a later phase). */
  readonly appearance: ShipAppearance;
}

export interface SideObservation {
  readonly time: number;
  readonly ownShip: OwnShipObservation;
  readonly contacts: readonly ContactObservation[];
  /** The latest events about this side's ship or hits it scored, oldest first. */
  readonly events: readonly BattleEvent[];
  /** How the battle ended, or null while it goes on. */
  readonly outcome: BattleOutcome | null;
}

export interface Battle {
  readonly sides: readonly SideSetup[];
  /** Simulated seconds since the battle began. */
  readonly time: number;
  /**
   * How the battle ended, or null while it goes on. Once it has ended the battle is frozen:
   * time stops, steps do nothing and return no events, and orders are ignored.
   */
  readonly outcome: BattleOutcome | null;
  /** Gives an order to a side's ship; it takes effect from the next step. */
  giveOrder(sideId: SideId, order: Order): void;
  /**
   * Advances the battle by one fixed time step, returning what happened in it. A step in which
   * a ship loses ends the battle, with a 'battle-ended' event last.
   */
  step(): readonly BattleEvent[];
  /** Advances the battle by whole time steps covering `seconds`, returning what happened. */
  advance(seconds: number): readonly BattleEvent[];
  /** What one side knows about the battle. */
  observe(sideId: SideId): SideObservation;
  /**
   * A side chooses "End battle", ending it at once: a forfeit for a player side, no result
   * between computer sides (see `endedBy`). Returns the 'battle-ended' event, or nothing if the
   * battle was already over.
   */
  endBattle(sideId: SideId): readonly BattleEvent[];
}

interface Combatant {
  readonly side: SideSetup;
  readonly ship: ShipState;
  /** Beams that landed on the ship in the last step. */
  beamsLanding: BeamLanding[];
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
    case 'weapons':
      return order;
  }
};

/** How many recent events each side's observation keeps. */
const EVENT_LOG_LENGTH = 20;

const observePower = (ship: ShipState): PowerObservation => {
  const plant = powerPlantOf(ship);
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
  const radiators = workingRadiators(ship.design, ship.integrity, ship.radiatorsDeployed);
  return {
    heat: ship.heat,
    heatCapacity: thermal.heatCapacity,
    temperature,
    generated: ship.heatFlow.generated,
    radiated: ship.heatFlow.radiated,
    radiatorsDeployed: ship.radiatorsDeployed,
    radiatorArea: radiators.area,
    thermalLimit: thermalLimit(temperature),
  };
};

const observeSections = (ship: ShipState): SectionObservation[] => {
  const slots = componentSlots(ship.design);
  const parts = (kind: SectionKind, mounted: boolean): ComponentObservation[] =>
    slots.flatMap((slot, i) =>
      slot.section === kind && slot.mounted === mounted
        ? [{ type: slot.component.type, integrity: ship.integrity[i] ?? 0 }]
        : [],
    );
  return ship.design.sections.map((section) => ({
    kind: section.kind,
    armour: {
      type: section.armour.type,
      thickness: section.armour.thickness,
      remaining: ship.sections[section.kind].armour,
    },
    structure: ship.sections[section.kind].structure,
    components: parts(section.kind, false),
    mounts: parts(section.kind, true),
  }));
};

const observeWeapons = (ship: ShipState): WeaponsObservation => {
  const slots = componentSlots(ship.design);
  const { weapons } = ship;
  return {
    target: weapons.target,
    mode: weapons.mode,
    lasers: weapons.lasers.map((laser) => ({
      section: slots[laser.slot]?.section ?? 'forward',
      mount: slots[laser.slot]?.index ?? 0,
      integrity: ship.integrity[laser.slot] ?? 0,
      firing: laser.beamPower > 0,
      beamPower: laser.beamPower,
      fullBeamPower: laser.laser.beamPower,
      effectiveRange: effectiveRange(laser.laser),
    })),
    lastHit: weapons.lastHit,
  };
};

const observeAppearance = ({ ship, beamsLanding }: Combatant): ShipAppearance => ({
  propellantMass: ship.propellantMass,
  radiatorsDeployed: ship.radiatorsDeployed,
  temperature: temperatureOf(ship),
  thrust: ship.thrust,
  parts: intactShape(ship),
  beamsLanding,
});

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
      beamsLanding: [],
    };
  });
  let steps = 0;
  const random = createRandom(setup.seed);
  /** Beams on their way to their targets, in the order fired. */
  let beams: Beam[] = [];
  const logs = new Map<SideId, BattleEvent[]>(setup.sides.map((side) => [side.id, []]));
  let outcome: BattleOutcome | null = null;

  /** Keeps each side's latest events about it. */
  const record = (events: readonly BattleEvent[]) => {
    for (const [side, log] of logs) {
      log.push(...events.filter((event) => involves(event, side)));
      log.splice(0, Math.max(0, log.length - EVENT_LOG_LENGTH));
    }
  };

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
  const contactOf = (combatant: Combatant): ContactMotion | null => {
    const enemy = enemyOf(combatant);
    return enemy ? { position: enemy.ship.position, velocity: enemy.ship.velocity } : null;
  };

  /** The ship a side's weapons are ordered to fire at, if any. */
  const targetOf = (combatant: Combatant): Combatant | undefined => {
    const id = combatant.ship.weapons.target;
    return id === null ? undefined : combatants.find((c) => c.side.id === id);
  };

  /** A beam arriving: it strikes the target, and the attacker learns of a new hit. */
  const resolveBeam = (beam: Beam, ctx: Omit<DamageContext, 'side'>) => {
    const target = combatantOf(beam.target);
    const attacker = combatantOf(beam.attacker).ship;
    const landed = strike(target.ship, beam, { ...ctx, side: beam.target });
    if (landed) {
      const { point, power, spotRadius } = landed;
      target.beamsLanding.push({ point, power, spotRadius });
    }
    const part = landed
      ? landed.part.mount === null
        ? landed.part.section
        : `${landed.part.section}/${String(landed.part.mount)}`
      : null;
    const laser = attacker.weapons.lasers[beam.laser];
    if (!laser) return;
    if (landed && part && (!beam.continuing || laser.striking !== part)) {
      const hit: HitEvent = {
        type: 'hit',
        time: ctx.time,
        attacker: beam.attacker,
        target: beam.target,
        section: landed.part.section,
        mount: landed.part.mount,
        power: landed.power,
        intensity: landed.intensity,
        spotRadius: landed.spotRadius,
        range: beam.range,
      };
      ctx.events.push(hit);
      attacker.weapons = { ...attacker.weapons, lastHit: hit };
    }
    attacker.weapons = {
      ...attacker.weapons,
      lasers: attacker.weapons.lasers.map((l, i) =>
        i === beam.laser ? { ...l, striking: part } : l,
      ),
    };
  };

  const step = (): readonly BattleEvent[] => {
    if (outcome) return [];
    const start = steps * TIME_STEP;
    // Weapons choose whether to fire first, so the drive knows what power they will ask for.
    combatants.forEach((c) => {
      const target = targetOf(c);
      aimWeapons(c.ship, target ? distance(c.ship.position, target.ship.position) : null);
    });
    // Every ship plans from the same snapshot of positions, so the order of sides never matters.
    const plans = combatants.map(
      (c): { heading: Vec3 | null; command: ManoeuvreCommand | null } => {
        const state = c.ship.manoeuvre;
        if (!state) return { heading: attitudeTarget(c), command: null };
        const command = manoeuvreCommand(c.ship, state, contactOf(c));
        return { heading: command.heading, command };
      },
    );
    combatants.forEach((combatant, i) => {
      const { ship } = combatant;
      const { heading, command } = plans[i] ?? { heading: null, command: null };
      steer(ship, heading, TIME_STEP);
      if (command && ship.manoeuvre) {
        ship.manoeuvre = { ...ship.manoeuvre, correcting: command.correcting };
        fireDrive(ship, manoeuvreThrottle(ship, command, TIME_STEP), TIME_STEP);
      } else {
        burn(ship, TIME_STEP);
      }
      settlePowerAndHeat(ship, TIME_STEP);
      const target = targetOf(combatant);
      beams.push(
        ...emitBeams(
          ship,
          combatant.side.id,
          target ? { id: target.side.id, position: target.ship.position } : null,
          start,
        ),
      );
    });
    // Ships move after all have fired, so every beam leaves from the same snapshot.
    combatants.forEach(({ ship }) => {
      ship.position = add(ship.position, scale(ship.velocity, TIME_STEP));
    });
    steps += 1;

    // Beams that reach their targets by the end of the step strike them, in the order fired.
    const time = steps * TIME_STEP;
    const events: BattleEvent[] = [];
    const arriving = beams.filter((b) => b.arrival <= time + 1e-9);
    beams = beams.filter((b) => b.arrival > time + 1e-9);
    combatants.forEach((c) => {
      if (c.beamsLanding.length > 0) c.beamsLanding = [];
    });
    for (const beam of arriving) resolveBeam(beam, { time, random, events });
    combatants.forEach(({ side, ship }) => {
      overheat(ship, TIME_STEP, { side: side.id, time, random, events });
    });
    // Ships that lost in this step lose together; if all of them did, nobody wins.
    outcome = judge(
      time,
      combatants.map(({ side, ship }) => ({ side: side.id, loss: lossOf(ship) })),
    );
    if (outcome) events.push({ type: 'battle-ended', time, outcome });
    record(events);
    return events;
  };

  return {
    sides: setup.sides,
    get time() {
      return steps * TIME_STEP;
    },
    get outcome() {
      return outcome;
    },
    giveOrder(sideId, order) {
      const { ship } = combatantOf(sideId);
      const checked = checkOrder(order);
      if (outcome) return;
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
        case 'weapons':
          if (checked.target !== null && combatantOf(checked.target).side.id === sideId) {
            throw new Error('A ship cannot target itself');
          }
          ship.weapons = { ...ship.weapons, target: checked.target, mode: checked.mode };
          break;
      }
    },
    step,
    advance(seconds) {
      const count = Math.round(seconds / TIME_STEP);
      const events: BattleEvent[] = [];
      for (let i = 0; i < count; i++) events.push(...step());
      return events;
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
          sections: observeSections(ship),
          weapons: observeWeapons(ship),
          appearance: observeAppearance(own),
        },
        contacts: combatants
          .filter((c) => c !== own)
          .map((c) => ({
            sideId: c.side.id,
            position: c.ship.position,
            velocity: c.ship.velocity,
            orientation: c.ship.orientation,
            appearance: observeAppearance(c),
          })),
        events: [...(logs.get(sideId) ?? [])],
        outcome,
      };
    },
    endBattle(sideId) {
      if (outcome) return [];
      outcome = endedBy(steps * TIME_STEP, setup.sides, sideId);
      const events: BattleEvent[] = [{ type: 'battle-ended', time: outcome.time, outcome }];
      record(events);
      return events;
    },
  };
};
