import { describe, expect, it } from 'vitest';
import type { Loss } from '../sim/outcome';
import { componentSlots } from '../sim/components';
import { designCost } from '../shipyard/cost';
import {
  buildShip,
  campaignOver,
  newCampaign,
  OPPONENT_SIDE,
  PLAYER_SIDE,
  prepareBattle,
  recordBattle,
  repairCost,
  restockCost,
  saleValue,
  type Campaign,
} from './campaign';

const withShip = (): Campaign => {
  const start = newCampaign(9);
  const lance = start.designs.find((d) => d.id === 'lance');
  if (!lance) throw new Error('No Lance');
  return buildShip(start, lance);
};

/** The campaign after its first ship lost a battle in a way. */
const lostBy = (campaign: Campaign, loss: Loss, shipLost: boolean): Campaign =>
  recordBattle(campaign, prepareBattle(campaign, 'ship-1', 1), {
    outcome: {
      time: 3_600,
      winner: OPPONENT_SIDE,
      sides: [
        { side: PLAYER_SIDE, loss, shipLost },
        { side: OPPONENT_SIDE, loss: null, shipLost: false },
      ],
    },
  });

/** The cheapest design the campaign can build, credits. */
const cheapest = (campaign: Campaign) => Math.min(...campaign.designs.map(designCost));

/** The campaign with its first ship's drive wrecked, so it cannot fight until repaired. */
const disabled = (campaign: Campaign): Campaign => ({
  ...campaign,
  hangar: campaign.hangar.map((ship) => {
    const drive = componentSlots(ship.design).findIndex((s) => s.component.type === 'drive');
    return {
      ...ship,
      condition: {
        ...ship.condition,
        integrity: ship.condition.integrity.map((v, i) => (i === drive ? 0 : v)),
      },
    };
  }),
});

describe('losing ships', () => {
  it.each([
    [{ result: 'destroyed', cause: 'reactor-breach' }],
    [{ result: 'stranded' }],
    [{ result: 'forfeit' }],
  ] satisfies [Loss][])('removes a ship %o from the hangar and keeps the credits', (loss) => {
    const campaign = withShip();
    const after = lostBy(campaign, loss, true);
    expect(after.hangar).toEqual([]);
    expect(after.credits).toBe(campaign.credits);
  });

  it.each([
    [{ result: 'disabled', cause: 'no-working-drive' }],
    [{ result: 'withdrawn' }],
  ] satisfies [Loss][])('keeps a ship that survives its loss %o', (loss) => {
    expect(lostBy(withShip(), loss, false).hangar).toHaveLength(1);
  });
});

describe('the end of a campaign', () => {
  it('has not come while a ship can fight, whatever the credits', () => {
    expect(campaignOver({ ...withShip(), credits: 0 })).toBe(false);
    expect(campaignOver(newCampaign(9))).toBe(false);
  });

  it('comes exactly when no ship is left and none can be afforded', () => {
    const empty = lostBy(withShip(), { result: 'forfeit' }, true);
    expect(campaignOver({ ...empty, credits: cheapest(empty) })).toBe(false);
    expect(campaignOver({ ...empty, credits: cheapest(empty) - 1 })).toBe(true);
    expect(campaignOver({ ...empty, credits: 0 })).toBe(true);
  });

  it('comes exactly when a ship that cannot fight cannot be repaired, nor sold for another', () => {
    const campaign = disabled(withShip());
    const ship = campaign.hangar[0];
    if (!ship) throw new Error('No ship');
    // Enough to put it right again: it can be fielded.
    const putRight = repairCost(ship) + restockCost(ship);
    expect(campaignOver({ ...campaign, credits: putRight })).toBe(false);
    // Short of that, and selling it does not raise enough for the cheapest design.
    expect(putRight - 1 + saleValue(ship)).toBeLessThan(cheapest(campaign));
    expect(campaignOver({ ...campaign, credits: putRight - 1 })).toBe(true);
    // Selling it would raise enough for a new ship.
    expect(campaignOver({ ...campaign, credits: cheapest(campaign) - saleValue(ship) })).toBe(
      false,
    );
  });
});
