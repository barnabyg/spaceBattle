import { effectiveRange } from './beams';
import { componentSlots } from './components';
import {
  impactBurst,
  impactKinetic,
  intactShape,
  irradiate,
  overheat,
  strike,
  type DamageContext,
} from './damage';
import {
  designComponentsOfType,
  type ArmourType,
  type ComponentType,
  type Design,
  type NuclearWarheadDesign,
  type SectionKind,
  type ShieldType,
  type WarheadType,
} from './design';
import {
  involves,
  type BattleEvent,
  type BeamKind,
  type HitEvent,
  type MunitionKind,
  type NuclearExposure,
  type ParticleBeamKind,
} from './events';
import {
  manoeuvreCommand,
  manoeuvreThrottle,
  observeManoeuvre,
  type ManoeuvreCommand,
  type ManoeuvreObservation,
  type ContactMotion,
} from './manoeuvre';
import { thermalLimit, thermalProperties, workingRadiators } from './heat';
import {
  kineticGunRange,
  shapeRadius,
  shotEnergy,
  slugPassed,
  sweepSlug,
  type Motion,
  type Slug,
  type Target,
} from './kinetic';
import {
  fuseTrigger,
  guideMissile,
  missileDeltaV,
  missileMassNow,
  missileReach,
  type Missile,
} from './missile';
import {
  POINT_DEFENCE_PRIORITIES,
  type AttitudeOrder,
  type FireMode,
  type Order,
  type PointDefencePriority,
} from './orders';
import {
  burstEnergy,
  pointDefenceRange,
  type PointDefenceEngagement,
  type Threat,
} from './pointDefence';
import {
  POWER_SYSTEMS,
  powerPlantOf,
  settlePowerAndHeat,
  type EnergyLedger,
  type PowerShare,
  type PowerSystem,
} from './power';
import { endedBy, judge, lossOf, noResult, type BattleOutcome } from './outcome';
import { IDENTITY, rotate, type Quat } from './quaternion';
import { createRandom } from './random';
import type { ShapePart } from './shape';
import { coolantCapacity, fullDeflection, shieldsPowered } from './shields';
import {
  burn,
  createShip,
  deltaVOf,
  driveLimit,
  fireDrive,
  noseOf,
  shipMassProperties,
  steer,
  temperatureOf,
  type AmmunitionSpent,
  type BurnState,
  type ShipState,
} from './ship';
import { TIME_STEP } from './time';
import { add, distance, dot, length, normalize, scale, sub, type Vec3 } from './vector';
import {
  aimWeapons,
  emitBeams,
  fireKineticGuns,
  firePointDefence,
  launchMissiles,
  missilesLeft,
  roundsLeft,
  slugsLeft,
  type Beam,
  type BeamWeaponState,
  type PointDefenceBurst,
  type PointDefenceTargets,
  type Salvo,
} from './weapons';

export { TIME_STEP };
export type { BattleEvent, BattleOutcome, PointDefenceEngagement, PointDefencePriority };

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
  /**
   * Test mode only: once this much simulated time has passed without a side losing, the battle
   * ends with no result, s. A battle normally has no time limit.
   */
  readonly timeLimit?: number;
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
  /** Laser heat the coolant shields carried into the ship in the last step, W. */
  readonly absorbed: number;
  readonly radiatorsDeployed: boolean;
  /** Radiating area now exposed, m². */
  readonly radiatorArea: number;
  /** The fraction of their full power systems may use at this temperature. */
  readonly thermalLimit: number;
}

/** One shield and where it sits. */
export interface ShieldObservation {
  readonly type: ShieldType;
  readonly section: SectionKind;
  /** Its place in the section's components. */
  readonly index: number;
  readonly integrity: number;
}

/**
 * The ship's shields and what they can do now. A magnetic shield's field covers the whole ship; a
 * coolant shield protects only the section it is in.
 */
export interface ShieldsObservation {
  /** Whether the captain has them raised; lowered, they draw no power and do nothing. */
  readonly raised: boolean;
  /** The share of their full power they were given in the last step (0–1). */
  readonly powered: number;
  /** Every shield the ship carries, from nose to tail. */
  readonly shields: readonly ShieldObservation[];
  /**
   * Kinetic energy of the hardest protons the magnetic shields turn away entirely now, J; harder
   * ones are turned away in part. Zero without a working, powered magnetic shield.
   */
  readonly fullDeflection: number;
  /** Laser power the coolant shields in each section can carry away now, W. */
  readonly coolantCapacity: Readonly<Record<SectionKind, number>>;
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

/** One beam weapon, a laser or a particle beam, and what it is doing. */
export interface BeamWeaponObservation {
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

/** One laser and what it is doing. */
export type LaserObservation = BeamWeaponObservation;

/** One particle beam, charged or neutral, and what it is doing. */
export interface ParticleBeamObservation extends BeamWeaponObservation {
  readonly kind: ParticleBeamKind;
}

/** One kinetic gun and what it is doing. */
export interface KineticGunObservation {
  readonly section: SectionKind;
  /** Its place in the section's mounts. */
  readonly mount: number;
  readonly integrity: number;
  /** Whether it is firing at the target: drawing power for its next shot, or loosing one. */
  readonly firing: boolean;
  /** How much of the energy for its next shot it has drawn (0–1). */
  readonly charge: number;
  /** Electrical energy each shot takes, J. */
  readonly shotEnergy: number;
  /** m/s */
  readonly muzzleVelocity: number;
  /** kg */
  readonly slugMass: number;
  /** Shots per second, given full power. */
  readonly rateOfFire: number;
  /** How far it fires: out to the longest flight fire control allows a slug, m. */
  readonly effectiveRange: number;
}

/** One point defence gun and what it is doing. */
export interface PointDefenceObservation {
  readonly section: SectionKind;
  /** Its place in the section's mounts. */
  readonly mount: number;
  readonly integrity: number;
  /** What it fired on, or was drawing power to fire on, in the last step; null if nothing. */
  readonly engaging: PointDefenceEngagement | null;
  /** How much of the energy for its next burst it has drawn (0–1). */
  readonly charge: number;
  /** Electrical energy each burst takes, J. */
  readonly burstEnergy: number;
  /** Bursts per second, given full power. */
  readonly burstRate: number;
  readonly roundsPerBurst: number;
  /** kg */
  readonly roundMass: number;
  /** m/s */
  readonly muzzleVelocity: number;
  /** Half-angle of the cone its rounds spread through, rad. */
  readonly dispersion: number;
  /** How far it fires: out to the longest flight fire control allows its rounds, m. */
  readonly effectiveRange: number;
  /** The chance its latest burst at a missile had of bringing it down, or null before any. */
  readonly lastChance: number | null;
}

/** One launcher and what it is doing. */
export interface LauncherObservation {
  readonly section: SectionKind;
  /** Its place in the section's mounts. */
  readonly mount: number;
  readonly integrity: number;
  /** Whether it has a missile loaded, ready to launch. */
  readonly loaded: boolean;
  /** Time until its next missile is loaded, s. */
  readonly reload: number;
  /** Time to load a missile at full integrity, s. */
  readonly reloadTime: number;
}

/** One missile design the ship carries and how far it reaches. */
export interface MissileDesignObservation {
  readonly name: string;
  readonly warhead: WarheadType;
  /** kg, with its propellant. */
  readonly mass: number;
  /** m/s, with a full load of propellant. */
  readonly deltaV: number;
  /** m (see `missileReach`). */
  readonly reach: number;
}

/** The ship's ammunition. */
export interface AmmunitionObservation {
  /** Slugs left in working magazines. */
  readonly slugs: number;
  /** Slugs the magazines hold when full. */
  readonly slugCapacity: number;
  /** Point defence rounds left in working magazines. */
  readonly rounds: number;
  /** Point defence rounds the magazines hold when full. */
  readonly roundCapacity: number;
  /** Missiles left in working magazines. */
  readonly missiles: number;
  /** Missiles the magazines hold when full. */
  readonly missileCapacity: number;
  /** The missiles the magazines hold, one entry per design. */
  readonly missileDesigns: readonly MissileDesignObservation[];
}

/**
 * The ship's weapons: the captain's weapons, launch and point defence orders, each weapon, the
 * latest beam hit scored and the missiles shot down.
 */
export interface WeaponsObservation {
  readonly target: SideId | null;
  readonly mode: FireMode;
  readonly lasers: readonly LaserObservation[];
  /** Charged and neutral particle beams. */
  readonly particleBeams: readonly ParticleBeamObservation[];
  readonly kineticGuns: readonly KineticGunObservation[];
  readonly pointDefence: readonly PointDefenceObservation[];
  /** What the point defence fires on. */
  readonly pointDefencePriority: PointDefencePriority;
  /** Enemy missiles the ship has shot down. */
  readonly intercepts: number;
  readonly launchers: readonly LauncherObservation[];
  /** Missiles still to launch under the latest launch order, or null when none are. */
  readonly salvo: Salvo | null;
  readonly ammunition: AmmunitionObservation;
  readonly lastHit: HitEvent | null;
}

/** A beam landing on a ship. */
export interface BeamLanding {
  /** What kind of beam it is. */
  readonly attack: BeamKind;
  /** Where it lands, in the ship's body frame (centre of mass at the origin, nose along +x), m. */
  readonly point: Vec3;
  /** Beam power landing, W. */
  readonly power: number;
  /** m */
  readonly spotRadius: number;
}

/** A slug or missile striking a ship. */
export interface ImpactLanding {
  /** Where it struck, in the ship's body frame, m. */
  readonly point: Vec3;
  /** Its kinetic energy relative to the ship, J. */
  readonly energy: number;
}

/** How a ship looks from outside: what an instrument view needs to draw it. */
export interface ShipAppearance {
  /** kg; with the design it sets the centre of mass, the origin of the body frame. */
  readonly propellantMass: number;
  /** Ammunition gone from each section's magazines, kg; it too moves the centre of mass. */
  readonly ammunitionSpent: AmmunitionSpent;
  readonly radiatorsDeployed: boolean;
  /** The ship's temperature, which its radiators glow with, K. */
  readonly temperature: number;
  /** Drive thrust applied in the last step, N. */
  readonly thrust: number;
  /** The parts still there, in the body frame: sections not failed, mounts not wrecked. */
  readonly parts: readonly ShapePart[];
  /** Where beams landed on the ship in the last step. */
  readonly beamsLanding: readonly BeamLanding[];
  /** Where slugs and missiles struck the ship in the last step. */
  readonly impacts: readonly ImpactLanding[];
}

/** A side's own ship, which it knows in full. */
export interface OwnShipObservation {
  readonly sideId: SideId;
  readonly designName: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** The drive's acceleration over the last step, m/s². */
  readonly acceleration: Vec3;
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
  readonly shields: ShieldsObservation;
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
  /** Its acceleration over the last step, m/s². */
  readonly acceleration: Vec3;
  readonly orientation: Quat;
  /** Full detail until sensors limit what a side can make out (a later phase). */
  readonly appearance: ShipAppearance;
}

/** What every munition in flight shows. */
interface MunitionInFlight {
  /** Unique within the battle. */
  readonly id: number;
  readonly kind: MunitionKind;
  /** The side that fired it. */
  readonly attacker: SideId;
  readonly target: SideId;
  /** kg */
  readonly mass: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** A slug from a kinetic gun, flying straight. */
export interface SlugObservation extends MunitionInFlight {
  readonly kind: 'slug';
}

/** A guided missile, steering itself onto its target with its own drive. */
export interface MissileObservation extends MunitionInFlight {
  readonly kind: 'missile';
  /** Its design's name. */
  readonly name: string;
  readonly warhead: WarheadType;
  /** kg */
  readonly propellantMass: number;
  /** The delta-v its propellant still gives it, m/s. */
  readonly deltaV: number;
  /** Drive thrust applied in the last step, N. */
  readonly thrust: number;
  /** Its drive's acceleration over the last step, m/s². */
  readonly acceleration: Vec3;
}

/** A munition in flight. */
export type MunitionObservation = SlugObservation | MissileObservation;

export interface SideObservation {
  readonly time: number;
  readonly ownShip: OwnShipObservation;
  readonly contacts: readonly ContactObservation[];
  /** Every munition in flight, whichever side fired it. */
  readonly munitions: readonly MunitionObservation[];
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
  /** Slugs and missiles that struck the ship in the last step. */
  impacts: ImpactLanding[];
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
    case 'launch':
      if (!(Number.isInteger(order.missiles) && order.missiles >= 0)) {
        throw new Error('A launch order needs a whole, non-negative number of missiles');
      }
      return order;
    case 'point-defence':
      if (!POINT_DEFENCE_PRIORITIES.includes(order.priority)) {
        throw new Error(
          `A point defence order needs one of ${POINT_DEFENCE_PRIORITIES.join(', ')}`,
        );
      }
      return order;
    case 'radiators':
    case 'shields':
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
    absorbed: ship.heatFlow.absorbed,
    radiatorsDeployed: ship.radiatorsDeployed,
    radiatorArea: radiators.area,
    thermalLimit: thermalLimit(temperature),
  };
};

const observeShields = (ship: ShipState): ShieldsObservation => ({
  raised: ship.shieldsRaised,
  powered: shieldsPowered(ship),
  shields: componentSlots(ship.design).flatMap((slot, i) =>
    slot.component.type === 'magnetic-shield' || slot.component.type === 'coolant-shield'
      ? [
          {
            type: slot.component.type,
            section: slot.section,
            index: slot.index,
            integrity: ship.integrity[i] ?? 0,
          },
        ]
      : [],
  ),
  fullDeflection: fullDeflection(ship),
  coolantCapacity: {
    forward: coolantCapacity(ship, 'forward'),
    middle: coolantCapacity(ship, 'middle'),
    engine: coolantCapacity(ship, 'engine'),
  },
});

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
  const observeBeamWeapon = (state: BeamWeaponState): BeamWeaponObservation => ({
    section: slots[state.slot]?.section ?? 'forward',
    mount: slots[state.slot]?.index ?? 0,
    integrity: ship.integrity[state.slot] ?? 0,
    firing: state.beamPower > 0,
    beamPower: state.beamPower,
    fullBeamPower: state.weapon.beamPower,
    effectiveRange: effectiveRange(state.weapon),
  });
  return {
    target: weapons.target,
    mode: weapons.mode,
    lasers: weapons.beamWeapons.filter((w) => w.attack === 'laser').map(observeBeamWeapon),
    particleBeams: weapons.beamWeapons.flatMap((state) =>
      state.attack === 'laser' ? [] : [{ ...observeBeamWeapon(state), kind: state.attack }],
    ),
    launchers: weapons.launchers.map((state) => ({
      section: slots[state.slot]?.section ?? 'forward',
      mount: slots[state.slot]?.index ?? 0,
      integrity: ship.integrity[state.slot] ?? 0,
      loaded: state.reload === 0,
      reload: state.reload,
      reloadTime: state.launcher.reloadTime,
    })),
    salvo: weapons.salvo,
    kineticGuns: weapons.kineticGuns.map((state) => ({
      section: slots[state.slot]?.section ?? 'forward',
      mount: slots[state.slot]?.index ?? 0,
      integrity: ship.integrity[state.slot] ?? 0,
      firing: state.firing,
      charge: state.charge / shotEnergy(state.gun),
      shotEnergy: shotEnergy(state.gun),
      muzzleVelocity: state.gun.muzzleVelocity,
      slugMass: state.gun.slugMass,
      rateOfFire: state.gun.rateOfFire,
      effectiveRange: kineticGunRange(state.gun),
    })),
    pointDefence: weapons.pointDefence.map((state) => ({
      section: slots[state.slot]?.section ?? 'forward',
      mount: slots[state.slot]?.index ?? 0,
      integrity: ship.integrity[state.slot] ?? 0,
      engaging: state.engaging,
      charge: state.charge / burstEnergy(state.gun),
      burstEnergy: burstEnergy(state.gun),
      burstRate: state.gun.burstRate,
      roundsPerBurst: state.gun.roundsPerBurst,
      roundMass: state.gun.roundMass,
      muzzleVelocity: state.gun.muzzleVelocity,
      dispersion: state.gun.dispersion,
      effectiveRange: pointDefenceRange(state.gun),
      lastChance: state.lastChance,
    })),
    pointDefencePriority: weapons.pointDefencePriority,
    intercepts: weapons.intercepts,
    ammunition: observeAmmunition(ship),
    lastHit: weapons.lastHit,
  };
};

const observeAmmunition = (ship: ShipState): AmmunitionObservation => {
  const magazines = designComponentsOfType(ship.design, 'magazine');
  const missiles = [...new Set(magazines.flatMap((m) => (m.missile ? [m.missile] : [])))];
  return {
    slugs: slugsLeft(ship),
    slugCapacity: magazines.reduce((n, m) => n + m.slugs, 0),
    rounds: roundsLeft(ship),
    roundCapacity: magazines.reduce((n, m) => n + m.rounds, 0),
    missiles: missilesLeft(ship),
    missileCapacity: magazines.reduce((n, m) => n + m.missiles, 0),
    missileDesigns: missiles.map((missile) => ({
      name: missile.name,
      warhead: missile.warhead.type,
      mass: missile.dryMass + missile.propellantMass,
      deltaV: missileDeltaV(missile),
      reach: missileReach(missile),
    })),
  };
};

const observeMissile = (missile: Missile): MissileObservation => ({
  id: missile.id,
  kind: 'missile',
  attacker: missile.attacker,
  target: missile.target,
  mass: missileMassNow(missile),
  position: missile.position,
  velocity: missile.velocity,
  name: missile.design.name,
  warhead: missile.design.warhead.type,
  propellantMass: missile.propellantMass,
  deltaV: missileDeltaV(missile.design, missile.propellantMass),
  thrust: missile.thrust,
  acceleration: missile.acceleration,
});

const observeAppearance = ({ ship, beamsLanding, impacts }: Combatant): ShipAppearance => ({
  propellantMass: ship.propellantMass,
  ammunitionSpent: ship.ammunitionSpent,
  radiatorsDeployed: ship.radiatorsDeployed,
  temperature: temperatureOf(ship),
  thrust: ship.thrust,
  parts: intactShape(ship),
  beamsLanding,
  impacts,
});

/** A ship's shape as slugs and missiles meet it now. */
const targetOfMunitions = (ship: ShipState): Target => {
  const parts = intactShape(ship);
  return { parts, reach: shapeRadius(parts), orientation: ship.orientation };
};

export const createBattle = (setup: BattleSetup): Battle => {
  if (setup.sides.length !== setup.scenario.starts.length) {
    throw new Error('A scenario needs one start for each side');
  }
  const { timeLimit } = setup;
  if (timeLimit !== undefined && !(timeLimit > 0 && Number.isFinite(timeLimit))) {
    throw new Error('A time limit must be a positive number of seconds');
  }
  const combatants: Combatant[] = setup.sides.map((side, i) => {
    const start = setup.scenario.starts[i];
    if (!start) throw new Error(`No start for side ${side.id}`);
    return {
      side,
      ship: createShip(side.design, start.position, start.velocity, start.orientation ?? IDENTITY),
      beamsLanding: [],
      impacts: [],
    };
  });
  let steps = 0;
  const random = createRandom(setup.seed);
  /** Beams on their way to their targets, in the order fired. */
  let beams: Beam[] = [];
  /** Slugs in flight, in the order fired. */
  let slugs: Slug[] = [];
  /** Missiles in flight, in the order launched. */
  let missiles: Missile[] = [];
  /** Point defence bursts on their way to their targets, in the order fired. */
  let bursts: PointDefenceBurst[] = [];
  let munitionsFired = 0;
  const nextMunitionId = () => ++munitionsFired;
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
    if (landed && landed.power > 0) {
      const { point, power, spotRadius } = landed;
      target.beamsLanding.push({ attack: beam.attack, point, power, spotRadius });
    }
    const part = landed
      ? landed.part.mount === null
        ? landed.part.section
        : `${landed.part.section}/${String(landed.part.mount)}`
      : null;
    const emitter = attacker.weapons.beamWeapons[beam.emitter];
    if (!emitter) return;
    if (landed && part && (!beam.continuing || emitter.striking !== part)) {
      const hit: HitEvent = {
        type: 'hit',
        time: ctx.time,
        attacker: beam.attacker,
        target: beam.target,
        attack: beam.attack,
        section: landed.part.section,
        mount: landed.part.mount,
        power: landed.power,
        deflected: landed.deflected,
        absorbed: landed.absorbed,
        intensity: landed.intensity,
        spotRadius: landed.spotRadius,
        range: beam.range,
      };
      ctx.events.push(hit);
      attacker.weapons = { ...attacker.weapons, lastHit: hit };
    }
    attacker.weapons = {
      ...attacker.weapons,
      beamWeapons: attacker.weapons.beamWeapons.map((w, i) =>
        i === beam.emitter ? { ...w, striking: part } : w,
      ),
    };
  };

  /** Each ship's shape as munitions meet it, worked out once per step until it is struck. */
  const createShapes = () => {
    const shapes = new Map<SideId, Target>();
    return {
      of(c: Combatant): Target {
        const known = shapes.get(c.side.id);
        if (known) return known;
        const shape = targetOfMunitions(c.ship);
        shapes.set(c.side.id, shape);
        return shape;
      },
      struck(c: Combatant) {
        shapes.delete(c.side.id);
      },
    };
  };

  /**
   * A munition that moved from `from` to where it is now, while each ship moved from where it was
   * at `shipsBefore`: if its path crosses a ship other than the one that fired it, it strikes the
   * first such ship with its kinetic energy relative to the ship. Returns whether it struck.
   */
  const strikeDirectly = (
    munition: {
      readonly kind: MunitionKind;
      readonly attacker: SideId;
      readonly mass: number;
      readonly position: Vec3;
      readonly velocity: Vec3;
    },
    from: Vec3,
    shipsBefore: ReadonlyMap<SideId, Vec3>,
    shapes: ReturnType<typeof createShapes>,
    ctx: Omit<DamageContext, 'side'>,
  ): boolean => {
    for (const c of combatants) {
      if (c.side.id === munition.attacker) continue;
      const hit = sweepSlug(
        shapes.of(c),
        sub(from, shipsBefore.get(c.side.id) ?? c.ship.position),
        sub(munition.position, c.ship.position),
      );
      if (!hit) continue;
      const relative = sub(munition.velocity, c.ship.velocity);
      const energy = 0.5 * munition.mass * dot(relative, relative);
      impactKinetic(c.ship, hit, energy, munition.mass, { ...ctx, side: c.side.id });
      shapes.struck(c);
      c.impacts.push({ point: hit.point, energy });
      ctx.events.push({
        type: 'impact',
        time: ctx.time,
        attacker: munition.attacker,
        target: c.side.id,
        munition: munition.kind,
        section: hit.part.section,
        mount: hit.part.mount,
        energy,
        speed: length(relative),
      });
      return true;
    }
    return false;
  };

  /**
   * A missile with a nuclear warhead that moved from `from` to where it is now, while each ship
   * moved from where it was at `shipsBefore`. It goes off at the first point of its path where it
   * strikes a ship other than the one that launched it, or where its proximity fuse finds such a
   * ship within its detonation distance; its burst reaches every ship as each was at that moment
   * (see `irradiate`). Returns whether it went off.
   */
  const detonateNear = (
    missile: Missile,
    warhead: NuclearWarheadDesign,
    from: Vec3,
    shipsBefore: ReadonlyMap<SideId, Vec3>,
    shapes: ReturnType<typeof createShapes>,
    ctx: Omit<DamageContext, 'side'>,
  ): boolean => {
    /** Where a ship was part-way through the step, as a fraction of it. */
    const shipAt = (c: Combatant, along: number) => {
      const start = shipsBefore.get(c.side.id) ?? c.ship.position;
      return add(start, scale(sub(c.ship.position, start), along));
    };
    let trigger: { along: number; contact: boolean; ship: Combatant } | null = null;
    for (const c of combatants) {
      if (c.side.id === missile.attacker) continue;
      const start = sub(from, shipAt(c, 0));
      const end = sub(missile.position, c.ship.position);
      const hit = sweepSlug(shapes.of(c), start, end);
      const fuse =
        warhead.detonationDistance > 0 ? fuseTrigger(start, end, warhead.detonationDistance) : null;
      const options = [
        ...(hit ? [{ along: hit.along, contact: true }] : []),
        ...(fuse === null ? [] : [{ along: fuse, contact: false }]),
      ];
      for (const option of options) {
        if (!trigger || option.along < trigger.along) trigger = { ...option, ship: c };
      }
    }
    if (!trigger) return false;
    const { along, contact, ship: target } = trigger;
    const position = add(from, scale(sub(missile.position, from), along));
    const offset = sub(position, shipAt(target, along));
    // What the burst does to each ship follows the detonation in the events.
    const at = ctx.events.length;
    const exposures: NuclearExposure[] = combatants.flatMap((c) => {
      const taken = irradiate(c.ship, sub(position, shipAt(c, along)), warhead.yield, {
        ...ctx,
        side: c.side.id,
      });
      if (taken.length > 0) shapes.struck(c);
      return taken.map(({ part, distance, fluence, energy }) => ({
        side: c.side.id,
        section: part.section,
        mount: part.mount,
        distance,
        fluence,
        energy,
      }));
    });
    ctx.events.splice(at, 0, {
      type: 'detonation',
      time: ctx.time,
      attacker: missile.attacker,
      target: target.side.id,
      munition: missile.id,
      yield: warhead.yield,
      contact,
      position,
      offset,
      distance: length(offset),
      exposures,
    });
    return true;
  };

  /**
   * Point defence bursts meeting their targets, in the order fired. A burst at a missile still in
   * flight brings it down with the chance it was fired with, and the missile leaves the battle; a
   * burst at a ship strikes it (see `impactBurst`).
   */
  const resolveBursts = (
    arriving: readonly PointDefenceBurst[],
    ctx: Omit<DamageContext, 'side'>,
  ) => {
    for (const burst of arriving) {
      const defender = combatantOf(burst.attacker);
      const gun = defender.ship.weapons.pointDefence[burst.gun];
      const place = componentSlots(defender.ship.design)[gun?.slot ?? -1];
      const { engagement } = burst;
      if (engagement.kind === 'missile') {
        const missile = missiles.find((m) => m.id === engagement.munition);
        if (!missile || !(ctx.random() < burst.chance)) continue;
        missiles = missiles.filter((m) => m !== missile);
        defender.ship.weapons = {
          ...defender.ship.weapons,
          intercepts: defender.ship.weapons.intercepts + 1,
        };
        ctx.events.push({
          type: 'intercept',
          time: ctx.time,
          side: burst.attacker,
          attacker: missile.attacker,
          munition: missile.id,
          warhead: missile.design.warhead.type,
          weapon: 'point-defence',
          section: place?.section ?? 'forward',
          mount: place?.index ?? 0,
          position: missile.position,
          distance: distance(missile.position, defender.ship.position),
          chance: burst.chance,
        });
        continue;
      }
      const target = combatants.find((c) => c.side.id === engagement.side);
      if (!target) continue;
      const { rounds, roundMass, speed, spread } = burst;
      const landed = impactBurst(
        target.ship,
        burst.direction,
        { rounds, roundMass, roundEnergy: 0.5 * roundMass * speed ** 2, spread },
        { ...ctx, side: target.side.id },
      );
      if (!landed) continue;
      target.impacts.push({ point: landed.point, energy: landed.energy });
      ctx.events.push({
        type: 'impact',
        time: ctx.time,
        attacker: burst.attacker,
        target: target.side.id,
        munition: 'point-defence',
        section: landed.part.section,
        mount: landed.part.mount,
        energy: landed.energy,
        speed,
      });
    }
  };

  /** Whether a munition has passed its target for good, so it can be forgotten. */
  const passedTarget = (
    munition: { readonly target: SideId; readonly position: Vec3; readonly velocity: Vec3 },
    shapes: ReturnType<typeof createShapes>,
  ): boolean => {
    const target = combatants.find((c) => c.side.id === munition.target);
    if (!target) return true;
    return slugPassed(
      {
        position: sub(munition.position, target.ship.position),
        velocity: sub(munition.velocity, target.ship.velocity),
      },
      shapes.of(target).reach,
    );
  };

  /**
   * Slugs and missiles moving from `before` to their positions now: each strikes the first ship
   * its path crosses (see `strikeDirectly`), except that a missile with a nuclear warhead goes off
   * near it (see `detonateNear`). A munition that strikes or goes off leaves the battle. A slug
   * that has passed its target for good flies on out of the battle; so does a missile that has,
   * once it has no propellant left to turn back.
   */
  const resolveMunitions = (
    before: ReadonlyMap<number, Vec3>,
    shipsBefore: ReadonlyMap<SideId, Vec3>,
    ctx: Omit<DamageContext, 'side'>,
  ) => {
    const shapes = createShapes();
    slugs = slugs.filter((slug) => {
      const from = before.get(slug.id) ?? slug.position;
      if (strikeDirectly({ ...slug, kind: 'slug' }, from, shipsBefore, shapes, ctx)) return false;
      return !passedTarget(slug, shapes);
    });
    missiles = missiles.filter((missile) => {
      const from = before.get(missile.id) ?? missile.position;
      const { warhead } = missile.design;
      switch (warhead.type) {
        case 'kinetic': {
          const munition = { ...missile, kind: 'missile' as const, mass: missileMassNow(missile) };
          if (strikeDirectly(munition, from, shipsBefore, shapes, ctx)) return false;
          break;
        }
        case 'nuclear':
          if (detonateNear(missile, warhead, from, shipsBefore, shapes, ctx)) return false;
          break;
      }
      return !(missile.propellantMass <= 0 && passedTarget(missile, shapes));
    });
  };

  const step = (): readonly BattleEvent[] => {
    if (outcome) return [];
    const start = steps * TIME_STEP;
    // Fire control sees every ship as it was at the start of the step, so the order of sides
    // never matters.
    const motions = new Map<SideId, Motion>(
      combatants.map(({ side, ship }) => [
        side.id,
        { position: ship.position, velocity: ship.velocity, acceleration: ship.acceleration },
      ]),
    );
    // Point defence sees enemy missiles and its target as they were at the start of the step.
    const pointDefenceTargets = new Map<SideId, PointDefenceTargets>(
      combatants.map((c) => {
        const target = targetOf(c);
        const motion = target && motions.get(target.side.id);
        const threats = missiles.flatMap((m): Threat[] =>
          m.attacker === c.side.id
            ? []
            : [
                {
                  id: m.id,
                  design: m.design,
                  motion: {
                    position: m.position,
                    velocity: m.velocity,
                    acceleration: m.acceleration,
                  },
                },
              ],
        );
        return [
          c.side.id,
          { threats, ship: target && motion ? { id: target.side.id, motion } : null },
        ];
      }),
    );
    // Weapons choose whether to fire first, so the drive knows what power they will ask for.
    combatants.forEach((c) => {
      const target = targetOf(c);
      aimWeapons(
        c.ship,
        target ? distance(c.ship.position, target.ship.position) : null,
        pointDefenceTargets.get(c.side.id),
      );
    });
    // Every ship plans from the same snapshot of positions, so the order of sides never matters.
    const launches: BattleEvent[] = [];
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
      const coasting = ship.velocity;
      if (command && ship.manoeuvre) {
        ship.manoeuvre = { ...ship.manoeuvre, correcting: command.correcting };
        fireDrive(ship, manoeuvreThrottle(ship, command, TIME_STEP), TIME_STEP);
      } else {
        burn(ship, TIME_STEP);
      }
      ship.acceleration = scale(sub(ship.velocity, coasting), 1 / TIME_STEP);
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
      const motion = target && motions.get(target.side.id);
      slugs.push(
        ...fireKineticGuns(
          ship,
          combatant.side.id,
          target && motion ? { id: target.side.id, motion } : null,
          TIME_STEP,
          nextMunitionId,
        ),
      );
      const defending = pointDefenceTargets.get(combatant.side.id);
      if (defending) {
        bursts.push(...firePointDefence(ship, combatant.side.id, defending, start, TIME_STEP));
      }
      const salvoTarget = ship.weapons.salvo?.target;
      const launched = launchMissiles(
        ship,
        combatant.side.id,
        combatants.some((c) => c.side.id === salvoTarget) ? (salvoTarget ?? null) : null,
        TIME_STEP,
        nextMunitionId,
      );
      for (const { missile, launcher } of launched) {
        missiles.push(missile);
        const slot = componentSlots(ship.design)[ship.weapons.launchers[launcher]?.slot ?? -1];
        launches.push({
          type: 'launch',
          time: start,
          attacker: combatant.side.id,
          target: missile.target,
          munition: missile.id,
          section: slot?.section ?? 'forward',
          mount: slot?.index ?? 0,
        });
      }
    });
    // Missiles steer by what their guidance sees of their targets at the start of the step.
    missiles = missiles.map((missile) =>
      guideMissile(missile, motions.get(missile.target) ?? null, TIME_STEP),
    );
    // Ships and munitions move after all have fired, so every beam, slug and missile leaves from
    // the same snapshot.
    const shipsBefore = new Map(combatants.map(({ side, ship }) => [side.id, ship.position]));
    const munitionsBefore = new Map(
      [...slugs, ...missiles].map((munition) => [munition.id, munition.position]),
    );
    combatants.forEach(({ ship }) => {
      ship.position = add(ship.position, scale(ship.velocity, TIME_STEP));
    });
    slugs = slugs.map((slug) => ({
      ...slug,
      position: add(slug.position, scale(slug.velocity, TIME_STEP)),
    }));
    missiles = missiles.map((missile) => ({
      ...missile,
      position: add(missile.position, scale(missile.velocity, TIME_STEP)),
    }));
    steps += 1;

    // Beams that reach their targets by the end of the step strike them, in the order fired.
    const time = steps * TIME_STEP;
    const events: BattleEvent[] = [...launches];
    const arriving = beams.filter((b) => b.arrival <= time + 1e-9);
    beams = beams.filter((b) => b.arrival > time + 1e-9);
    combatants.forEach((c) => {
      if (c.beamsLanding.length > 0) c.beamsLanding = [];
      if (c.impacts.length > 0) c.impacts = [];
    });
    for (const beam of arriving) resolveBeam(beam, { time, random, events });
    resolveBursts(
      bursts.filter((b) => b.arrival <= time + 1e-9),
      { time, random, events },
    );
    bursts = bursts.filter((b) => b.arrival > time + 1e-9);
    resolveMunitions(munitionsBefore, shipsBefore, { time, random, events });
    combatants.forEach(({ side, ship }) => {
      overheat(ship, TIME_STEP, { side: side.id, time, random, events });
    });
    // Ships that lost in this step lose together; if all of them did, nobody wins.
    outcome = judge(
      time,
      combatants.map(({ side, ship }) => ({ side: side.id, loss: lossOf(ship) })),
    );
    // A side that loses in the step that reaches the time limit still loses.
    if (!outcome && timeLimit !== undefined && time >= timeLimit - 1e-9) {
      outcome = noResult(time, setup.sides);
    }
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
        case 'shields':
          ship.shieldsRaised = checked.raised;
          break;
        case 'weapons':
          if (checked.target !== null && combatantOf(checked.target).side.id === sideId) {
            throw new Error('A ship cannot target itself');
          }
          ship.weapons = { ...ship.weapons, target: checked.target, mode: checked.mode };
          break;
        case 'point-defence':
          ship.weapons = { ...ship.weapons, pointDefencePriority: checked.priority };
          break;
        case 'launch':
          if (combatantOf(checked.target).side.id === sideId) {
            throw new Error('A ship cannot launch at itself');
          }
          ship.weapons = {
            ...ship.weapons,
            salvo:
              checked.missiles > 0 ? { target: checked.target, remaining: checked.missiles } : null,
          };
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
          acceleration: ship.acceleration,
          orientation: ship.orientation,
          nose: noseOf(ship),
          angularVelocity: rotate(ship.orientation, ship.angularVelocity),
          mass: shipMassProperties(ship).mass,
          propellantMass: ship.propellantMass,
          deltaV: deltaVOf(ship),
          thrust: ship.thrust,
          torque: ship.torque,
          attitude: ship.attitude,
          burn: ship.burn,
          manoeuvre: ship.manoeuvre ? observeManoeuvre(ship, ship.manoeuvre, contactOf(own)) : null,
          power: observePower(ship),
          heat: observeHeat(ship),
          shields: observeShields(ship),
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
            acceleration: c.ship.acceleration,
            orientation: c.ship.orientation,
            appearance: observeAppearance(c),
          })),
        munitions: [
          ...slugs.map((slug): SlugObservation => ({ kind: 'slug', ...slug })),
          ...missiles.map(observeMissile),
        ],
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
