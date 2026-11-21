import type { SideId } from './battle';
import type { SectionKind } from './design';
import type { MissileTarget } from './missile';
import type { PowerSystem } from './power';
import type { Vec3 } from './vector';

/** Turn the ship so its nose points at the enemy, away from it, or along a world direction. */
export type AttitudeOrder =
  | { readonly type: 'attitude'; readonly mode: 'enemy' }
  | { readonly type: 'attitude'; readonly mode: 'away' }
  | { readonly type: 'attitude'; readonly mode: 'direction'; readonly direction: Vec3 };

/** Fire the drive along the nose at a throttle (0–1) for a duration (s); throttle 0 cuts it. */
export interface BurnOrder {
  readonly type: 'burn';
  readonly throttle: number;
  readonly duration: number;
}

/** What a manoeuvre order has the autopilot work towards. */
export type ManoeuvreGoal = 'close' | 'hold' | 'open' | 'match-velocity';

/**
 * A standing order: the autopilot plans turns and burns towards a goal relative to the enemy
 * until another manoeuvre, an attitude or burn order, or the goal 'none' replaces it. Close,
 * hold and open work towards a separation (`range`, m), building up to a cruising speed on the
 * way (`speed`, m/s; left out, a tenth of the delta-v left) and never faster than the ship can
 * still stop from on arrival; match velocity works towards zero relative velocity.
 */
export type ManoeuvreOrder =
  | {
      readonly type: 'manoeuvre';
      readonly goal: 'close' | 'hold' | 'open';
      readonly range: number;
      readonly speed?: number;
    }
  | { readonly type: 'manoeuvre'; readonly goal: 'match-velocity' }
  | { readonly type: 'manoeuvre'; readonly goal: 'none' };

/**
 * Rank the power systems, highest priority first; every one of them must appear once. When
 * demand exceeds supply the lowest are starved first. 'capacitors' is the priority of charging
 * them, and only systems ranked above it may draw on stored energy.
 */
export interface PowerOrder {
  readonly type: 'power';
  readonly priorities: readonly PowerSystem[];
}

/**
 * Deploy the radiators to shed more heat, at the cost of exposing them, or retract them. The
 * deployment takes five simulated seconds, with folded cooling and exposure until complete.
 * Retraction is immediate and cancels deployment. Repeating deploy does not restart it.
 */
export interface RadiatorsOrder {
  readonly type: 'radiators';
  readonly deployed: boolean;
}

/** A component of the ship: in a section, inside it or on one of its mounts, by its place there. */
export interface ComponentAddress {
  readonly section: SectionKind;
  readonly mounted: boolean;
  readonly index: number;
}

/**
 * Set the crew to repair one damaged component, or stop (null): damage control. They restore its
 * integrity at `REPAIR_RATE` a second up to `REPAIR_CAP` (a field repair, not a full one), one
 * component at a time, and stop work while its section is under fire (see `REPAIR_PAUSE`). A
 * wrecked component cannot be repaired; nor can one already as sound as the cap.
 */
export interface RepairOrder {
  readonly type: 'repair';
  readonly target: ComponentAddress | null;
}

/**
 * Roll the ship slowly about its long axis, or stop. Rolling sweeps an enemy beam around a
 * section's armour, so each patch is lit for only part of each turn (see `rollShare`); it keeps
 * the nose, the drive and any manoeuvre as they are. The ship's own beam weapons, on mounts that
 * face the target for only part of each turn, fire at `ROLL_FIRING_SHARE` of their power while it
 * rolls. Refused while the thrusters are wrecked.
 */
export interface RollOrder {
  readonly type: 'roll';
  readonly rolling: boolean;
}

/**
 * Raise the shields, so they draw power under the 'shields' priority and work as far as they get
 * it, or lower them, so they draw nothing and do nothing. Every ship starts with them raised.
 */
export interface ShieldsOrder {
  readonly type: 'shields';
  readonly raised: boolean;
}

/** Fire at the target whenever the weapons can, or hold fire. */
export type FireMode = 'fire-freely' | 'hold-fire';

/** A part of the target to aim at: one of its sections, or a mount on that section. */
export interface AimPoint {
  readonly section: SectionKind;
  /** The mount's place in the section's mounts, or null for the section itself. */
  readonly mount: number | null;
}

/**
 * Choose the contact the weapons aim at (a side, or null for none) and whether they fire at it.
 * Firing freely, each laser charges and fires finite bursts while the target is within its
 * effective range, drawing power under the 'weapons' priority. Holding fire interrupts a burst
 * and retains the bounded charge. Every ship starts with no target, holding fire and empty
 * laser buffers. Particle beams fire continuously.
 *
 * The weapons aim at the whole ship, its centre of mass, unless `aim` names a part of it: a
 * section once the sensors make it out, then a mount (see `ContactObservation`). Aiming at a part
 * not made out is refused; if a part aimed at drops out of view again, the weapons aim at the
 * whole ship until it is made out once more.
 */
export interface WeaponsOrder {
  readonly type: 'weapons';
  readonly target: SideId | null;
  readonly mode: FireMode;
  readonly aim?: AimPoint;
  /**
   * Whether the kinetic guns fire out to their full range, where a target that moves could dodge
   * their slugs; otherwise they fire only at a target their slugs reach within `DODGE_TIME`.
   * Left out, the ship keeps its present choice.
   */
  readonly longRangeSlugs?: boolean;
}

/**
 * Launch a salvo of `missiles` missiles at a target, each launcher firing as soon as it is
 * loaded, until the salvo is done or the magazines are empty of the missile it launches. The
 * target is an enemy ship, by its side, for anti-ship missiles; or an enemy missile in flight
 * aimed at a ship, `{ munition: id }`, for anti-missile missiles. `missile` names the missile
 * design to launch; left out, it is the first design of the right kind the magazines hold, anti-
 * ship or anti-missile, preferring one with missiles left. It stands apart from the weapons
 * order and its fire mode. A new launch order replaces the salvo still to go; zero missiles calls
 * it off.
 */
export interface LaunchOrder {
  readonly type: 'launch';
  readonly target: MissileTarget;
  readonly missiles: number;
  readonly missile?: string;
}

/**
 * Turn automatic missile defence on or off. While it is on, the ship launches an anti-missile
 * missile at each enemy missile predicted to reach it that none of its anti-missile missiles is
 * already after, as launchers come free, ahead of any salvo. Off, anti-missile missiles are
 * launched only by launch order. Every ship starts with it on; it does nothing for a ship without
 * anti-missile missiles.
 */
export interface AntiMissileOrder {
  readonly type: 'anti-missile';
  readonly automatic: boolean;
}

/**
 * What point defence fires on: incoming missiles only, ignoring the enemy ship; or missiles
 * first, and the weapons order's target while it fires freely and no missile is within reach.
 */
export type PointDefencePriority = 'missiles' | 'missiles-then-ship';
export const POINT_DEFENCE_PRIORITIES: readonly PointDefencePriority[] = [
  'missiles',
  'missiles-then-ship',
];

/**
 * Set what the point defence fires on. It stands apart from the weapons order: on missiles it
 * fires whatever the fire mode, at any enemy missile within its reach that is aimed at the ship.
 * It leaves enemy anti-missile missiles alone, as they threaten only missiles. Every ship starts
 * with point defence on missiles only.
 */
export interface PointDefenceOrder {
  readonly type: 'point-defence';
  readonly priority: PointDefencePriority;
}

/**
 * Leave the battle, spending the reserve and whatever propellant is left: the autopilot turns the
 * ship away from the enemy and burns at full thrust. It cannot be taken back, and the ship takes
 * no other order to move. The enemy may keep firing at it, launches included, but may not pursue
 * it (see `pursuitRefused`). It is gone once out of reach of every enemy weapon, or
 * `WITHDRAWAL_TIME` after the order, whichever comes first: a loss in which the ship survives.
 */
export interface WithdrawOrder {
  readonly type: 'withdraw';
  /** Why the captain withdraws; 'ordered' if left out. */
  readonly reason?: WithdrawalReason;
}

/**
 * Why a ship withdraws: its captain simply ordered it, or a computer captain judged that its
 * delta-v is down to its reserve, it has nothing left to fight with, it cannot afford another
 * firing pass, its armour is worn too thin on an attack run, a damaged sensor or drive would fail
 * before it could fire, or the enemy outranges it by too much to close.
 */
export type WithdrawalReason =
  'ordered' | 'reserve' | 'disarmed' | 'no-pass' | 'armour-worn' | 'failing' | 'outranged';

/** An instruction from a side's captain to its ship. */
export type Order =
  | AttitudeOrder
  | BurnOrder
  | ManoeuvreOrder
  | PowerOrder
  | RadiatorsOrder
  | RollOrder
  | RepairOrder
  | ShieldsOrder
  | WeaponsOrder
  | LaunchOrder
  | AntiMissileOrder
  | PointDefenceOrder
  | WithdrawOrder;
