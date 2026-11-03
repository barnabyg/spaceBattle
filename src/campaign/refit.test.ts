import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { catalogueComponent, sameComponent } from '../data/components';
import { OPPONENTS } from '../data/opponents';
import { componentSlots } from '../sim/components';
import type { Design } from '../sim/design';
import { buildDesign, specificationOf } from '../shipyard/shipyard';
import { buildShip, newCampaign, refitCost, refitShip, saleValue, sellShip } from './campaign';

/** A campaign with a Lance in its hangar and credits to spare. */
const withLance = () => {
  const start = newCampaign(5);
  const lance = start.designs.find((d) => d.id === 'lance');
  if (!lance) throw new Error('No Lance');
  return { campaign: { ...buildShip(start, lance), credits: 20e6 }, lance };
};

/** The Lance with its 500 MW laser swapped for two 400 MW lasers on the middle section. */
const twinLaser = (lance: Design): Design => {
  const spec = specificationOf(lance);
  const big = catalogueComponent('laser-500');
  const small = { component: catalogueComponent('laser-400'), section: 'middle' as const };
  return buildDesign({
    ...spec,
    name: 'Twin Lance',
    components: [...spec.components.filter((c) => !sameComponent(c.component, big)), small, small],
  }).design;
};

describe('refitting and selling ships', () => {
  it('prices a refit as the new components plus labour, with nothing back for those removed', () => {
    const { campaign, lance } = withLance();
    const ship = campaign.hangar[0];
    if (!ship) throw new Error('No ship');
    expect(BALANCE.refitLabourShare).toBe(0.2);
    // Two 25 t lasers at 40 cr/kg are new; the 500 MW laser goes for nothing. Labour is a fifth
    // of everything the new design is fitted with: 7,040,000 cr of components and 1,130,112 cr
    // of ablative armour.
    const expected = 2 * 25e3 * 40 + 0.2 * (7_040_000 + 1_130_112);
    expect(refitCost(ship, twinLaser(lance))).toBeCloseTo(expected, 3);

    const refitted = refitShip(campaign, ship.id, twinLaser(lance));
    expect(refitted.credits).toBeCloseTo(campaign.credits - expected, 3);
    expect(refitted.hangar[0]?.design).toEqual(twinLaser(lance));
    expect(refitted.hangar[0]?.id).toBe(ship.id);
    expect(refitted.designs).toContainEqual(twinLaser(lance));
  });

  it('keeps the damage of the components a refit keeps, and fits the new ones as built', () => {
    const { campaign, lance } = withLance();
    const slots = componentSlots(lance);
    const reactor = slots.findIndex((s) => s.component.type === 'reactor');
    const laser = slots.findIndex((s) => s.component.type === 'laser');
    const damaged = {
      ...campaign,
      hangar: campaign.hangar.map((ship) => ({
        ...ship,
        condition: {
          ...ship.condition,
          integrity: ship.condition.integrity.map((v, i) =>
            i === reactor || i === laser ? 0.5 : v,
          ),
        },
      })),
    };
    const refitted = refitShip(damaged, 'ship-1', twinLaser(lance)).hangar[0];
    if (!refitted) throw new Error('No ship');
    const integrityOf = (type: string) =>
      componentSlots(refitted.design).flatMap((s, i) =>
        s.component.type === type ? [refitted.condition.integrity[i]] : [],
      );
    expect(integrityOf('reactor')).toEqual([0.5]);
    expect(integrityOf('laser')).toEqual([1, 1]);
  });

  it('refuses a refit to another hull size', () => {
    const { campaign } = withLance();
    const cruiser = OPPONENTS.find((o) => o.design.hullSize === 'cruiser')?.design;
    if (!cruiser) throw new Error('No cruiser');
    expect(() => refitShip(campaign, 'ship-1', cruiser)).toThrow('same hull size');
  });

  it('sells a ship at a much reduced value and takes it out of the hangar', () => {
    const { campaign } = withLance();
    const ship = campaign.hangar[0];
    if (!ship) throw new Error('No ship');
    // A quarter of the 8,050,112 cr an undamaged, fully stocked Lance costs.
    expect(BALANCE.saleShare).toBe(0.25);
    expect(saleValue(ship)).toBeCloseTo(0.25 * 8_050_112, 3);
    const sold = sellShip(campaign, ship.id);
    expect(sold.credits).toBeCloseTo(campaign.credits + 0.25 * 8_050_112, 3);
    expect(sold.hangar).toEqual([]);
  });
});
