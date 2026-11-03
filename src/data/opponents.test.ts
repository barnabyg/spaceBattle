import { describe, expect, it } from 'vitest';
import { designCost } from '../shipyard/cost';
import { buildDesign } from '../shipyard/shipyard';
import { BALANCE } from './balance';
import { OPPONENTS } from './opponents';

describe('opponent specifications', () => {
  it('number a few for every tier, each with a style', () => {
    for (const tier of BALANCE.tiers) {
      const ofTier = OPPONENTS.filter((o) => o.tier === tier.tier);
      expect(ofTier.length, `tier ${tier.tier}`).toBeGreaterThanOrEqual(2);
      for (const opponent of ofTier) expect(opponent.style).not.toBe('');
    }
    expect(new Set(OPPONENTS.map((o) => o.specification.name)).size).toBe(OPPONENTS.length);
  });

  it.each(OPPONENTS.map((o) => [o.specification.name, o] as const))(
    '%s builds into a valid design within its tier’s budget',
    (_, opponent) => {
      const { design, errors } = buildDesign(opponent.specification);
      expect(errors).toEqual([]);
      const tier = BALANCE.tiers.find((t) => t.tier === opponent.tier);
      expect(tier).toBeDefined();
      expect(designCost(design)).toBeLessThanOrEqual(tier?.budget ?? 0);
      expect(opponent.design).toEqual(design);
    },
  );

  it('face higher tiers with larger budgets, more skilled captains and larger rewards', () => {
    const tiers = BALANCE.tiers;
    tiers.slice(1).forEach((tier, i) => {
      const lower = tiers[i];
      expect(tier.tier).toBe((lower?.tier ?? 0) + 1);
      expect(tier.budget).toBeGreaterThan(lower?.budget ?? Infinity);
      expect(tier.reward).toBeGreaterThan(lower?.reward ?? Infinity);
    });
    expect(tiers.map((t) => t.skill)).toEqual(['low', 'medium', 'high']);
  });
});
