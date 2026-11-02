import type { SideId } from './battle';
import type { ComponentType, SectionKind } from './design';
import type { BattleOutcome } from './outcome';

/** A laser's beam started landing on a part of the target: a section, or one of its mounts. */
export interface HitEvent {
  readonly type: 'hit';
  /** s */
  readonly time: number;
  readonly attacker: SideId;
  readonly target: SideId;
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

/** A section's armour has been burnt through; beams now reach its structure and components. */
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
  HitEvent | ArmourBreachedEvent | ComponentLostEvent | StructuralFailureEvent | BattleEndedEvent;

/** Whether an event concerns a side: its own ship, a hit it scored, or the end of the battle. */
export const involves = (event: BattleEvent, side: SideId): boolean => {
  switch (event.type) {
    case 'hit':
      return event.attacker === side || event.target === side;
    case 'battle-ended':
      return true;
    default:
      return event.side === side;
  }
};
