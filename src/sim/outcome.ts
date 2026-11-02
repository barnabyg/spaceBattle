import type { SideId, SideSetup } from './battle';
import { componentSlots, integrityOfType } from './components';
import type { ComponentType } from './design';
import type { ShipState } from './ship';

/** How a destroyed ship was lost. */
export type DestroyedCause = 'reactor-breach' | 'structural-failure';
/** Why a disabled ship can no longer fight. */
export type DisabledCause = 'no-working-weapons' | 'no-working-drive';

/**
 * How a side lost a battle. Destroyed and forfeited ships are lost; a disabled ship survives the
 * battle it has lost. Withdrawal and stranding join these in later phases.
 */
export type Loss =
  | { readonly result: 'destroyed'; readonly cause: DestroyedCause }
  | { readonly result: 'disabled'; readonly cause: DisabledCause }
  | { readonly result: 'forfeit' };

/** How the battle ended for one side. */
export interface SideOutcome {
  readonly side: SideId;
  /** How the side lost, or null if it did not. */
  readonly loss: Loss | null;
  /** Whether its ship is lost: destroyed, or treated as destroyed after a forfeit. */
  readonly shipLost: boolean;
}

/** How a battle ended. */
export interface BattleOutcome {
  /** When it ended, s. */
  readonly time: number;
  /**
   * The one side left that did not lose, or null when there is none: every side lost in the
   * same step (a draw), or a battle between computer sides was ended with no result.
   */
  readonly winner: SideId | null;
  /** Every side, in the battle's order. */
  readonly sides: readonly SideOutcome[];
}

const WEAPON_TYPES: ReadonlySet<ComponentType> = new Set(['laser']);

/**
 * Whether a ship has lost the battle, and how. A reactor breach or structural failure of the
 * middle section destroys it; failing that, it is disabled once it has no working drive or none
 * of its weapons left working. A design built without weapons is never disabled for want of
 * them: it cannot lose what it never had.
 */
export const lossOf = (ship: ShipState): Loss | null => {
  if (ship.sections.middle.structure <= 0) {
    return { result: 'destroyed', cause: 'structural-failure' };
  }
  if (integrityOfType(ship.design, ship.integrity, 'reactor') <= 0) {
    return { result: 'destroyed', cause: 'reactor-breach' };
  }
  if (integrityOfType(ship.design, ship.integrity, 'drive') <= 0) {
    return { result: 'disabled', cause: 'no-working-drive' };
  }
  const weapons = componentSlots(ship.design).flatMap((slot, i) =>
    WEAPON_TYPES.has(slot.component.type) ? [ship.integrity[i] ?? 0] : [],
  );
  if (weapons.length > 0 && weapons.every((integrity) => integrity <= 0)) {
    return { result: 'disabled', cause: 'no-working-weapons' };
  }
  return null;
};

/** Each side's outcome from its loss, if any: a ship is lost when destroyed or forfeited. */
const outcome = (
  time: number,
  losses: readonly { readonly side: SideId; readonly loss: Loss | null }[],
): BattleOutcome => {
  const standing = losses.filter(({ loss }) => loss === null);
  return {
    time,
    winner:
      standing.length === 1 && standing.length < losses.length ? (standing[0]?.side ?? null) : null,
    sides: losses.map(({ side, loss }) => ({
      side,
      loss,
      shipLost: loss !== null && (loss.result === 'destroyed' || loss.result === 'forfeit'),
    })),
  };
};

/**
 * The outcome once some sides have lost, or null while none has. The winner is the only side
 * that has not lost; if every side lost in the same step, nobody wins.
 */
export const judge = (
  time: number,
  losses: readonly { readonly side: SideId; readonly loss: Loss | null }[],
): BattleOutcome | null =>
  losses.some(({ loss }) => loss !== null) ? outcome(time, losses) : null;

/**
 * The outcome of a side choosing "End battle". A player side forfeits: it loses, its ship is
 * treated as destroyed, and the other side wins (this holds when both sides are players too).
 * Between computer sides the battle ends with no result. A computer side cannot end a battle
 * against a player: only the player may forfeit.
 */
export const endedBy = (
  time: number,
  sides: readonly SideSetup[],
  sideId: SideId,
): BattleOutcome => {
  const side = sides.find((s) => s.id === sideId);
  if (!side) throw new Error(`Unknown side ${sideId}`);
  const forfeit = side.commander === 'player';
  if (!forfeit && sides.some((s) => s.commander === 'player')) {
    throw new Error('Only a player side can end a battle against a player');
  }
  return outcome(
    time,
    sides.map((s) => ({ side: s.id, loss: forfeit && s === side ? { result: 'forfeit' } : null })),
  );
};
