import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { createBattle, type Battle } from './battle';
import { designComponentsOfType } from './design';
import { effectiveRange } from './beams';
import {
  armedTestDesign,
  duelSetup,
  TEST_LASER,
  testDesign,
  withComponent,
  withSection,
} from './testing';
import { vec3 } from './vector';
import { beamResistance } from './armour';
import { spotRadius } from './beams';

const target = () =>
  withSection(testDesign(), 'forward', { armour: { type: 'ablative', thickness: 1 } });
const weapons = (battle: Battle) => battle.observe('blue').ownShip.weapons;
const fire = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
};

describe('charged lasers', () => {
  it('charges from empty, fires a bounded burst, then recharges with the old sustained energy budget', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), target(), 30_000e3));
    fire(battle);
    battle.advance(7.5);
    expect(weapons(battle).lasers[0]).toMatchObject({ charge: 0.5, firing: false, beamPower: 0 });
    expect(weapons(battle).readiness[0]?.status).toBe('charging');
    expect(battle.observe('blue').ownShip.energyLedger.beamEmitted).toBe(0);
    battle.advance(7.5);
    expect(weapons(battle).lasers[0]?.charge).toBeCloseTo(1);
    battle.step();
    expect(weapons(battle).lasers[0]?.beamPower).toBeCloseTo(16 * TEST_LASER.beamPower);
    expect(weapons(battle).readiness[0]?.status).toBe('firing');
    battle.advance(0.9);
    expect(weapons(battle).lasers[0]?.charge).toBeCloseTo(0);
    battle.step();
    expect(weapons(battle).lasers[0]?.firing).toBe(false);
    battle.advance(14.9);
    expect(weapons(battle).lasers[0]?.charge).toBeCloseTo(1);
    expect(battle.observe('blue').ownShip.energyLedger.beamEmitted).toBeCloseTo(
      16 * TEST_LASER.beamPower,
      -2,
    );
    battle.step();
    expect(weapons(battle).lasers[0]?.beamPower).toBeCloseTo(16 * TEST_LASER.beamPower);
    battle.advance(16.9);
    const ship = battle.observe('blue').ownShip;
    expect(ship.energyLedger.beamEmitted).toBeCloseTo(48 * TEST_LASER.beamPower, -2);
    expect(ship.energyLedger.delivered.weapons).toBeCloseTo(
      (48 * TEST_LASER.beamPower) / TEST_LASER.efficiency,
      -2,
    );
    expect(ship.weapons.lasers[0]?.storedEnergy).toBeCloseTo(0, -2);
    // With no shields, the same fluence wears the same armour as the old continuous beam.
    battle.advance(0.5); // Allow the last emitted slice to reach the target.
    const nose = battle
      .observe('red')
      .ownShip.sections.find((section) => section.kind === 'forward');
    const intensity = TEST_LASER.beamPower / (Math.PI * spotRadius(TEST_LASER, 30_000e3) ** 2);
    expect(1 - (nose?.armour.remaining ?? 1)).toBeCloseTo(
      (48 * intensity) / beamResistance('ablative', 'laser'),
      9,
    );
  });

  it('emits stored energy even when priorities leave no charging power, then stops when empty', () => {
    const design = withComponent(
      withComponent(armedTestDesign(), 'capacitor', { capacity: 0, maxDischarge: 0 }),
      'reactor',
      { output: TEST_LASER.beamPower / TEST_LASER.efficiency },
    );
    const battle = createBattle(duelSetup(design, target(), 30_000e3));
    fire(battle);
    battle.advance(15);
    battle.giveOrder('blue', {
      type: 'power',
      priorities: ['drive', 'capacitors', 'weapons', 'shields'],
    });
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 10 });
    battle.step();
    expect(battle.observe('blue').ownShip.power.systems.weapons.supplied).toBeCloseTo(0, 4);
    expect(weapons(battle).lasers[0]?.firing).toBe(true);
    expect(weapons(battle).readiness[0]?.status).toBe('firing');
    battle.advance(2);
    expect(weapons(battle).lasers[0]?.storedEnergy).toBeCloseTo(0, 4);
    expect(weapons(battle).lasers[0]?.firing).toBe(false);
    expect(battle.observe('blue').ownShip.energyLedger.beamEmitted).toBeCloseTo(
      15 * TEST_LASER.beamPower,
      -2,
    );
  });

  it('accounts for local storage and conversion heat on every step of a cycle', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), target(), 30_000e3));
    fire(battle);
    for (let step = 0; step < 320; step++) {
      battle.step();
      const ship = battle.observe('blue').ownShip;
      const ledger = ship.energyLedger;
      const energy =
        ledger.reactorHeat +
        ledger.delivered.weapons -
        ledger.beamEmitted -
        (ship.weapons.lasers[0]?.storedEnergy ?? 0);
      expect(ledger.heatGenerated).toBeCloseTo(energy, -2);
      expect(ship.weapons.lasers[0]?.storedEnergy).toBeGreaterThanOrEqual(0);
      expect(ship.weapons.lasers[0]?.charge).toBeLessThanOrEqual(1);
    }
  });

  it.each([0, 0.5])(
    'a mount at integrity %s cannot charge or emit beyond its reduced capacity',
    (integrity) => {
      const setup = duelSetup(armedTestDesign(), target(), 30_000e3);
      const condition = createBattle(setup).observe('blue').ownShip.condition;
      const battle = createBattle({
        ...setup,
        sides: setup.sides.map((side, i) =>
          i === 0
            ? {
                ...side,
                condition: {
                  ...condition,
                  integrity: condition.integrity.map((value, slot) =>
                    slot === 0 ? integrity : value,
                  ),
                },
              }
            : side,
        ),
      });
      fire(battle);
      battle.advance(15);
      expect(weapons(battle).lasers[0]?.storedEnergy).toBeCloseTo(
        (15 * integrity * TEST_LASER.beamPower) / TEST_LASER.efficiency,
        -2,
      );
      battle.step();
      expect(weapons(battle).lasers[0]?.beamPower).toBeCloseTo(
        16 * integrity * TEST_LASER.beamPower,
        -2,
      );
    },
  );

  it('slows charging with actual power supply and cannot fire without any energy', () => {
    const design = withComponent(
      withComponent(armedTestDesign(), 'capacitor', { capacity: 0, maxDischarge: 0 }),
      'reactor',
      { output: TEST_LASER.beamPower / TEST_LASER.efficiency / 4 },
    );
    const battle = createBattle(duelSetup(design, target(), 30_000e3));
    fire(battle);
    battle.advance(15);
    expect(weapons(battle).lasers[0]?.charge).toBeCloseTo(0.25);
    expect(weapons(battle).lasers[0]?.firing).toBe(false);
    battle.advance(45);
    expect(weapons(battle).lasers[0]?.charge).toBeCloseTo(1);
    battle.step();
    expect(weapons(battle).lasers[0]?.firing).toBe(true);
    const powerless = createBattle(
      duelSetup(withComponent(design, 'reactor', { output: 0 }), target(), 30_000e3),
    );
    fire(powerless);
    powerless.advance(20);
    expect(weapons(powerless).lasers[0]).toMatchObject({ charge: 0, beamPower: 0 });
    expect(weapons(powerless).readiness[0]?.status).toBe('no-power');
  });

  it('interrupts a burst on hold fire, retains only bounded charge and resumes without an oversized shot', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), target(), 30_000e3));
    fire(battle);
    battle.advance(15.5);
    const charge = weapons(battle).lasers[0]?.storedEnergy;
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    battle.advance(60);
    expect(weapons(battle).lasers[0]).toMatchObject({ storedEnergy: charge, firing: false });
    const before = battle.observe('blue').ownShip.energyLedger.beamEmitted;
    fire(battle);
    battle.advance(7.5);
    expect(weapons(battle).lasers[0]?.firing).toBe(false);
    battle.advance(1);
    expect(battle.observe('blue').ownShip.energyLedger.beamEmitted - before).toBeCloseTo(
      16 * TEST_LASER.beamPower,
      -2,
    );
  });

  it('retains partial charge on leaving range and draws no further power', () => {
    const design = armedTestDesign();
    const setup = duelSetup(design, target(), effectiveRange(TEST_LASER) - 500);
    const battle = createBattle({
      ...setup,
      scenario: {
        ...setup.scenario,
        starts: setup.scenario.starts.map((start, i) =>
          i === 1 ? { ...start, velocity: vec3(1000, 0, 0) } : start,
        ),
      },
    });
    fire(battle);
    battle.advance(2);
    const ship = battle.observe('blue').ownShip;
    expect(ship.weapons.lasers[0]?.charge).toBeGreaterThan(0);
    expect(ship.weapons.lasers[0]?.charge).toBeLessThan(1);
    expect(ship.weapons.lasers[0]?.beamPower).toBe(0);
    expect(ship.power.systems.weapons.demand).toBe(0);
    expect(ship.weapons.readiness[0]?.status).toBe('waiting-range');
  });

  it.each(['lance', 'bastion'])(
    '%s cannot destroy an intact stock armoured ship with its first burst',
    (attacker) => {
      for (const defender of ['lance', 'bastion', 'bulwark']) {
        for (const range of [1_000e3, 10_000e3, 50_000e3, 100_000e3]) {
          for (const seed of [1, 7, 42]) {
            const design = handMadeDesign(attacker);
            const battle = createBattle({
              ...duelSetup(design, handMadeDesign(defender), range),
              seed,
            });
            fire(battle);
            battle.advance(17); // Includes the whole first shot arriving, even at 100,000 km.
            expect(
              battle.outcome,
              `${attacker} vs ${defender}, ${range} m, seed ${seed}`,
            ).toBeNull();
            const rated = designComponentsOfType(design, 'laser').reduce(
              (sum, laser) => sum + laser.beamPower,
              0,
            );
            const emitted = battle.observe('blue').ownShip.energyLedger.beamEmitted;
            expect(emitted).toBeGreaterThan(0);
            expect(emitted).toBeLessThanOrEqual(16 * rated + 1);
            expect(
              battle.observe('red').ownShip.sections.every((section) => section.structure > 0),
            ).toBe(true);
          }
        }
      }
    },
  );
});
