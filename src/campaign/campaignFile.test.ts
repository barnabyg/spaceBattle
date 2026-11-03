import { describe, expect, it } from 'vitest';
import { componentSlots } from '../sim/components';
import { fullCondition } from '../sim/ship';
import { buildShip, newCampaign, repairShip, type Campaign } from './campaign';
import { loadCampaign, saveCampaign } from './campaignFile';

/** A campaign some way in: two ships, one of them damaged and partly repaired. */
const underWay = (): Campaign => {
  const start = { ...newCampaign(21), credits: 30e6 };
  const [lance, sling] = start.designs;
  if (!lance || !sling) throw new Error('No starter designs');
  const built = buildShip(buildShip(start, lance), sling);
  const reactor = componentSlots(lance).findIndex((s) => s.component.type === 'reactor');
  const damaged: Campaign = {
    ...built,
    battles: 3,
    hangar: built.hangar.map((ship, i) =>
      i === 0
        ? {
            ...ship,
            condition: {
              ...ship.condition,
              integrity: ship.condition.integrity.map((v, j) => (j === reactor ? 0.2 : v)),
              propellantMass: 123e3,
            },
          }
        : ship,
    ),
  };
  return repairShip(damaged, 'ship-1', 0.5);
};

describe('campaign files', () => {
  it('load a saved campaign as it was saved', () => {
    const campaign = underWay();
    expect(loadCampaign(saveCampaign(campaign))).toEqual(campaign);
  });

  it('load a file in the first format, from before ships carried their condition, with every ship as built', () => {
    const campaign = underWay();
    const version1 = JSON.stringify({
      format: 'space-battle-campaign',
      version: 1,
      campaign: {
        ...campaign,
        hangar: campaign.hangar.map(({ id, name, design }) => ({ id, name, design })),
      },
    });
    const loaded = loadCampaign(version1);
    expect(loaded.credits).toBe(campaign.credits);
    expect(loaded.battles).toBe(3);
    expect(loaded.hangar.map((s) => s.name)).toEqual(['Ship 1', 'Ship 2']);
    for (const ship of loaded.hangar) expect(ship.condition).toEqual(fullCondition(ship.design));
  });

  it('refuse a file that is not a campaign, is damaged, or comes from a newer version', () => {
    expect(() => loadCampaign('{}')).toThrow('not a campaign file');
    expect(() => loadCampaign('[1, 2')).toThrow('not a campaign file');
    const saved = JSON.parse(saveCampaign(underWay())) as { campaign: Campaign };
    expect(() =>
      loadCampaign(JSON.stringify({ ...saved, campaign: { ...saved.campaign, credits: 'lots' } })),
    ).toThrow('damaged');
    const broken = saved.campaign.hangar.map((s) => ({
      ...s,
      condition: { ...s.condition, integrity: [1] },
    }));
    expect(() =>
      loadCampaign(JSON.stringify({ ...saved, campaign: { ...saved.campaign, hangar: broken } })),
    ).toThrow('damaged');
    expect(() =>
      loadCampaign(JSON.stringify({ format: 'space-battle-campaign', version: 3 })),
    ).toThrow('newer version');
    // Numbers written as text are not numbers, however they read.
    const textual = saved.campaign.hangar.map((s) => ({
      ...s,
      condition: {
        ...s.condition,
        integrity: s.condition.integrity.map(String),
        propellantMass: String(s.condition.propellantMass),
      },
    }));
    expect(() =>
      loadCampaign(JSON.stringify({ ...saved, campaign: { ...saved.campaign, hangar: textual } })),
    ).toThrow('damaged');
  });
});
