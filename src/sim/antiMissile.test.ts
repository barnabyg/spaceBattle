import { describe, expect, it } from 'vitest';
import {
  createBattle,
  type Battle,
  type BattleEvent,
  type MissileObservation,
  type OwnShipObservation,
} from './battle';
import type { MissileDesign } from './design';
import {
  antiMissileTestDesign,
  defendedTestDesign,
  duelSetup,
  launchingTestDesign,
  missileMagazine,
  TEST_ANTI_MISSILE_MISSILE,
  TEST_LAUNCHER,
  TEST_MISSILE,
  testDesign,
  withSection,
} from './testing';

const KM = 1000;

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const missilesInFlight = (battle: Battle): MissileObservation[] =>
  battle.observe('blue').munitions.flatMap((m) => (m.kind === 'missile' ? [m] : []));

const ofType = <T extends BattleEvent['type']>(events: readonly BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

/** Steps until no missile is in flight or the battle is over, returning what happened. */
const untilMissilesGone = (battle: Battle, limit: number): BattleEvent[] => {
  // The first step launches.
  const events: BattleEvent[] = [...battle.step()];
  while (missilesInFlight(battle).length > 0 && !battle.outcome) {
    if (battle.time > limit) throw new Error('Missiles still in flight');
    events.push(...battle.step());
  }
  return events;
};

/** An anti-missile missile with its fragmentation warhead changed. */
const antiMissileWith = (
  changes: Partial<{ fragments: number; burstDistance: number }>,
): MissileDesign => {
  const { warhead } = TEST_ANTI_MISSILE_MISSILE;
  if (warhead.type !== 'fragmentation') throw new Error('Not a fragmentation warhead');
  return { ...TEST_ANTI_MISSILE_MISSILE, warhead: { ...warhead, ...changes } };
};

/**
 * Blue launches a salvo of `missiles` test missiles at red, 1,000 km away, which carries
 * anti-missile missiles; the battle and what happened until no missile was left in flight.
 */
const salvoAtDefender = (
  missiles: number,
  defender = antiMissileTestDesign(),
  setUp: (battle: Battle) => void = () => undefined,
) => {
  const battle = createBattle(
    duelSetup(launchingTestDesign(missiles, { launchers: missiles }), defender, 1_000 * KM),
  );
  setUp(battle);
  battle.giveOrder('blue', { type: 'launch', target: 'red', missiles });
  return { battle, events: untilMissilesGone(battle, 2_000) };
};

describe('anti-missile missiles', () => {
  it('show automatic defence, on from the start, and each missile design with its role', () => {
    const battle = createBattle(
      duelSetup(antiMissileTestDesign({ antiMissiles: 6, missiles: 2 }), testDesign(), 1_000 * KM),
    );
    const { weapons } = own(battle, 'blue');
    expect(weapons.antiMissile).toEqual({ automatic: true, engagements: [] });
    expect(weapons.ammunition).toMatchObject({ missiles: 8, missileCapacity: 8 });
    expect(weapons.ammunition.missileDesigns).toMatchObject([
      {
        name: TEST_ANTI_MISSILE_MISSILE.name,
        warhead: 'fragmentation',
        role: 'anti-missile',
        missiles: 6,
        capacity: 6,
      },
      { name: TEST_MISSILE.name, warhead: 'kinetic', role: 'anti-ship', missiles: 2, capacity: 2 },
    ]);
    battle.giveOrder('blue', { type: 'anti-missile', automatic: false });
    expect(own(battle, 'blue').weapons.antiMissile.automatic).toBe(false);
  });

  it('can destroy an incoming missile', () => {
    const { battle, events } = salvoAtDefender(1);
    const [missile] = ofType(events, 'launch').filter((e) => e.attacker === 'blue');
    const defence = ofType(events, 'launch').filter((e) => e.attacker === 'red');
    // Automatic defence launches one anti-missile missile at it, which brings it down short of
    // the ship.
    expect(defence).toHaveLength(1);
    expect(defence[0]).toMatchObject({
      target: { munition: missile?.munition },
      section: 'forward',
      mount: 0,
    });
    const intercepts = ofType(events, 'intercept');
    expect(intercepts).toHaveLength(1);
    expect(intercepts[0]).toMatchObject({
      side: 'red',
      attacker: 'blue',
      munition: missile?.munition,
      antiMissile: defence[0]?.munition,
      warhead: 'kinetic',
      weapon: 'anti-missile-missile',
      section: 'forward',
      mount: 0,
    });
    expect(intercepts[0]?.chance).toBeGreaterThan(0.5);
    expect(intercepts[0]?.chance).toBeLessThan(1);
    expect(intercepts[0]?.distance).toBeGreaterThan(10 * KM);
    expect(ofType(events, 'impact')).toEqual([]);
    // Both sides hear of it, and red counts the kill and the missile spent.
    expect(battle.observe('blue').events.some((e) => e.type === 'intercept')).toBe(true);
    const red = own(battle, 'red').weapons;
    expect(red.intercepts).toBe(1);
    expect(red.ammunition.missileDesigns[0]?.missiles).toBe(3);
    expect(red.antiMissile.engagements).toEqual([]);
  });

  it('engage each incoming missile with one anti-missile missile, as launchers come free', () => {
    const battle = createBattle(
      duelSetup(
        launchingTestDesign(3, { launchers: 3 }),
        antiMissileTestDesign({ antiMissiles: 10, launchers: 2 }),
        1_000 * KM,
      ),
    );
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 3 });
    battle.advance(5);
    const incoming = missilesInFlight(battle).filter((m) => m.attacker === 'blue');
    const { engagements } = own(battle, 'red').weapons.antiMissile;
    // Two launchers take the first two at once; the third waits for a launcher to reload.
    expect(engagements).toHaveLength(2);
    battle.advance(10);
    const later = own(battle, 'red').weapons.antiMissile.engagements;
    expect(later.map((e) => e.target).sort()).toEqual(incoming.map((m) => m.id).sort());
    for (const { antiMissile } of later) {
      const flying = missilesInFlight(battle).find((m) => m.id === antiMissile);
      expect(flying).toMatchObject({ attacker: 'red', role: 'anti-missile' });
    }
    expect(own(battle, 'red').weapons.ammunition.missileDesigns[0]?.missiles).toBe(7);
  });

  it('launch only by order with automatic defence off, at the missile ordered', () => {
    const battle = createBattle(
      duelSetup(launchingTestDesign(1), antiMissileTestDesign(), 1_000 * KM),
    );
    battle.giveOrder('red', { type: 'anti-missile', automatic: false });
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    expect(ofType(battle.advance(5), 'launch').filter((e) => e.attacker === 'red')).toEqual([]);
    const [missile] = missilesInFlight(battle);
    if (!missile) throw new Error('No missile in flight');
    battle.giveOrder('red', { type: 'launch', target: { munition: missile.id }, missiles: 1 });
    expect(own(battle, 'red').weapons.salvo).toEqual({
      target: { munition: missile.id },
      remaining: 1,
      missile: TEST_ANTI_MISSILE_MISSILE.name,
    });
    const events = untilMissilesGone(battle, 2_000);
    expect(ofType(events, 'launch')).toMatchObject([
      { attacker: 'red', target: { munition: missile.id } },
    ]);
    expect(ofType(events, 'intercept')).toMatchObject([
      { side: 'red', munition: missile.id, weapon: 'anti-missile-missile' },
    ]);
  });

  it('carried beside anti-ship missiles, leave those for ships and defend against missiles', () => {
    const battle = createBattle(
      duelSetup(
        antiMissileTestDesign({ antiMissiles: 4, missiles: 2 }),
        launchingTestDesign(1),
        1_000 * KM,
      ),
    );
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    expect(own(battle, 'blue').weapons.salvo?.missile).toBe(TEST_MISSILE.name);
    battle.step();
    expect(missilesInFlight(battle)).toMatchObject([
      { attacker: 'blue', target: 'red', name: TEST_MISSILE.name, role: 'anti-ship' },
    ]);
    // Red's missile comes in once blue's launcher has reloaded; blue defends against it.
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    battle.advance(15);
    const blues = missilesInFlight(battle).filter((m) => m.attacker === 'blue');
    expect(blues.map((m) => m.role).sort()).toEqual(['anti-missile', 'anti-ship']);
    // A launch order may name the missile design to launch.
    battle.giveOrder('blue', {
      type: 'launch',
      target: 'red',
      missiles: 1,
      missile: TEST_MISSILE.name,
    });
    expect(own(battle, 'blue').weapons.salvo?.missile).toBe(TEST_MISSILE.name);
  });

  it('refuse launch orders their missiles cannot carry out', () => {
    const battle = createBattle(
      duelSetup(antiMissileTestDesign(), launchingTestDesign(2, { launchers: 2 }), 1_000 * KM),
    );
    // Blue carries only anti-missile missiles, which do nothing to ships.
    expect(() => {
      battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    }).toThrow(/no anti-ship missiles/);
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    battle.step();
    const [missile] = missilesInFlight(battle);
    if (!missile) throw new Error('No missile in flight');
    // Red's anti-ship missiles cannot go after a missile, nor its own.
    expect(() => {
      battle.giveOrder('red', { type: 'launch', target: { munition: missile.id }, missiles: 1 });
    }).toThrow(/enemy missile/);
    expect(() => {
      battle.giveOrder('blue', {
        type: 'launch',
        target: { munition: missile.id },
        missiles: 1,
        missile: 'Nonesuch',
      });
    }).toThrow(/Nonesuch/);
    expect(() => {
      battle.giveOrder('blue', { type: 'launch', target: { munition: 999 }, missiles: 1 });
    }).toThrow(/enemy missile in flight/);
    // An anti-missile missile cannot go after another.
    const other = createBattle(
      duelSetup(antiMissileTestDesign(), antiMissileTestDesign({ missiles: 2 }), 1_000 * KM),
    );
    other.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    other.advance(1);
    const blueAntiMissile = missilesInFlight(other).find((m) => m.attacker === 'blue');
    if (!blueAntiMissile) throw new Error('No anti-missile missile in flight');
    expect(() => {
      other.giveOrder('red', {
        type: 'launch',
        target: { munition: blueAntiMissile.id },
        missiles: 1,
      });
    }).toThrow(/enemy missile/);
  });

  it('never strike ships, and point defence leaves them alone', () => {
    // Red, close by, launches at blue and defends with anti-missile missiles; blue's point
    // defence fires on red's missile, never on the anti-missile missile chasing it.
    const launchingAndDefended = withSection(defendedTestDesign({ mounts: 2 }), 'forward', {
      components: [
        ...(defendedTestDesign().sections[0]?.components ?? []),
        missileMagazine(1),
        missileMagazine(1, TEST_ANTI_MISSILE_MISSILE),
      ],
      mounts: [TEST_LAUNCHER, TEST_LAUNCHER],
    });
    const battle = createBattle(duelSetup(antiMissileTestDesign(), launchingAndDefended, 30 * KM));
    // Blue launches by order at red's missile, so its anti-missile missile chases it in towards
    // red; red's point defence must not fire on it.
    battle.giveOrder('blue', { type: 'anti-missile', automatic: false });
    battle.giveOrder('red', { type: 'anti-missile', automatic: false });
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    battle.step();
    const [missile] = missilesInFlight(battle);
    if (!missile) throw new Error('No missile in flight');
    battle.giveOrder('blue', { type: 'launch', target: { munition: missile.id }, missiles: 1 });
    const events: BattleEvent[] = [];
    while (missilesInFlight(battle).length > 0) {
      if (battle.time > 600) throw new Error('Missiles still in flight');
      events.push(...battle.step());
      for (const gun of own(battle, 'red').weapons.pointDefence) {
        expect(gun.engaging).toBeNull();
      }
    }
    expect(ofType(events, 'impact').filter((e) => e.target === 'red')).toEqual([]);
    expect(ofType(events, 'launch')).toHaveLength(1);
  });

  it('have less chance of bringing a missile down the further from it they burst', () => {
    const firstBurst = (antiMissile: MissileDesign) => {
      const { events } = salvoAtDefender(1, antiMissileTestDesign({ antiMissile }));
      const [burst] = events.flatMap((e) =>
        e.type === 'intercept' || e.type === 'miss' ? [e] : [],
      );
      if (!burst) throw new Error('No burst');
      return burst.chance;
    };
    const near = firstBurst(antiMissileWith({ burstDistance: 100 }));
    const far = firstBurst(antiMissileWith({ burstDistance: 300 }));
    const sparse = firstBurst(antiMissileWith({ fragments: 1_000 }));
    expect(far).toBeLessThan(near);
    expect(sparse).toBeLessThan(near);
    // Expected hits fall with the square of the distance and rise with the fragments.
    expect(Math.log(1 - far) / Math.log(1 - near)).toBeCloseTo(1 / 9, 1);
    expect(Math.log(1 - sparse) / Math.log(1 - near)).toBeCloseTo(1 / 10, 1);
  });

  it('that miss are spent, and automatic defence launches another', () => {
    const { events } = salvoAtDefender(
      1,
      antiMissileTestDesign({ antiMissile: antiMissileWith({ fragments: 1 }) }),
    );
    const misses = ofType(events, 'miss');
    expect(misses.length).toBeGreaterThan(0);
    expect(misses[0]).toMatchObject({ side: 'red', attacker: 'blue' });
    expect(misses[0]?.chance).toBeLessThan(0.01);
    expect(misses[0]?.distance).toBeCloseTo(100, 0);
    const defence = ofType(events, 'launch').filter((e) => e.attacker === 'red');
    expect(defence.length).toBeGreaterThan(misses.length - 1);
    expect(defence.length).toBeGreaterThan(1);
  });
});
