import type { SideId } from './battle';
import type { ComponentType, SectionKind } from './design';
import type { BattleOutcome } from './outcome';
import type { Vec3 } from './vector';

/** What kind of particle beam: charged particles, or neutral atoms. */
export type ParticleBeamKind = 'charged-particle' | 'neutral-particle';
/** What kind of beam: a laser's light, or a particle beam. */
export type BeamKind = 'laser' | ParticleBeamKind;
/** What kind of munition is in flight: a slug from a kinetic gun, or a missile. */
export type MunitionKind = 'slug' | 'missile';
/**
 * Every kind of attack a ship can suffer. Each kind of shield and armour counters some kinds
 * better than others.
 */
export type AttackKind = BeamKind | MunitionKind;

/**
 * A beam weapon's beam started landing on a part of the target: a section, or one of its
 * mounts.
 */
export interface HitEvent {
  readonly type: 'hit';
  /** s */
  readonly time: number;
  readonly attacker: SideId;
  readonly target: SideId;
  /** What kind of beam it was. */
  readonly attack: BeamKind;
  readonly section: SectionKind;
  /** The mount struck on that section, or null for the section itself. */
  readonly mount: number | null;
  /** Beam power landing on the part, W. */
  readonly power: number;
  /** Beam intensity at the target, W/m². */
  readonly intensity: number;
  /** Radius of the beam's spot at the target, m. */
  readonly spotRadius: number;
  /** Distance the beam travelled, m. */
  readonly range: number;
}

/**
 * A munition struck a part of a ship directly: a slug, or a missile with a kinetic warhead. It
 * struck a section, or one of its mounts.
 */
export interface ImpactEvent {
  readonly type: 'impact';
  readonly time: number;
  readonly attacker: SideId;
  readonly target: SideId;
  readonly munition: MunitionKind;
  readonly section: SectionKind;
  /** The mount struck on that section, or null for the section itself. */
  readonly mount: number | null;
  /** The munition's kinetic energy relative to the target, J. */
  readonly energy: number;
  /** The munition's speed relative to the target, m/s. */
  readonly speed: number;
}

/** A launcher launched a missile at a target. */
export interface LaunchEvent {
  readonly type: 'launch';
  readonly time: number;
  readonly attacker: SideId;
  readonly target: SideId;
  /** The missile's id among the munitions in flight. */
  readonly munition: number;
  /** Where the launcher is: its section, and its place in the section's mounts. */
  readonly section: SectionKind;
  readonly mount: number;
}

/** What a nuclear burst delivered to one part of a ship that faced it. */
export interface NuclearExposure {
  readonly side: SideId;
  readonly section: SectionKind;
  /** The mount on that section, or null for the section itself. */
  readonly mount: number | null;
  /** From the burst to the middle of the part, m. */
  readonly distance: number;
  /** Radiation and heat arriving per area at the part, J/m². */
  readonly fluence: number;
  /** What the part took: the fluence over its silhouette seen from the burst, J. */
  readonly energy: number;
}

/**
 * A missile's nuclear warhead went off, by its proximity fuse or on striking a ship. Its radiation
 * and heat reached every part of every ship that faced the burst and was not shadowed by a
 * section, falling with the square of distance; parts it barely reached are left out.
 */
export interface DetonationEvent {
  readonly type: 'detonation';
  readonly time: number;
  readonly attacker: SideId;
  /** The ship that set it off: its target, or another enemy ship in its path. */
  readonly target: SideId;
  /** The missile's id among the munitions in flight. */
  readonly munition: number;
  /** J */
  readonly yield: number;
  /** Whether it went off on striking the target rather than by its proximity fuse. */
  readonly contact: boolean;
  /** Where it went off, in the world, m. */
  readonly position: Vec3;
  /** Where it went off relative to the target's centre of mass, in world axes, m. */
  readonly offset: Vec3;
  /** From the burst to the target's centre of mass, m. */
  readonly distance: number;
  readonly exposures: readonly NuclearExposure[];
}

/**
 * A magazine holding nuclear missiles was lost, and the fire and blast set off some of their
 * warheads, each releasing a fraction of its yield inside the section.
 */
export interface MagazineExplosionEvent {
  readonly type: 'magazine-explosion';
  readonly time: number;
  readonly side: SideId;
  readonly section: SectionKind;
  /** The magazine's place in the section's components. */
  readonly index: number;
  /** How many warheads went off. */
  readonly warheads: number;
  /** Energy they released together, J. */
  readonly energy: number;
}

/** A section's armour has been broken through; hits now reach its structure and components. */
export interface ArmourBreachedEvent {
  readonly type: 'armour-breached';
  readonly time: number;
  readonly side: SideId;
  readonly section: SectionKind;
}

/** A component's integrity reached zero; it no longer works. */
export interface ComponentLostEvent {
  readonly type: 'component-lost';
  readonly time: number;
  readonly side: SideId;
  readonly section: SectionKind;
  /** Whether it was on a mount rather than inside the section. */
  readonly mounted: boolean;
  /** Its place in the section's components or mounts list. */
  readonly index: number;
  readonly component: ComponentType;
}

/** A section's own structure was broken through: it and everything in it are lost. */
export interface StructuralFailureEvent {
  readonly type: 'structural-failure';
  readonly time: number;
  readonly side: SideId;
  readonly section: SectionKind;
}

/** The battle is over; nothing changes after this. */
export interface BattleEndedEvent {
  readonly type: 'battle-ended';
  readonly time: number;
  readonly outcome: BattleOutcome;
}

/** Something significant that happened in a battle. */
export type BattleEvent =
  | HitEvent
  | ImpactEvent
  | LaunchEvent
  | DetonationEvent
  | MagazineExplosionEvent
  | ArmourBreachedEvent
  | ComponentLostEvent
  | StructuralFailureEvent
  | BattleEndedEvent;

/** Whether an event concerns a side: its own ship, a hit it scored, or the end of the battle. */
export const involves = (event: BattleEvent, side: SideId): boolean => {
  switch (event.type) {
    case 'hit':
    case 'impact':
    case 'launch':
    case 'detonation':
      return event.attacker === side || event.target === side;
    case 'battle-ended':
      return true;
    default:
      return event.side === side;
  }
};
