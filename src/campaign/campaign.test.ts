import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { OPPONENTS } from '../data/opponents';
import type { BattleOutcome } from '../sim/outcome';
import { designCost } from '../shipyard/cost';
import {
  buildShip,
  newCampaign,
  OPPONENT_SIDE,
  PLAYER_SIDE,
  prepareBattle,
  recordBattle,
  type Campaign,
} from './campaign';

/** A new campaign with its first ship built from its cheapest starter design. */
const withFirstShip = (): Campaign => {
  const campaign = newCampaign(7);
  const cheapest = [...campaign.designs].sort((a, b) => designCost(a) - designCost(b))[0];
  if (!cheapest) throw new Error('No starter design');
  return buildShip(campaign, cheapest);
};

/** How a battle ended, with the winning side and the loser destroyed. */
const won = (winner: string): BattleOutcome => ({
  time: 3_600,
  winner,
  sides: [PLAYER_SIDE, OPPONENT_SIDE].map((side) => ({
    side,
    loss: side === winner ? null : { result: 'destroyed', cause: 'reactor-breach' },
    shipLost: side !== winner,
  })),
});

describe('a campaign', () => {
  it('starts with credits enough for a modest frigate, a few starter designs and no ships', () => {
    const campaign = newCampaign(7);
    expect(campaign.credits).toBe(BALANCE.startingCredits);
    expect(campaign.hangar).toEqual([]);
    expect(campaign.designs.length).toBeGreaterThanOrEqual(2);
    const frigates = campaign.designs.filter((d) => d.hullSize === 'frigate');
    expect(frigates.some((d) => designCost(d) <= campaign.credits)).toBe(true);
  });

  it('deducts the cost of a ship built and adds it to the hangar', () => {
    const campaign = newCampaign(7);
    const design = campaign.designs[0];
    if (!design) throw new Error('No starter design');
    const after = buildShip(campaign, design);
    expect(after.credits).toBe(campaign.credits - designCost(design));
    expect(after.hangar).toHaveLength(1);
    expect(after.hangar[0]?.design).toEqual(design);
    const second = buildShip({ ...after, credits: 100e6 }, design);
    expect(second.hangar.map((s) => s.name)).toEqual(['Ship 1', 'Ship 2']);
  });

  it('refuses to build a ship it cannot afford', () => {
    const campaign = { ...newCampaign(7), credits: 1_000 };
    const design = campaign.designs[0];
    if (!design) throw new Error('No starter design');
    expect(() => buildShip(campaign, design)).toThrow('Not enough credits');
  });

  it('remembers a design built from outside its starter designs', () => {
    const campaign = { ...newCampaign(7), credits: 100e6 };
    const design = OPPONENTS[0]?.design;
    if (!design) throw new Error('No opponent');
    expect(buildShip(campaign, design).designs).toContainEqual(design);
  });

  it('sends a ship from the hangar against an opponent of the chosen tier', () => {
    const campaign = withFirstShip();
    const ship = campaign.hangar[0];
    if (!ship) throw new Error('No ship');
    for (const tier of BALANCE.tiers) {
      const battle = prepareBattle(campaign, ship.id, tier.tier);
      const [player, opponent] = battle.setup.sides;
      expect(player).toMatchObject({ id: PLAYER_SIDE, commander: 'player', design: ship.design });
      expect(opponent).toMatchObject({
        id: OPPONENT_SIDE,
        commander: 'computer',
        skill: tier.skill,
      });
      const fielded = OPPONENTS.filter((o) => o.tier === tier.tier).map((o) => o.design);
      expect(fielded).toContainEqual(opponent?.design);
    }
    // The same campaign sends the same battle; another battle may differ.
    expect(prepareBattle(campaign, ship.id, 1)).toEqual(prepareBattle(campaign, ship.id, 1));
  });

  it('pays the tier’s reward for a win and nothing for a loss', () => {
    const campaign = withFirstShip();
    const ship = campaign.hangar[0];
    if (!ship) throw new Error('No ship');
    for (const tier of BALANCE.tiers) {
      const battle = prepareBattle(campaign, ship.id, tier.tier);
      const win = recordBattle(campaign, battle, { outcome: won(PLAYER_SIDE) });
      expect(win.credits).toBe(campaign.credits + tier.reward);
      expect(win.battles).toBe(campaign.battles + 1);
      const loss = recordBattle(campaign, battle, { outcome: won(OPPONENT_SIDE) });
      expect(loss.credits).toBe(campaign.credits);
    }
  });
});
