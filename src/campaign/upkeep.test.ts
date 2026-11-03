import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { createBattle, type ShipCondition } from '../sim/battle';
import { componentSlots } from '../sim/components';
import {
  buildShip,
  newCampaign,
  OPPONENT_SIDE,
  PLAYER_SIDE,
  prepareBattle,
  recordBattle,
  repairCost,
  repairShip,
  restockCost,
  restockShip,
  type Campaign,
} from './campaign';

/** A campaign with one ship of a starter design, which has fought a battle and lost it. */
const afterBattle = (
  designId: string,
  wear: (condition: ShipCondition, slot: (type: string) => number) => ShipCondition,
): Campaign => {
  const start = newCampaign(3);
  const design = start.designs.find((d) => d.id === designId);
  if (!design) throw new Error(`No starter design ${designId}`);
  const campaign = { ...buildShip(start, design), credits: 10e6 };
  const battle = prepareBattle(campaign, 'ship-1', 1);
  const full = createBattle(battle.setup).observe(PLAYER_SIDE).ownShip.condition;
  const slots = componentSlots(design);
  const condition = wear(full, (type) => slots.findIndex((s) => s.component.type === type));
  return recordBattle(campaign, battle, {
    outcome: {
      time: 3_600,
      winner: OPPONENT_SIDE,
      sides: [
        { side: PLAYER_SIDE, loss: { result: 'withdrawn' }, shipLost: false },
        { side: OPPONENT_SIDE, loss: null, shipLost: false },
      ],
    },
    condition,
  });
};

/** A Lance with its reactor half wrecked, 10 mm of forward armour gone and its middle cracked. */
const damagedLance = () =>
  afterBattle('lance', (full, slot) => ({
    ...full,
    integrity: full.integrity.map((value, i) => (i === slot('reactor') ? 0.5 : value)),
    sections: {
      ...full.sections,
      forward: { armour: 0.04, structure: 1 },
      middle: { armour: 0.02, structure: 0.9 },
    },
  }));

const ship = (campaign: Campaign) => {
  const found = campaign.hangar[0];
  if (!found) throw new Error('No ship');
  return found;
};

describe('repairs and restocking between battles', () => {
  it('price repairs by the damage done, at a share of the price of new', () => {
    expect(BALANCE.repairPriceShare).toBe(0.5);
    // Half of a 40 t reactor at 40 cr/kg; 10 mm of ablative armour over the frigate's 1,104 m²
    // forward surface at 1,800 kg/m³ and 6 cr/kg; a tenth of the middle section's structure, half
    // of the frigate's 300 t at 2 cr/kg. All at half the price of new.
    const reactor = 0.5 * 40e3 * 40;
    const armour = 0.01 * 1_104 * 1_800 * 6;
    const structure = 0.1 * 150e3 * 2;
    expect(repairCost(ship(damagedLance()))).toBeCloseTo(0.5 * (reactor + armour + structure), 3);
  });

  it('repair the damage for its price, or a share of it for that share of the price', () => {
    const campaign = damagedLance();
    const cost = repairCost(ship(campaign));
    const repaired = repairShip(campaign, 'ship-1');
    expect(repaired.credits).toBeCloseTo(campaign.credits - cost, 3);
    expect(repairCost(ship(repaired))).toBe(0);
    expect(ship(repaired).condition.integrity.every((value) => value === 1)).toBe(true);
    expect(ship(repaired).condition.sections.forward.armour).toBeCloseTo(0.05, 9);

    const half = repairShip(campaign, 'ship-1', 0.5);
    expect(half.credits).toBeCloseTo(campaign.credits - cost / 2, 3);
    expect(repairCost(ship(half))).toBeCloseTo(cost / 2, 3);
    expect(ship(half).condition.sections.middle.structure).toBeCloseTo(0.95, 9);
  });

  it('price restocking by the propellant and ammunition used', () => {
    const campaign = afterBattle('quiver', (full) => ({
      ...full,
      propellantMass: 300e3,
      magazines: full.magazines.map((m) => ({ ...m, missiles: 8 })),
    }));
    // 100 t of propellant at 0.2 cr/kg, and four 4 t Spike missiles at 10 cr/kg.
    expect(restockCost(ship(campaign))).toBeCloseTo(100e3 * 0.2 + 4 * 4e3 * 10, 3);
    const restocked = restockShip(campaign, 'ship-1');
    expect(restocked.credits).toBeCloseTo(campaign.credits - restockCost(ship(campaign)), 3);
    expect(ship(restocked).condition.propellantMass).toBe(400e3);
    expect(ship(restocked).condition.magazines.map((m) => m.missiles)).toEqual([12]);
    expect(restockCost(ship(restocked))).toBe(0);
  });

  it('refuse what the player cannot pay for', () => {
    const campaign = { ...damagedLance(), credits: 1 };
    expect(() => repairShip(campaign, 'ship-1')).toThrow('Not enough credits');
  });

  it('leave damage not paid for in the ship at the start of its next battle', () => {
    const campaign = repairShip(damagedLance(), 'ship-1', 0.5);
    const { setup } = prepareBattle(campaign, 'ship-1', 1);
    const own = createBattle(setup).observe(PLAYER_SIDE).ownShip;
    expect(own.condition).toEqual(ship(campaign).condition);
    const middle = own.sections.find((s) => s.kind === 'middle');
    expect(middle?.structure).toBeCloseTo(0.95, 9);
    expect(middle?.components.find((c) => c.type === 'reactor')?.integrity).toBeCloseTo(0.75, 9);
  });
});
