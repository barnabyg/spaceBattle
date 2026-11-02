import { describe, expect, it } from 'vitest';
import {
  createBattle,
  type Battle,
  type BattleEvent,
  type MissileObservation,
  type OwnShipObservation,
} from './battle';
import { fromAxisAngle } from './quaternion';
import {
  duelSetup,
  gunnedTestDesign,
  launchingTestDesign,
  TEST_KINETIC_GUN,
  TEST_LAUNCHER,
  TEST_MISSILE,
  testDesign,
} from './testing';
import { length, normalize, sub, vec3, type Vec3 } from './vector';

const KM = 1000;
/** Red side-on to blue with its nose along +y, so its drive pushes it across blue's line of fire. */
const ACROSS = fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
const MISSILE_MASS = TEST_MISSILE.dryMass + TEST_MISSILE.propellantMass;

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const missilesInFlight = (battle: Battle): MissileObservation[] =>
  battle.observe('blue').munitions.flatMap((m) => (m.kind === 'missile' ? [m] : []));

const launchAtRed = (battle: Battle, missiles: number) => {
  battle.giveOrder('blue', { type: 'launch', target: 'red', missiles });
};

const impactsOn = (events: readonly BattleEvent[], target: string) =>
  events.flatMap((e) => (e.type === 'impact' && e.target === target ? [e] : []));

/** Steps until no missile is in flight, returning what happened. */
const untilMissilesGone = (battle: Battle, limit: number): BattleEvent[] => {
  const events: BattleEvent[] = [];
  while (missilesInFlight(battle).length > 0) {
    if (battle.time > limit) throw new Error('Missiles still in flight');
    events.push(...battle.step());
  }
  return events;
};

describe('missiles', () => {
  it('launch a salvo from the magazine, one from each launcher as it is loaded', () => {
    const battle = createBattle(
      duelSetup(launchingTestDesign(5, { launchers: 2 }), testDesign(), 10_000 * KM),
    );
    const before = own(battle, 'blue');
    expect(before.weapons.ammunition).toMatchObject({ missiles: 5, missileCapacity: 5 });
    expect(before.weapons.launchers).toHaveLength(2);
    expect(before.weapons.launchers[0]).toMatchObject({
      section: 'forward',
      mount: 0,
      integrity: 1,
      loaded: true,
      reloadTime: TEST_LAUNCHER.reloadTime,
    });
    expect(before.weapons.salvo).toBeNull();

    launchAtRed(battle, 3);
    const launched = battle.step().filter((e) => e.type === 'launch');
    // Both launchers fire at once; the third missile waits for a launcher to reload.
    expect(launched).toHaveLength(2);
    expect(launched[0]).toMatchObject({ attacker: 'blue', target: 'red', section: 'forward' });
    expect(missilesInFlight(battle)).toHaveLength(2);
    expect(own(battle, 'blue').weapons.salvo).toEqual({ target: 'red', remaining: 1 });
    expect(own(battle, 'blue').weapons.launchers[0]?.loaded).toBe(false);
    expect(battle.advance(TEST_LAUNCHER.reloadTime - 1).some((e) => e.type === 'launch')).toBe(
      false,
    );
    expect(battle.advance(1).filter((e) => e.type === 'launch')).toHaveLength(1);
    const after = own(battle, 'blue');
    expect(after.weapons.salvo).toBeNull();
    expect(after.weapons.ammunition.missiles).toBe(2);
    expect(missilesInFlight(battle)).toHaveLength(3);
    // The missiles' mass leaves the ship with them, so it gets lighter and its delta-v grows.
    expect(before.mass - after.mass).toBeCloseTo(3 * MISSILE_MASS, 3);
    expect(after.deltaV).toBeGreaterThan(before.deltaV);
  });

  it('launch only when ordered, and no more than the magazines hold', () => {
    const battle = createBattle(duelSetup(launchingTestDesign(2), testDesign(), 10_000 * KM));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(30);
    expect(missilesInFlight(battle)).toEqual([]);
    launchAtRed(battle, 5);
    const events = battle.advance(60);
    expect(events.filter((e) => e.type === 'launch')).toHaveLength(2);
    const { weapons } = own(battle, 'blue');
    expect(weapons.ammunition.missiles).toBe(0);
    expect(weapons.salvo).toBeNull();
  });

  it('show both sides each missile in flight, with its warhead, propellant and delta-v', () => {
    const battle = createBattle(duelSetup(launchingTestDesign(1), testDesign(), 10_000 * KM));
    launchAtRed(battle, 1);
    battle.advance(10);
    expect(battle.observe('red').munitions).toStrictEqual(battle.observe('blue').munitions);
    const [missile] = missilesInFlight(battle);
    expect(missile).toMatchObject({
      kind: 'missile',
      attacker: 'blue',
      target: 'red',
      name: TEST_MISSILE.name,
      warhead: 'kinetic',
    });
    if (!missile) throw new Error('No missile');
    // Ten seconds of full thrust: 2.5 kg/s of propellant.
    expect(missile.propellantMass).toBeCloseTo(TEST_MISSILE.propellantMass - 25, 0);
    expect(missile.mass).toBeCloseTo(TEST_MISSILE.dryMass + missile.propellantMass, 6);
    expect(missile.deltaV).toBeCloseTo(
      TEST_MISSILE.exhaustVelocity * Math.log(missile.mass / TEST_MISSILE.dryMass),
      3,
    );
    expect(missile.thrust).toBeCloseTo(TEST_MISSILE.thrust, 0);
    // Red sits still on blue's +x axis, so the missile accelerates straight at it.
    expect(normalize(missile.velocity).x).toBeCloseTo(1, 6);
    expect(length(missile.velocity)).toBeGreaterThan(250);
  });

  it('intercept a target manoeuvring within their delta-v', () => {
    const battle = createBattle(
      duelSetup(launchingTestDesign(1), testDesign(), 2_000 * KM, ACROSS),
    );
    launchAtRed(battle, 1);
    battle.step();
    // Red burns across the line of fire as soon as the missile is away, and keeps burning.
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
    let last: MissileObservation | undefined;
    const events: BattleEvent[] = [];
    while (missilesInFlight(battle).length > 0) {
      if (battle.time > 3_000) throw new Error('Missile still in flight');
      last = missilesInFlight(battle)[0];
      events.push(...battle.step());
    }
    const [impact] = impactsOn(events, 'red');
    expect(impact).toMatchObject({ attacker: 'blue', munition: 'missile' });
    // Red moved hundreds of kilometres off the line the missile was launched along...
    const red = own(battle, 'red');
    expect(red.position.y).toBeGreaterThan(100 * KM);
    // ...and the missile matched it with delta-v to spare.
    expect(last?.deltaV).toBeGreaterThan(0);
  });

  it('cannot correct their course once out of propellant, so a manoeuvring target escapes', () => {
    const shortOfPropellant = { ...TEST_MISSILE, propellantMass: 50 };
    const battle = createBattle(
      duelSetup(
        launchingTestDesign(1, { missile: shortOfPropellant }),
        testDesign(),
        1_000 * KM,
        ACROSS,
      ),
    );
    launchAtRed(battle, 1);
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
    const events: BattleEvent[] = [];
    let missile = missilesInFlight(battle)[0];
    while (!missile || missile.propellantMass > 0) {
      if (battle.time > 600) throw new Error('Propellant never ran out');
      events.push(...battle.step());
      missile = missilesInFlight(battle)[0];
    }
    expect(missile.deltaV).toBe(0);
    // From now on it flies in a straight line, whatever red does.
    const velocity: Vec3 = missile.velocity;
    for (let i = 0; i < 100; i++) {
      events.push(...battle.step());
      const now = missilesInFlight(battle)[0];
      expect(now?.thrust).toBe(0);
      expect(length(sub(now?.velocity ?? vec3(0, 0, 0), velocity))).toBe(0);
    }
    events.push(...untilMissilesGone(battle, 5_000));
    expect(impactsOn(events, 'red')).toEqual([]);
  });

  it("hit with the kinetic warhead: the whole missile's kinetic energy relative to the target", () => {
    const battle = createBattle(duelSetup(launchingTestDesign(1), testDesign(), 1_000 * KM));
    launchAtRed(battle, 1);
    let last: MissileObservation | undefined;
    let events: readonly BattleEvent[] = [];
    while (impactsOn(events, 'red').length === 0) {
      if (battle.time > 600) throw new Error('No impact');
      last = missilesInFlight(battle)[0] ?? last;
      events = battle.step();
    }
    const [impact] = impactsOn(events, 'red');
    // Red faces blue nose-on and sits still, so the missile strikes its nose.
    expect(impact).toMatchObject({ attacker: 'blue', section: 'forward', munition: 'missile' });
    // It may still burn a little in its last step, so its mass then is all but what was last seen.
    const mass = last?.mass ?? 0;
    expect(impact?.speed).toBeCloseTo(length(last?.velocity ?? vec3(0, 0, 0)), -1);
    expect((impact?.energy ?? 0) / (0.5 * mass * (impact?.speed ?? 0) ** 2)).toBeCloseTo(1, 3);
    // Arriving at kilometres a second, it carries hundreds of times a slug's energy.
    const slugEnergy = 0.5 * TEST_KINETIC_GUN.slugMass * TEST_KINETIC_GUN.muzzleVelocity ** 2;
    expect(impact?.energy).toBeGreaterThan(100 * slugEnergy);
    expect(own(battle, 'red').energyLedger.hitEnergy).toBeCloseTo(impact?.energy ?? 0, -3);
    expect(missilesInFlight(battle)).toEqual([]);
  });
});

describe('ammunition mass', () => {
  it('leaves the ship with each slug fired', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(5), testDesign(), 1_000 * KM));
    const before = own(battle, 'blue').mass;
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(10);
    expect(own(battle, 'blue').weapons.ammunition.slugs).toBe(0);
    expect(before - own(battle, 'blue').mass).toBeCloseTo(5 * TEST_KINETIC_GUN.slugMass, 6);
  });

  it('moves the centre of mass, which the ship turns and is struck about', () => {
    const battle = createBattle(duelSetup(launchingTestDesign(20), testDesign(), 10_000 * KM));
    const nose = () =>
      own(battle, 'blue').appearance.parts.find((p) => p.section === 'forward' && p.mount === null)
        ?.max.x ?? NaN;
    const before = nose();
    launchAtRed(battle, 1);
    battle.step();
    // A missile left the forward magazine, so the centre of mass moved back, away from the nose.
    expect(nose()).toBeGreaterThan(before);
    expect(own(battle, 'blue').appearance.ammunitionSpent.forward).toBeCloseTo(MISSILE_MASS, 6);
  });
});
