import { describe, expect, it } from 'vitest';
import {
  createBattle,
  type Battle,
  type BattleSetup,
  type ContactObservation,
  type SideSetup,
} from './battle';
import { createComputerCaptain } from './captain';
import type { Design, SensorDesign } from './design';
import type { Order } from './orders';
import {
  duelSetup,
  gunnedTestDesign,
  TEST_LASER,
  TEST_SENSOR,
  testDesign,
  withComponent,
  withSection,
} from './testing';

const KM = 1000;

/** The test design with its sensor changed. */
const withSensor = (design: Design, sensor: Partial<SensorDesign>): Design =>
  withComponent(design, 'sensor', sensor);

/** Red, with the test laser on its nose: an 80 m frigate, a 20 m nose and a 5 m turret. */
const ARMED_RED = withSection(testDesign(), 'forward', { mounts: [TEST_LASER] });

const sideOf = (setup: BattleSetup, id: string): SideSetup => {
  const side = setup.sides.find((s) => s.id === id);
  if (!side) throw new Error(`No side ${id}`);
  return side;
};

const contactOf = (battle: Battle, viewer = 'blue'): ContactObservation => {
  const contact = battle.observe(viewer).contacts[0];
  if (!contact) throw new Error('No contact');
  return contact;
};

/** What blue, with `blue`'s sensor, makes out of red at a range. */
const seenAt = (blue: Design, range: number, red: Design = ARMED_RED) =>
  contactOf(createBattle(duelSetup(blue, red, range)));

const aimAt = (aim: { section: 'forward' | 'middle' | 'engine'; mount: number | null }): Order => ({
  type: 'weapons',
  target: 'red',
  mode: 'fire-freely',
  aim,
});

describe('sensors and contacts', () => {
  it("always know a contact's position and motion, and make out more of it as range closes", () => {
    const far = seenAt(testDesign(), 10_000_000 * KM);
    expect(far.detail).toBe('position');
    expect(far.orientation).toBeNull();
    expect(far.hullSize).toBeNull();
    expect(far.sections).toEqual([]);
    expect(far.mounts).toEqual([]);
    expect(far.appearance.outline).toEqual([]);
    expect(far.position).toEqual({ x: 10_000_000 * KM, y: 0, z: 0 });

    const near = seenAt(testDesign(), 1_000 * KM);
    expect(near.detail).toBe('mounts');
    expect(near.hullSize).toBe('frigate');
    expect(near.sections.map((s) => s.kind)).toEqual(['forward', 'middle', 'engine']);
    expect(near.mounts.map((m) => m.component.type).sort()).toEqual([
      'laser',
      'radiator',
      'sensor',
    ]);
  });

  it('resolve detail of 1.22·λ·r/D, so a larger aperture makes out the same detail proportionally further off', () => {
    const small = withSensor(testDesign(), { aperture: 2 });
    const large = withSensor(testDesign(), { aperture: 4 });
    const range = 7_000 * KM;
    expect(seenAt(small, range).resolution).toBeCloseTo((1.22 * 500e-9 * range) / 2, 6);
    expect(seenAt(large, 2 * range).resolution).toBeCloseTo(seenAt(small, range).resolution, 6);

    const laserSeen = (contact: ContactObservation) =>
      contact.mounts.some((m) => m.component.type === 'laser');
    // The 5 m turret needs two details of 2.5 m across it: out to 8,200 km with a 2 m mirror.
    expect(laserSeen(seenAt(small, 8_000 * KM))).toBe(true);
    expect(laserSeen(seenAt(small, 8_400 * KM))).toBe(false);
    expect(laserSeen(seenAt(large, 16_000 * KM))).toBe(true);
    expect(laserSeen(seenAt(large, 16_800 * KM))).toBe(false);
  });

  it('let the weapons aim at a section or mount only once it is made out', () => {
    const blue = withSection(testDesign(), 'forward', { mounts: [TEST_LASER, TEST_SENSOR] });
    // At 50,000 km blue's sensor makes out red's 40 m middle section but not its 20 m nose.
    const battle = createBattle(duelSetup(blue, ARMED_RED, 50_000 * KM));
    expect(contactOf(battle).sections.map((s) => s.kind)).toEqual(['middle']);
    expect(() => {
      battle.giveOrder('blue', aimAt({ section: 'forward', mount: null }));
    }).toThrow(/make out/);
    expect(() => {
      battle.giveOrder('blue', aimAt({ section: 'forward', mount: 0 }));
    }).toThrow(/make out/);
    battle.giveOrder('blue', aimAt({ section: 'middle', mount: null }));
    expect(battle.observe('blue').ownShip.weapons.aim).toEqual({ section: 'middle', mount: null });

    // Close in, it makes out the laser turret on red's nose, aims at it and wrecks it.
    const close = createBattle(duelSetup(blue, ARMED_RED, 1_000 * KM));
    close.giveOrder('blue', aimAt({ section: 'forward', mount: 0 }));
    const events = close.advance(60);
    const hits = events.filter((e) => e.type === 'hit' && e.attacker === 'blue');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.type === 'hit' && e.mount === 0)).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'component-lost', side: 'red', component: 'laser' }),
    );
  });

  it('track less precisely with a poorer sensor, so slugs fired from far off hit less often', () => {
    /** The share of 100 slugs fired from 15,000 km at a ship sitting still that hit it. */
    const hitRate = (trackingError: number) => {
      const blue = withSensor(gunnedTestDesign(100), { trackingError });
      const battle = createBattle(duelSetup(blue, testDesign(), 15_000 * KM));
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      const hits = battle
        .advance(1_200)
        .filter((e) => e.type === 'impact' && e.munition === 'slug').length;
      return hits / 100;
    };
    expect(hitRate(1e-10)).toBe(1);
    expect(hitRate(5e-7)).toBeLessThan(0.6);
  });

  it("leave the computer captain only what its sensors make out of the enemy's design", () => {
    /** Blue's orders, the computer commanding it, against red armed with `laser`, red idle. */
    const orders = (laser: typeof TEST_LASER, range: number) => {
      const red = withSection(testDesign(), 'forward', { mounts: [laser] });
      const blue = withSection(testDesign(), 'forward', { mounts: [TEST_LASER] });
      const setup = duelSetup(blue, red, range);
      const battle = createBattle(setup);
      const captain = createComputerCaptain(sideOf(setup, 'blue'));
      return captain.decide(battle.observe('blue'));
    };
    // Red's lasers differ only in power, which sets how far they reach.
    const weak = { ...TEST_LASER, beamPower: 100e6 };
    const strong = { ...TEST_LASER, beamPower: 1_600e6 };
    // Too far off to make out red's laser, blue does the same whichever red carries...
    expect(orders(weak, 50_000 * KM)).toStrictEqual(orders(strong, 50_000 * KM));
    // ...but once its sensor makes the laser out, it knows how far it reaches.
    expect(orders(weak, 5_000 * KM)).not.toStrictEqual(orders(strong, 5_000 * KM));
  });
});
