import { describe, expect, it } from 'vitest';
import { createBattle } from './battle';
import { vec3 } from './vector';
import {
  duelSetup,
  testDesign,
  TEST_LASER,
  TEST_KINETIC_GUN,
  testMagazine,
  withSection,
  withComponent,
  launchingTestDesign,
  TEST_POINT_DEFENCE,
} from './testing';

const mixedDesign = () =>
  withSection(testDesign(), 'forward', {
    mounts: [TEST_LASER, TEST_KINETIC_GUN],
    components: [testMagazine(10)],
  });

describe('weapon range information', () => {
  it('reports each weapon range independently of holding fire', () => {
    const battle = createBattle(duelSetup(mixedDesign(), testDesign(), 30_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    const weapons = battle.observe('blue').ownShip.weapons;
    expect(weapons.targetRange).toBe(30_000e3);
    expect(weapons.readiness).toEqual([
      expect.objectContaining({ kind: 'laser', mount: 0, inRange: true, status: 'hold-fire' }),
      expect.objectContaining({
        kind: 'kinetic-gun',
        mount: 1,
        inRange: false,
        status: 'hold-fire',
      }),
    ]);
  });

  it('keeps an empty gun in range and reports its missing ammunition', () => {
    const design = withComponent(mixedDesign(), 'magazine', { slugs: 0 });
    const battle = createBattle(duelSetup(design, testDesign(), 10_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    expect(battle.observe('blue').ownShip.weapons.readiness[1]).toMatchObject({
      inRange: true,
      status: 'no-ammunition',
    });
  });

  it('reports loss of power independently of beam range', () => {
    const design = withComponent(
      withComponent(mixedDesign(), 'reactor', { output: 0 }),
      'capacitor',
      { capacity: 0, maxDischarge: 0 },
    );
    const battle = createBattle(duelSetup(design, testDesign(), 10_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(1);
    expect(battle.observe('blue').ownShip.weapons.readiness[0]).toMatchObject({
      inRange: true,
      status: 'no-power',
    });
  });

  it('shows missile reach as an estimate without preventing a longer launch', () => {
    const battle = createBattle(duelSetup(launchingTestDesign(4), testDesign(), 40_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    expect(battle.observe('blue').ownShip.weapons.readiness[0]).toMatchObject({
      kind: 'launcher',
      missile: 'Test missile',
      rangeKind: 'estimate',
      inRange: false,
      status: 'by-order',
    });
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    battle.advance(0.1);
    expect(battle.observe('blue').ownShip.weapons.readiness[0]?.status).toBe('reloading');
  });

  it('distinguishes a nominally in-range gun from a target it cannot intercept', () => {
    const setup = duelSetup(mixedDesign(), testDesign(), 10_000e3);
    const battle = createBattle({
      ...setup,
      scenario: {
        ...setup.scenario,
        starts: setup.scenario.starts.map((start, i) =>
          i === 1 ? { ...start, velocity: vec3(100_000, 0, 0) } : start,
        ),
      },
    });
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    expect(battle.observe('blue').ownShip.weapons.readiness[1]).toMatchObject({
      inRange: true,
      status: 'no-solution',
    });
  });

  it('identifies point defence instead of claiming an anti-ship range', () => {
    const battle = createBattle(
      duelSetup(
        withSection(mixedDesign(), 'engine', { mounts: [TEST_POINT_DEFENCE] }),
        testDesign(),
        10_000,
      ),
    );
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    expect(
      battle.observe('blue').ownShip.weapons.readiness.find((r) => r.kind === 'point-defence'),
    ).toMatchObject({ rangeKind: 'defensive', inRange: null, status: 'defensive' });
  });

  it('updates the full three-dimensional separation as a gun enters and leaves range', () => {
    const setup = duelSetup(mixedDesign(), testDesign(), 0);
    const battle = createBattle({
      ...setup,
      scenario: {
        ...setup.scenario,
        starts: setup.scenario.starts.map((start, i) =>
          i === 1
            ? { ...start, position: vec3(0, 0, 21_000e3), velocity: vec3(0, 0, -10_000) }
            : start,
        ),
      },
    });
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    expect(battle.observe('blue').ownShip.weapons.readiness[1]?.inRange).toBe(false);
    battle.advance(200);
    expect(battle.observe('blue').ownShip.weapons.targetRange).toBeCloseTo(19_000e3, 0);
    expect(battle.observe('blue').ownShip.weapons.readiness[1]?.inRange).toBe(true);
    battle.advance(4_000);
    expect(battle.observe('blue').ownShip.weapons.readiness[1]?.inRange).toBe(false);
    battle.giveOrder('blue', { type: 'weapons', target: null, mode: 'hold-fire' });
    expect(battle.observe('blue').ownShip.weapons.targetRange).toBeNull();
    expect(battle.observe('blue').ownShip.weapons.readiness.every((r) => r.inRange === null)).toBe(
      true,
    );
  });

  it('keeps lost weapons listed with their own range, without calling them ready', () => {
    const setup = duelSetup(mixedDesign(), testDesign(), 10_000e3);
    const condition = createBattle(setup).observe('blue').ownShip.condition;
    const battle = createBattle({
      ...setup,
      sides: setup.sides.map((side, i) =>
        i === 0
          ? {
              ...side,
              condition: {
                ...condition,
                integrity: condition.integrity.map((integrity, slot) =>
                  slot === 1 ? 0 : integrity,
                ),
              },
            }
          : side,
      ),
    });
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    expect(battle.observe('blue').ownShip.weapons.readiness[0]).toMatchObject({
      kind: 'laser',
      inRange: true,
      status: 'lost',
    });
  });

  it('reports heat-limited firing separately from range', () => {
    const design = withComponent(mixedDesign(), 'radiator', { retractedArea: 100 });
    const target = withSection(testDesign(), 'forward', {
      armour: { type: 'ablative', thickness: 10 },
    });
    const battle = createBattle(duelSetup(design, target, 30_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(500);
    expect(battle.observe('blue').ownShip.heat.thermalLimit).toBeLessThan(1);
    expect(battle.observe('blue').ownShip.weapons.readiness[0]).toMatchObject({
      inRange: true,
      status: 'heat-limited',
    });
  });
});
