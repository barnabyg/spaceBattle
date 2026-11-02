import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { createBattle, type Battle, type OwnShipObservation } from './battle';
import { designComponent, type Design } from './design';
import { OVERHEAT_TEMPERATURE, BASE_TEMPERATURE } from './heat';
import type { PowerSystem } from './power';
import {
  duelSetup,
  TEST_LASER,
  testDesign,
  testSetup,
  testSides,
  withComponent,
  withSection,
} from './testing';

const MINUTE = 60;
const GW = 1e9;

const battleWith = (blue: Design) =>
  createBattle(testSetup({ sides: testSides([blue, testDesign()]) }));

const own = (battle: Battle): OwnShipObservation => battle.observe('blue').ownShip;

/** The terms on each side sum to the same, within a part in 10⁹ of their sizes. */
const expectBalanced = (left: readonly number[], right: readonly number[]) => {
  const sum = (terms: readonly number[]) => terms.reduce((a, b) => a + b, 0);
  const size = sum([...left, ...right].map(Math.abs));
  expect(Math.abs(sum(left) - sum(right))).toBeLessThanOrEqual(1e-9 * Math.max(size, 1));
};

/** A frigate whose reactor cannot run its drive at full throttle on its own. */
const weakReactor = (): Design =>
  withComponent(withComponent(testDesign(), 'reactor', { output: 1 * GW }), 'capacitor', {
    capacity: 20 * GW,
    maxCharge: 0.3 * GW,
  });

/** Checks a ship's energy ledger balances against what it held at the start. */
const ledgerChecker = (battle: Battle, design: Design, side = 'blue') => {
  const start = battle.observe(side).ownShip;
  return () => {
    const now = battle.observe(side).ownShip;
    const { delivered, ...ledger } = now.energyLedger;
    const stored = [now.power.stored, -start.power.stored];
    const heat = [now.heat.heat, -start.heat.heat];
    // Electrical energy: what the reactor made is now stored, was lost with damaged capacitors,
    // or was delivered to a system.
    expectBalanced(
      [ledger.reactorGenerated],
      [...stored, ledger.capacitorLost, delivered.drive, delivered.shields, delivered.weapons],
    );
    expectBalanced(stored, [
      ledger.capacitorCharged,
      -ledger.capacitorDischarged,
      -ledger.capacitorLost,
    ]);
    // The reactor's waste and whatever the systems did not send elsewhere became heat.
    const efficiency = designComponent(design, 'reactor').efficiency;
    expectBalanced([ledger.reactorHeat * efficiency], [ledger.reactorGenerated * (1 - efficiency)]);
    expectBalanced(
      [ledger.driveExhaust],
      [delivered.drive * (1 - designComponent(design, 'drive').wasteHeatFraction)],
    );
    expectBalanced(
      [ledger.heatGenerated],
      [
        ledger.reactorHeat,
        delivered.drive,
        -ledger.driveExhaust,
        delivered.shields,
        delivered.weapons,
        -ledger.beamEmitted,
      ],
    );
    // Heat: what came in less what was radiated away is what the ship now holds.
    expectBalanced([ledger.heatGenerated, -ledger.heatRadiated], heat);
    expectBalanced([now.heat.heat], [now.heat.heatCapacity * now.heat.temperature]);
  };
};

describe('power and heat', () => {
  it('conserves energy across reactor, capacitor, consumers and heat', () => {
    const design = withComponent(weakReactor(), 'radiator', { retractedArea: 500 });
    const battle = battleWith(design);
    const check = ledgerChecker(battle, design);

    // A full burn drains the capacitors, then overheats; then they recharge with the radiators out.
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 10 * MINUTE });
    battle.advance(MINUTE);
    check();
    expect(own(battle).energyLedger.capacitorDischarged).toBeGreaterThan(0);
    battle.advance(9 * MINUTE);
    check();
    expect(own(battle).heat.temperature).toBeGreaterThan(OVERHEAT_TEMPERATURE);
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    battle.advance(10 * MINUTE);
    check();
    const end = own(battle);
    expect(end.energyLedger.capacitorCharged).toBeGreaterThan(0);
    expect(end.energyLedger.heatRadiated).toBeGreaterThan(0);
    expect(end.energyLedger.driveExhaust).toBeGreaterThan(0);
  });

  it('keeps the books while lasers fire and damaged capacitors lose their charge', () => {
    // A laser at the back survives while the beams work through the nose to the capacitor.
    const design = withSection(testDesign(), 'engine', { mounts: [TEST_LASER] });
    const battle = createBattle(duelSetup(design, design, 20_000e3));
    const checks = (['blue', 'red'] as const).map((side) => {
      battle.giveOrder(side, {
        type: 'weapons',
        target: side === 'blue' ? 'red' : 'blue',
        mode: 'fire-freely',
      });
      battle.giveOrder(side, { type: 'burn', throttle: 1, duration: MINUTE });
      battle.giveOrder(side, { type: 'radiators', deployed: true });
      return ledgerChecker(battle, design, side);
    });
    for (let minute = 0; minute < 10; minute++) {
      battle.advance(MINUTE);
      for (const check of checks) check();
    }
    const { energyLedger } = own(battle);
    expect(energyLedger.beamEmitted).toBeGreaterThan(0);
    expect(energyLedger.hitEnergy).toBeGreaterThan(0);
    expect(energyLedger.capacitorLost).toBeGreaterThan(0);
  });

  it.each(['lance', 'bastion'])(
    'throttles a long burn in %s with radiators retracted but sustains it with them deployed',
    (id) => {
      const design = handMadeDesign(id);
      const { thrust } = designComponent(design, 'drive');

      const retracted = battleWith(design);
      retracted.giveOrder('blue', { type: 'burn', throttle: 1, duration: 60 * MINUTE });
      retracted.step();
      expect(own(retracted).thrust).toBeCloseTo(thrust);
      expect(own(retracted).heat.temperature).toBeCloseTo(BASE_TEMPERATURE, 0);
      let throttledAt = Infinity;
      while (retracted.time < 30 * MINUTE) {
        retracted.advance(10);
        if (own(retracted).thrust < thrust * 0.99) {
          throttledAt = Math.min(throttledAt, retracted.time);
        }
      }
      // Overheating within a few minutes, the drive is held well back.
      expect(throttledAt).toBeGreaterThan(2 * MINUTE);
      expect(throttledAt).toBeLessThan(10 * MINUTE);
      const hot = own(retracted);
      expect(hot.heat.temperature).toBeGreaterThan(OVERHEAT_TEMPERATURE);
      expect(hot.power.driveLimit).toBeLessThan(0.5);
      expect(hot.thrust).toBeLessThan(thrust * 0.5);

      const deployed = battleWith(design);
      deployed.giveOrder('blue', { type: 'radiators', deployed: true });
      deployed.giveOrder('blue', { type: 'burn', throttle: 1, duration: 60 * MINUTE });
      while (deployed.time < 30 * MINUTE) {
        deployed.advance(10);
        expect(own(deployed).thrust).toBeCloseTo(thrust);
      }
      expect(own(deployed).heat.temperature).toBeLessThan(OVERHEAT_TEMPERATURE);
    },
  );

  it('cools an overheated ship once its radiators deploy, giving the drive back', () => {
    const design = handMadeDesign('lance');
    const battle = battleWith(design);
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 60 * MINUTE });
    battle.advance(15 * MINUTE);
    const hot = own(battle);
    expect(hot.heat.radiatorsDeployed).toBe(false);
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    battle.advance(MINUTE);
    const cooling = own(battle);
    expect(cooling.heat.radiatorsDeployed).toBe(true);
    expect(cooling.heat.radiatorArea).toBeGreaterThan(hot.heat.radiatorArea);
    expect(cooling.heat.temperature).toBeLessThan(hot.heat.temperature);
    battle.advance(10 * MINUTE);
    expect(own(battle).thrust).toBeCloseTo(designComponent(design, 'drive').thrust);
  });

  it('starves the lowest-priority system first when demand exceeds supply', () => {
    const design = weakReactor();
    const drive = designComponent(design, 'drive');
    const battle = battleWith(design);
    // Drain the capacitors with a full burn, stored energy topping up the reactor.
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 120 });
    battle.advance(120);
    expect(own(battle).power.stored).toBeLessThan(1e6);

    // The drive at half throttle wants 0.75 GW and the capacitors 0.3 GW of a 1 GW reactor.
    battle.giveOrder('blue', { type: 'burn', throttle: 0.5, duration: 600 });
    const rank = (priorities: PowerSystem[]) => {
      battle.giveOrder('blue', { type: 'power', priorities });
      battle.advance(10);
      return own(battle);
    };

    const driveFirst = rank(['drive', 'shields', 'weapons', 'capacitors']);
    expect(driveFirst.power.systems.drive.supplied).toBeCloseTo(0.75 * GW, -3);
    expect(driveFirst.power.systems.capacitors.demand).toBeCloseTo(0.3 * GW, -3);
    expect(driveFirst.power.systems.capacitors.supplied).toBeCloseTo(0.25 * GW, -3);
    expect(driveFirst.thrust).toBeCloseTo(0.5 * drive.thrust);

    const capacitorsFirst = rank(['capacitors', 'drive', 'shields', 'weapons']);
    expect(capacitorsFirst.power.systems.capacitors.supplied).toBeCloseTo(0.3 * GW, -3);
    expect(capacitorsFirst.power.systems.drive.demand).toBeCloseTo(0.75 * GW, -3);
    expect(capacitorsFirst.power.systems.drive.supplied).toBeCloseTo(0.7 * GW, -3);
    expect(capacitorsFirst.thrust).toBeCloseTo((0.7 / 1.5) * drive.thrust);
    expect(capacitorsFirst.power.reactorOutput).toBeCloseTo(1 * GW, -3);
  });

  it('lets only systems ranked above the capacitors draw on stored energy', () => {
    const design = weakReactor();
    const drive = designComponent(design, 'drive');
    const battle = battleWith(design);
    battle.giveOrder('blue', {
      type: 'power',
      priorities: ['capacitors', 'drive', 'shields', 'weapons'],
    });
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 60 });
    battle.advance(10);
    const held = own(battle);
    expect(held.power.stored).toBeCloseTo(held.power.storageCapacity);
    expect(held.thrust).toBeCloseTo(drive.thrust / 1.5);

    battle.giveOrder('blue', {
      type: 'power',
      priorities: ['drive', 'shields', 'weapons', 'capacitors'],
    });
    battle.advance(10);
    const drawing = own(battle);
    expect(drawing.thrust).toBeCloseTo(drive.thrust);
    expect(drawing.power.discharge).toBeCloseTo(0.5 * GW, -3);
    expect(drawing.power.stored).toBeLessThan(held.power.stored);
  });

  it('takes power and radiator orders while the battle is not advancing', () => {
    const battle = battleWith(testDesign());
    const priorities: PowerSystem[] = ['weapons', 'capacitors', 'drive', 'shields'];
    battle.giveOrder('blue', { type: 'power', priorities });
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    expect(own(battle).power.priorities).toEqual(priorities);
    expect(own(battle).heat.radiatorsDeployed).toBe(true);
  });

  it('rejects a power order that does not rank every system once', () => {
    const battle = battleWith(testDesign());
    expect(() => {
      battle.giveOrder('blue', { type: 'power', priorities: ['drive', 'shields', 'weapons'] });
    }).toThrow();
    expect(() => {
      battle.giveOrder('blue', {
        type: 'power',
        priorities: ['drive', 'drive', 'weapons', 'capacitors'],
      });
    }).toThrow();
  });
});
