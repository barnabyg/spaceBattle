import type { SideId, SideSetup } from './battle';
import { effectiveRange, LASER_BURST_POWER } from './beams';
import { laserChargeFraction } from './weapons';
import { componentSlots } from './components';
import { intactShape } from './damage';
import {
  designComponentsOfType,
  missileRole,
  type ArmourDesign,
  type ArmourType,
  type ComponentType,
  type HullSize,
  type MountedComponentDesign,
  type MissileRole,
  type SectionKind,
  type ShieldType,
  type WarheadType,
} from './design';
import type { BattleEvent, BeamKind, HitEvent, MunitionKind, ParticleBeamKind } from './events';
import { thermalLimit, thermalProperties, workingRadiators } from './heat';
import { kineticGunRange, shotEnergy, type Motion, type Slug } from './kinetic';
import { observeWeaponReadiness, type WeaponReadiness } from './weaponReadiness';
import { observeManoeuvre, type ContactMotion, type ManoeuvreObservation } from './manoeuvre';
import {
  missileDeltaV,
  missileMassNow,
  missileReach,
  targetsMissile,
  type Missile,
  type MissileTarget,
} from './missile';
import type { AimPoint, AttitudeOrder, FireMode, PointDefencePriority } from './orders';
import type { BattleOutcome } from './outcome';
import { burstEnergy, pointDefenceRange, type PointDefenceEngagement } from './pointDefence';
import { powerPlantOf, type EnergyLedger, type PowerShare, type PowerSystem } from './power';
import { rotate, type Quat } from './quaternion';
import type { ShapePart } from './shape';
import type { IntelligenceReport } from './intelligence';
import { perceive, sensorPower, type ContactDetail } from './sensors';
import { coolantCapacity, fullDeflection, shieldsPowered } from './shields';
import {
  conditionOf,
  deltaVOf,
  driveLimit,
  reserveWarning,
  noseOf,
  shipMassProperties,
  temperatureOf,
  type AmmunitionSpent,
  type BurnState,
  type ShipCondition,
  type ShipState,
} from './ship';
import { distance, type Vec3 } from './vector';
import {
  designMissiles,
  missilesLeft,
  roundsLeft,
  slugsLeft,
  type BeamWeaponState,
  type Salvo,
} from './weapons';

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
export interface LaserObservation extends BeamWeaponObservation {
  /** Fraction of the local buffer charged (0–1). */
  readonly charge: number;
  /** Electrical energy in the local buffer, J, separate from ship capacitors. */
  readonly storedEnergy: number;
}

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

/** One missile design the ship carries, how many are left and how far it reaches. */
export interface MissileDesignObservation {
  readonly name: string;
  readonly warhead: WarheadType;
  /** Anti-ship, or anti-missile for a fragmentation warhead. */
  readonly role: MissileRole;
  /** Missiles of this design left in working magazines. */
  readonly missiles: number;
  /** Missiles of this design the magazines hold when full. */
  readonly capacity: number;
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
  /** Missiles of every design left in working magazines, anti-missile missiles included. */
  readonly missiles: number;
  /** Missiles of every design the magazines hold when full. */
  readonly missileCapacity: number;
  /** The missiles the magazines hold, one entry per design. */
  readonly missileDesigns: readonly MissileDesignObservation[];
}

/** One of the ship's anti-missile missiles in flight and the enemy missile it is after. */
export interface AntiMissileEngagement {
  /** The anti-missile missile's id among the munitions. */
  readonly antiMissile: number;
  /** The enemy missile's id. */
  readonly target: number;
}

/** The ship's missile defence by anti-missile missiles. */
export interface AntiMissileObservation {
  /**
   * Whether automatic defence is on: an anti-missile missile at each incoming missile none is
   * already after, as launchers come free (see `AntiMissileOrder`).
   */
  readonly automatic: boolean;
  /** Its anti-missile missiles in flight, each with its target. */
  readonly engagements: readonly AntiMissileEngagement[];
}

/**
 * The ship's weapons: the captain's weapons, launch, missile defence and point defence orders,
 * each weapon, the latest beam hit scored and the missiles shot down.
 */
export interface WeaponsObservation {
  /** Separation to the selected weapons target in metres, or null without one. */
  readonly targetRange: number | null;
  readonly readiness: readonly WeaponReadiness[];
  readonly target: SideId | null;
  readonly mode: FireMode;
  /** The part of the target the weapons are ordered to aim at; null for the whole ship. */
  readonly aim: AimPoint | null;
  readonly lasers: readonly LaserObservation[];
  /** Charged and neutral particle beams. */
  readonly particleBeams: readonly ParticleBeamObservation[];
  readonly kineticGuns: readonly KineticGunObservation[];
  readonly pointDefence: readonly PointDefenceObservation[];
  /** What the point defence fires on. */
  readonly pointDefencePriority: PointDefencePriority;
  /** Enemy missiles the ship has shot down, by point defence and anti-missile missiles. */
  readonly intercepts: number;
  readonly launchers: readonly LauncherObservation[];
  /** Missiles still to launch under the latest launch order, or null when none are. */
  readonly salvo: Salvo | null;
  readonly antiMissile: AntiMissileObservation;
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
  /** The delta-v its design holds back for withdrawal, m/s. */
  readonly reserve: number;
  /** Whether the delta-v left is coming down towards the reserve (see `reserveWarning`). */
  readonly reserveWarning: boolean;
  /** Whether it is withdrawing from the battle. */
  readonly withdrawing: boolean;
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
  /** What the ship would carry into another battle: its damage, propellant and ammunition. */
  readonly condition: ShipCondition;
}

/** How a contact looks from outside, as far as the side's sensors make it out. */
export interface ContactAppearance {
  /** Drive thrust applied in the last step, N; its exhaust shows at any range. */
  readonly thrust: number;
  /** The temperature it glows at, K; its heat shows at any range. */
  readonly temperature: number;
  readonly radiatorsDeployed: boolean;
  /**
   * The intact parts' boxes in the body frame once its silhouette is made out (see `perceive`);
   * none before. They show its shape, not which part is which.
   */
  readonly outline: readonly ShapePart[];
  /** The intact sections and mounts made out, in the body frame. */
  readonly parts: readonly ShapePart[];
  /** Where beams landed on it in the last step. */
  readonly beamsLanding: readonly BeamLanding[];
  /** Where slugs and missiles struck it in the last step. */
  readonly impacts: readonly ImpactLanding[];
}

/** A section of a contact the side's sensors make out. */
export interface ContactSectionObservation {
  readonly kind: SectionKind;
  /** Its armour as built: its type and thickness show at its edges and surface. */
  readonly armour: ArmourDesign;
}

/** A mount of a contact the side's sensors make out. */
export interface ContactMountObservation {
  readonly section: SectionKind;
  /** Its place in the section's mounts. */
  readonly mount: number;
  /** What it is, recognised by its size and shape. */
  readonly component: MountedComponentDesign;
  /** Whether it fired in the last step: a beam weapon's glare or a gun's flash. */
  readonly firing: boolean;
}

/**
 * An enemy ship as a side perceives it. Its position and motion are always known; the rest only
 * as far as the side's sensors make it out at its range (see `perceive`): its silhouette, then its
 * sections and their armour, then its mounts. A side can aim at a section or mount only once it is
 * made out.
 */
export interface ContactObservation {
  readonly sideId: SideId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Its acceleration over the last step, m/s². */
  readonly acceleration: Vec3;
  /** Whether it is withdrawing, so it may be fired on but not pursued. */
  readonly withdrawing: boolean;
  /** The finest detail the side's sensors make out at its range, m; infinite when blind. */
  readonly resolution: number;
  readonly detail: ContactDetail;
  /** Known once its silhouette is made out; null before. */
  readonly orientation: Quat | null;
  /** Known once its silhouette is made out; null before. */
  readonly hullSize: HullSize | null;
  /** The sections made out, from nose to tail. */
  readonly sections: readonly ContactSectionObservation[];
  /** The mounts made out, section by section. */
  readonly mounts: readonly ContactMountObservation[];
  readonly appearance: ContactAppearance;
}

/** What every munition in flight shows. */
interface MunitionInFlight {
  /** Unique within the battle. */
  readonly id: number;
  readonly kind: MunitionKind;
  /** The side that fired it. */
  readonly attacker: SideId;
  /** kg */
  readonly mass: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** A slug from a kinetic gun, flying straight. */
export interface SlugObservation extends MunitionInFlight {
  readonly kind: 'slug';
  readonly target: SideId;
}

/** A guided missile, steering itself onto its target with its own drive. */
export interface MissileObservation extends MunitionInFlight {
  readonly kind: 'missile';
  /** An enemy ship, or for an anti-missile missile, the enemy missile it is after. */
  readonly target: MissileTarget;
  /** Its design's name. */
  readonly name: string;
  readonly warhead: WarheadType;
  /** Anti-ship, or anti-missile for a fragmentation warhead. */
  readonly role: MissileRole;
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
  /** What the side learned about each enemy before the battle from its intelligence components. */
  readonly intelligence: readonly IntelligenceReport[];
}

/** A ship in the battle as observations see it: its state and what landed on it last step. */
export interface ObservedShip {
  readonly side: SideSetup;
  readonly ship: ShipState;
  /** Beams that landed on the ship in the last step. */
  readonly beamsLanding: readonly BeamLanding[];
  /** Slugs and missiles that struck the ship in the last step. */
  readonly impacts: readonly ImpactLanding[];
}

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

const observeWeapons = (
  ship: ShipState,
  engagements: readonly AntiMissileEngagement[],
  target: Motion | null,
): WeaponsObservation => {
  const slots = componentSlots(ship.design);
  const { weapons } = ship;
  const observeBeamWeapon = (state: BeamWeaponState): BeamWeaponObservation => ({
    section: slots[state.slot]?.section ?? 'forward',
    mount: slots[state.slot]?.index ?? 0,
    integrity: ship.integrity[state.slot] ?? 0,
    firing: state.beamPower > 0,
    beamPower: state.beamPower,
    fullBeamPower: state.weapon.beamPower * (state.weapon.type === 'laser' ? LASER_BURST_POWER : 1),
    effectiveRange: effectiveRange(state.weapon),
  });
  return {
    targetRange: target ? distance(ship.position, target.position) : null,
    readiness: observeWeaponReadiness(ship, target),
    target: weapons.target,
    mode: weapons.mode,
    aim: weapons.aim,
    lasers: weapons.beamWeapons
      .filter((w) => w.attack === 'laser')
      .map((state) => ({
        ...observeBeamWeapon(state),
        charge: laserChargeFraction(ship, state),
        storedEnergy: state.charge,
      })),
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
    antiMissile: { automatic: weapons.automaticDefence, engagements },
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
  // One entry per design; a design's name stands for it (see `parseDesign`).
  const missiles = designMissiles(ship.design).filter(
    (missile, i, all) => all.findIndex((m) => m.name === missile.name) === i,
  );
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
      role: missileRole(missile),
      missiles: missilesLeft(ship, missile.name),
      capacity: magazines.reduce(
        (n, m) => (m.missile?.name === missile.name ? n + m.missiles : n),
        0,
      ),
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
  role: missileRole(missile.design),
  propellantMass: missile.propellantMass,
  deltaV: missileDeltaV(missile.design, missile.propellantMass),
  thrust: missile.thrust,
  acceleration: missile.acceleration,
});

const observeAppearance = ({ ship, beamsLanding, impacts }: ObservedShip): ShipAppearance => ({
  propellantMass: ship.propellantMass,
  ammunitionSpent: ship.ammunitionSpent,
  radiatorsDeployed: ship.radiatorsDeployed,
  temperature: temperatureOf(ship),
  thrust: ship.thrust,
  parts: intactShape(ship),
  beamsLanding,
  impacts,
});

/** A side's anti-missile missiles in flight, each with the enemy missile it is after. */
export const antiMissileEngagements = (
  sideId: SideId,
  missiles: readonly Missile[],
): AntiMissileEngagement[] =>
  missiles.flatMap(({ id, attacker, target }) =>
    attacker === sideId && targetsMissile(target)
      ? [{ antiMissile: id, target: target.munition }]
      : [],
  );

/**
 * A side's own ship in full. `contact` is what its autopilot knows of the enemy, and
 * `engagements` its anti-missile missiles in flight (see `antiMissileEngagements`). `target` is
 * the observed motion of its selected weapons target; range information reveals no enemy design.
 */
export const observeOwnShip = (
  own: ObservedShip,
  contact: ContactMotion | null,
  engagements: readonly AntiMissileEngagement[],
  target: Motion | null,
): OwnShipObservation => {
  const { ship } = own;
  return {
    sideId: own.side.id,
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
    reserve: ship.design.reserve,
    reserveWarning: reserveWarning(ship),
    withdrawing: ship.withdrawingSince !== null,
    thrust: ship.thrust,
    torque: ship.torque,
    attitude: ship.attitude,
    burn: ship.burn,
    manoeuvre: ship.manoeuvre ? observeManoeuvre(ship, ship.manoeuvre, contact) : null,
    power: observePower(ship),
    heat: observeHeat(ship),
    shields: observeShields(ship),
    energyLedger: ship.ledger,
    sections: observeSections(ship),
    weapons: observeWeapons(ship, engagements, target),
    appearance: observeAppearance(own),
    condition: conditionOf(ship),
  };
};

/** Whether a mounted weapon fired in the last step, by its slot in the design. */
const firedFrom = (ship: ShipState, slot: number): boolean => {
  const { weapons } = ship;
  return (
    weapons.beamWeapons.some((w) => w.slot === slot && w.beamPower > 0) ||
    weapons.kineticGuns.some((g) => g.slot === slot && g.firing) ||
    weapons.pointDefence.some((g) => g.slot === slot && g.engaging !== null)
  );
};

/** An enemy ship as the side whose ship is `viewer` perceives it with its sensors. */
export const observeContact = (viewer: ShipState, contact: ObservedShip): ContactObservation => {
  const { ship } = contact;
  const seen = perceive(sensorPower(viewer), ship, distance(viewer.position, ship.position));
  const silhouette = seen.detail !== 'position';
  const slots = componentSlots(ship.design);
  return {
    sideId: contact.side.id,
    position: ship.position,
    velocity: ship.velocity,
    acceleration: ship.acceleration,
    withdrawing: ship.withdrawingSince !== null,
    resolution: seen.resolution,
    detail: seen.detail,
    orientation: silhouette ? ship.orientation : null,
    hullSize: silhouette ? ship.design.hullSize : null,
    sections: ship.design.sections.flatMap((section) =>
      seen.parts.some((p) => p.mount === null && p.section === section.kind)
        ? [{ kind: section.kind, armour: section.armour }]
        : [],
    ),
    mounts: seen.parts.flatMap((part) => {
      if (part.mount === null) return [];
      const slot = slots.findIndex(
        (s) => s.mounted && s.section === part.section && s.index === part.mount,
      );
      const component = slots[slot]?.component;
      if (!component || component.type === 'magazine') return [];
      return [
        {
          section: part.section,
          mount: part.mount,
          component: component as MountedComponentDesign,
          firing: firedFrom(ship, slot),
        },
      ];
    }),
    appearance: {
      thrust: ship.thrust,
      temperature: temperatureOf(ship),
      radiatorsDeployed: ship.radiatorsDeployed,
      outline: seen.outline,
      parts: seen.parts,
      beamsLanding: contact.beamsLanding,
      impacts: contact.impacts,
    },
  };
};

/** Every munition in flight: slugs, then missiles, each in the order fired. */
export const observeMunitions = (
  slugs: readonly Slug[],
  missiles: readonly Missile[],
): MunitionObservation[] => [
  ...slugs.map((slug): SlugObservation => ({ kind: 'slug', ...slug })),
  ...missiles.map(observeMissile),
];
