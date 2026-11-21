import type { WithdrawalReason } from '../sim/orders';

/** Why a ship withdraws, said of our own ship and of the enemy. Null for a plain order. */
const REASONS: Readonly<Record<WithdrawalReason, { own: string; enemy: string } | null>> = {
  ordered: null,
  reserve: {
    own: 'our delta-v is down to our reserve',
    enemy: 'its delta-v is down to its reserve',
  },
  disarmed: {
    own: 'we have nothing left to fight with',
    enemy: 'it has nothing left to fight with',
  },
  'no-pass': {
    own: 'we cannot afford another firing pass',
    enemy: 'it cannot afford another firing pass',
  },
  'armour-worn': {
    own: 'our armour is worn too thin to press the attack',
    enemy: 'its armour is worn too thin to press the attack',
  },
  failing: {
    own: 'our damaged sensor or drive would fail before we could fire',
    enemy: 'its damaged sensor or drive would fail before it could fire',
  },
  outranged: {
    own: 'the enemy outranges us too far to close',
    enemy: 'we outrange it too far for it to close',
  },
};

/** Why a ship withdraws, in a few words about our ship or the enemy; null for a plain order. */
export const withdrawalReasonText = (reason: WithdrawalReason, own: boolean): string | null => {
  const text = REASONS[reason];
  return text ? (own ? text.own : text.enemy) : null;
};
