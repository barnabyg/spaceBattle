import { describe, expect, it } from 'vitest';
import {
  createBattle,
  type Battle,
  type BattleEvent,
  type OwnShipObservation,
  type PointDefenceObservation,
} from './battle';
import type { Design } from './design';
import {
  defendedTestDesign,
  duelSetup,
  launchingTestDesign,
  TEST_NUCLEAR_MISSILE,
  TEST_POINT_DEFENCE,
  testDesign,
} from './testing';

const KM = 1000;
const { roundMass, roundsPerBurst, muzzleVelocity, efficiency } = TEST_POINT_DEFENCE;
const BURST_ENERGY = (roundsPerBurst * 0.5 * roundMass * muzzleVelocity ** 2) / efficiency;

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const mount = (battle: Battle, side: string, index = 0): PointDefenceObservation => {
  const found = own(battle, side).weapons.pointDefence[index];
  if (!found) throw new Error(`No point defence mount ${index}`);
  return found;
};

const missilesInFlight = (battle: Battle) =>
  battle.observe('blue').munitions.filter((m) => m.kind === 'missile');

const impactsOn = (events: readonly BattleEvent[], target: string) =>
  events.flatMap((e) => (e.type === 'impact' && e.target === target ? [e] : []));

const interceptsIn = (events: readonly BattleEvent[]) =>
  events.flatMap((e) => (e.type === 'intercept' ? [e] : []));

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

/** Blue launches a salvo of six missiles at red, 2,000 km away, and waits for them to arrive. */
const salvoAt = (red: Design) => {
  const battle = createBattle(duelSetup(launchingTestDesign(6, { launchers: 6 }), red, 2_000 * KM));
  battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 6 });
  return { battle, events: untilMissilesGone(battle, 3_000) };
};

describe('point defence', () => {
  it('shows each mount, its rounds and its priority, missiles first', () => {
    const battle = createBattle(
      duelSetup(defendedTestDesign({ mounts: 2, rounds: 4_000 }), testDesign(), 1_000 * KM),
    );
    const { weapons } = own(battle, 'blue');
    expect(weapons.pointDefencePriority).toBe('missiles');
    expect(weapons.ammunition).toMatchObject({ rounds: 4_000, roundCapacity: 4_000 });
    expect(weapons.intercepts).toBe(0);
    expect(weapons.pointDefence).toHaveLength(2);
    expect(weapons.pointDefence[1]).toMatchObject({
      section: 'middle',
      mount: 2,
      integrity: 1,
      engaging: null,
      charge: 0,
      roundsPerBurst,
      burstRate: TEST_POINT_DEFENCE.burstRate,
      lastChance: null,
    });
    expect(weapons.pointDefence[0]?.burstEnergy).toBeCloseTo(BURST_ENERGY, 0);
    // Its rounds may fly for 5 s at most: 25 km at 5 km/s.
    expect(weapons.pointDefence[0]?.effectiveRange).toBeCloseTo(25 * KM, 0);
  });

  it('reduces the missiles in a salvo that reach the ship', () => {
    const undefended = salvoAt(testDesign());
    expect(impactsOn(undefended.events, 'red')).toHaveLength(6);
    expect(interceptsIn(undefended.events)).toEqual([]);

    const defended = salvoAt(defendedTestDesign({ mounts: 2 }));
    const intercepts = interceptsIn(defended.events);
    const impacts = impactsOn(defended.events, 'red');
    expect(intercepts.length).toBeGreaterThan(0);
    expect(impacts.length).toBeLessThan(6);
    expect(impacts.length + intercepts.length).toBe(6);
    expect(intercepts[0]).toMatchObject({
      side: 'red',
      attacker: 'blue',
      weapon: 'point-defence',
      section: 'middle',
      warhead: 'kinetic',
    });
    for (const intercept of intercepts) {
      expect(intercept.chance).toBeGreaterThan(0);
      expect(intercept.chance).toBeLessThanOrEqual(1);
      // Shot down short of the ship, within the guns' reach.
      expect(intercept.distance).toBeGreaterThan(0);
      expect(intercept.distance).toBeLessThan(25 * KM);
    }
    // Both sides hear of it, and red counts its kills.
    expect(defended.battle.observe('blue').events.some((e) => e.type === 'intercept')).toBe(true);
    expect(own(defended.battle, 'red').weapons.intercepts).toBe(intercepts.length);
    // Each burst took power and rounds.
    const { ammunition } = own(defended.battle, 'red').weapons;
    expect(ammunition.rounds).toBeLessThan(ammunition.roundCapacity);
    expect((ammunition.roundCapacity - ammunition.rounds) % roundsPerBurst).toBe(0);
    expect(own(defended.battle, 'red').energyLedger.slugEnergy).toBeGreaterThan(0);
  });

  it('finds a missile easier to hit the closer it comes', () => {
    const battle = createBattle(duelSetup(launchingTestDesign(1), defendedTestDesign(), 500 * KM));
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    battle.step();
    const chances: number[] = [];
    while (missilesInFlight(battle).length > 0) {
      if (battle.time > 1_000) throw new Error('Missile still in flight');
      battle.step();
      const { lastChance, engaging } = mount(battle, 'red');
      if (engaging?.kind === 'missile' && lastChance !== null && lastChance !== chances.at(-1)) {
        chances.push(lastChance);
      }
    }
    expect(chances.length).toBeGreaterThan(3);
    // At the edge of its reach a burst has little chance; close in, a good one.
    expect(chances[0]).toBeLessThan(0.05);
    expect(Math.max(...chances)).toBeGreaterThan(0.2);
    expect(chances.at(-1)).toBeGreaterThan(chances[0] ?? 1);
  });

  it('prioritised on missiles, ignores the enemy ship even within reach', () => {
    const battle = createBattle(duelSetup(defendedTestDesign(), testDesign(), 10 * KM));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const events = battle.advance(10);
    expect(impactsOn(events, 'red')).toEqual([]);
    expect(mount(battle, 'blue').engaging).toBeNull();
    const { ammunition } = own(battle, 'blue').weapons;
    expect(ammunition.rounds).toBe(ammunition.roundCapacity);
  });

  it('prioritised on missiles then the ship, fires on the targeted ship when no missile is in reach', () => {
    const battle = createBattle(duelSetup(defendedTestDesign(), testDesign(), 10 * KM));
    battle.giveOrder('blue', { type: 'point-defence', priority: 'missiles-then-ship' });
    expect(own(battle, 'blue').weapons.pointDefencePriority).toBe('missiles-then-ship');
    // Holding fire, it leaves the ship alone.
    expect(impactsOn(battle.advance(5), 'red')).toEqual([]);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const events = battle.advance(10);
    expect(mount(battle, 'blue').engaging).toEqual({ kind: 'ship', side: 'red' });
    const impacts = impactsOn(events, 'red');
    // Five bursts a second, each one an impact once its rounds have flown the 2 s to red.
    expect(impacts.length).toBe(40);
    expect(impacts[0]).toMatchObject({ attacker: 'blue', munition: 'point-defence' });
    // Its rounds carry far less than a burst's worth of a kinetic gun's energy each time.
    for (const impact of impacts) expect(impact.energy).toBeLessThan(BURST_ENERGY);
    expect(own(battle, 'red').energyLedger.hitEnergy).toBeGreaterThan(0);
  });

  it('turns from the ship to an incoming missile', () => {
    const battle = createBattle(duelSetup(defendedTestDesign(), launchingTestDesign(1), 20 * KM));
    battle.giveOrder('blue', { type: 'point-defence', priority: 'missiles-then-ship' });
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(1);
    expect(mount(battle, 'blue').engaging).toEqual({ kind: 'ship', side: 'red' });
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    battle.advance(0.5);
    const [missile] = battle.observe('blue').munitions;
    expect(missile).toBeDefined();
    expect(mount(battle, 'blue').engaging).toEqual({ kind: 'missile', munition: missile?.id });
  });

  it('stops when its rounds run out', () => {
    const battle = createBattle(
      duelSetup(
        launchingTestDesign(1),
        defendedTestDesign({ rounds: 2 * roundsPerBurst }),
        500 * KM,
      ),
    );
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    const events = untilMissilesGone(battle, 1_000);
    expect(own(battle, 'red').weapons.ammunition.rounds).toBe(0);
    // Two bursts at the edge of its reach almost never hit, so the missile gets through.
    expect(interceptsIn(events)).toEqual([]);
    expect(impactsOn(events, 'red')).toHaveLength(1);
  });

  it('can shoot down a nuclear missile before its proximity fuse sets it off', () => {
    const battle = createBattle(
      duelSetup(
        launchingTestDesign(4, { missile: TEST_NUCLEAR_MISSILE, launchers: 4 }),
        defendedTestDesign({ mounts: 4 }),
        2_000 * KM,
      ),
    );
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 4 });
    const events = untilMissilesGone(battle, 3_000);
    const intercepts = interceptsIn(events);
    expect(intercepts.length).toBeGreaterThan(0);
    for (const intercept of intercepts) {
      expect(intercept.warhead).toBe('nuclear');
      expect(intercept.distance).toBeGreaterThan(2 * KM);
    }
    expect(events.filter((e) => e.type === 'detonation')).toHaveLength(4 - intercepts.length);
  });
});
