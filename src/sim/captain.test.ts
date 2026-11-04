import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { OPENING_PASS } from '../data/scenarios';
import {
  createBattle,
  type Battle,
  type BattleEvent,
  type BattleSetup,
  type SideObservation,
  type SideSetup,
} from './battle';
import { createComputerCaptain } from './captain';
import { DECISION_INTERVAL, runBattle, withComputerCaptains } from './command';
import { designComponentsOfType, type Design } from './design';
import type { Order } from './orders';
import {
  antiMissileTestDesign,
  defendedTestDesign,
  duelSetup,
  launchingTestDesign,
  TEST_LASER,
  TEST_NUCLEAR_MISSILE,
  testDesign,
  withComponent,
  withSection,
} from './testing';
import { distance } from './vector';
import { effectiveRange } from './beams';

const KM = 1000;
const HOUR = 3_600;

const reachOf = (design: Design) =>
  Math.max(...designComponentsOfType(design, 'laser').map(effectiveRange));
const LANCE_REACH = reachOf(handMadeDesign('lance'));
const BASTION_REACH = reachOf(handMadeDesign('bastion'));

/** Two hand-made designs at rest `range` apart, both commanded by the computer. */
const computerDuel = (blue: string, red: string, range: number): BattleSetup => {
  const setup = duelSetup(handMadeDesign(blue), handMadeDesign(red), range);
  return { ...setup, sides: setup.sides.map((side) => ({ ...side, commander: 'computer' })) };
};

/** A player who gives no orders in blue's `blue`, against the computer in `red`. */
const againstIdlePlayer = (blue: Design, red: Design, range: number): Battle =>
  withComputerCaptains(createBattle(duelSetup(blue, red, range)));

/** Runs the battle until it ends, failing if it has not within `limit` seconds. */
const fightToTheEnd = (battle: Battle, limit: number): BattleEvent[] => {
  const events: BattleEvent[] = [];
  while (!battle.outcome) {
    if (battle.time > limit) throw new Error('The battle never ended');
    events.push(...battle.advance(60));
  }
  return events;
};

/** A copy of an observation that throws if anything tries to change it. */
const frozen = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};

const redOf = (setup: BattleSetup): SideSetup => {
  const red = setup.sides.find((side) => side.id === 'red');
  if (!red) throw new Error('No red side');
  return red;
};

const range = (observation: SideObservation) =>
  distance(observation.ownShip.position, observation.contacts[0]?.position ?? { x: 0, y: 0, z: 0 });

/** Every computer side's battle has been decided: one lost by destruction or disablement. */
const expectDecided = (battle: Battle) => {
  const outcome = battle.outcome;
  expect(outcome).not.toBeNull();
  const losses = outcome?.sides.flatMap((side) => (side.loss ? [side.loss.result] : [])) ?? [];
  expect(losses.length).toBeGreaterThan(0);
  expect(losses.every((result) => result === 'destroyed' || result === 'disabled')).toBe(true);
};

describe('computer captain', () => {
  it('commands its ship only through orders, from what its side observes', () => {
    const setup = computerDuel('lance', 'bastion', 170_000 * KM);
    const duration = 1_200;
    const commanded = runBattle(setup, { maxTime: duration });

    // The same battle with each captain handed a frozen copy of its side's observation, and the
    // orders it returns given by hand: the battle accepts each one, and it plays out the same.
    const battle = createBattle(setup);
    const captains = setup.sides.map((side) => createComputerCaptain(side));
    const given = new Set<Order['type']>();
    while (battle.time < duration - 1e-9 && !battle.outcome) {
      for (const captain of captains) {
        for (const order of captain.decide(frozen(structuredClone(battle.observe(captain.side))))) {
          battle.giveOrder(captain.side, order);
          given.add(order.type);
        }
      }
      battle.advance(DECISION_INTERVAL);
    }

    expect(given).toEqual(new Set(['weapons', 'manoeuvre', 'radiators', 'power']));
    expect(battle.time).toBe(commanded.time);
    expect(battle.observe('blue')).toStrictEqual(commanded.observe('blue'));
    expect(battle.observe('red')).toStrictEqual(commanded.observe('red'));
  });

  it('leaves a player side to the player', () => {
    const battle = againstIdlePlayer(handMadeDesign('lance'), handMadeDesign('bastion'), 1e5 * KM);
    battle.advance(60);
    const player = battle.observe('blue').ownShip;
    expect(player.manoeuvre).toBeNull();
    expect(player.weapons).toMatchObject({ target: null, mode: 'hold-fire' });
    expect(battle.observe('red').ownShip.weapons).toMatchObject({
      target: 'blue',
      mode: 'fire-freely',
    });
  });

  it('outranging its enemy, holds just inside its own reach and wears the enemy down', () => {
    const battle = againstIdlePlayer(
      handMadeDesign('bastion'),
      handMadeDesign('lance'),
      200_000 * KM,
    );
    battle.advance(10);
    const order = battle.observe('red').ownShip.manoeuvre;
    expect(order?.goal).toBe('hold');
    expect(order?.range).toBeGreaterThan(BASTION_REACH);
    expect(order?.range).toBeLessThan(LANCE_REACH);

    const events = fightToTheEnd(battle, 12 * HOUR);
    expect(battle.outcome?.winner).toBe('red');
    const hits = events.filter((e) => e.type === 'hit' && e.attacker === 'red');
    expect(hits.length).toBeGreaterThan(0);
    // Every hit landed from beyond the reach of the enemy's lasers.
    for (const hit of hits) expect(hit.type === 'hit' && hit.range).toBeGreaterThan(BASTION_REACH);
  }, 20_000); // Simulates hours of battle; takes a few seconds.

  it('outranged, closes in to fight, with the drive first on the way and the weapons first there', () => {
    const battle = againstIdlePlayer(
      handMadeDesign('lance'),
      handMadeDesign('bastion'),
      200_000 * KM,
    );
    battle.advance(10);
    let red = battle.observe('red').ownShip;
    // Its sensor makes out the Lance's laser even this far off, so it knows it is outranged.
    expect(red.manoeuvre?.goal).toBe('close');
    expect(red.manoeuvre?.range).toBeLessThan(BASTION_REACH);
    expect(red.power.priorities[0]).toBe('drive');
    expect(red.heat.radiatorsDeployed).toBe(false);

    while (red.energyLedger.beamEmitted === 0) {
      if (battle.outcome || battle.time > 12 * HOUR) throw new Error('Red never fired');
      battle.advance(60);
      red = battle.observe('red').ownShip;
    }
    expect(red.power.priorities[0]).toBe('weapons');
    expect(red.heat.radiatorsDeployed).toBe(true);

    fightToTheEnd(battle, 12 * HOUR);
    expect(battle.outcome?.winner).toBe('red');
    expect(range(battle.observe('red'))).toBeLessThan(BASTION_REACH);
  }, 20_000); // Simulates hours of battle; takes a few seconds.

  it('holds its kinetic guns until the enemy is too close to dodge their slugs, then hits', () => {
    const battle = againstIdlePlayer(testDesign(), handMadeDesign('sling'), 5_000 * KM);
    battle.advance(10);
    let red = battle.observe('red').ownShip;
    const reach = red.weapons.kineticGuns[0]?.effectiveRange ?? 0;
    expect(reach).toBeGreaterThan(5_000 * KM);
    // In its guns' reach but far enough off for slugs to be dodged, it holds fire and closes.
    expect(red.weapons.mode).toBe('hold-fire');
    expect(red.manoeuvre?.goal).toBe('hold');
    expect(red.manoeuvre?.range).toBeLessThan(1_000 * KM);
    const events: BattleEvent[] = [];
    while (red.weapons.ammunition.slugs === red.weapons.ammunition.slugCapacity) {
      if (battle.time > 6 * HOUR) throw new Error('Red never fired');
      events.push(...battle.advance(60));
      red = battle.observe('red').ownShip;
    }
    expect(range(battle.observe('red'))).toBeLessThan(1_000 * KM);
    events.push(...battle.advance(600));
    red = battle.observe('red').ownShip;
    const fired = red.weapons.ammunition.slugCapacity - red.weapons.ammunition.slugs;
    const hits = events.filter((e) => e.type === 'impact' && e.munition === 'slug').length;
    expect(hits).toBeGreaterThan(0.8 * (fired - battle.observe('red').munitions.length));
  }, 20_000);

  it('dodges slugs fired from too far off to hit a ship that moves', () => {
    // A player in the Sling fires at the computer's Torch from 25,000 km, inside its guns' reach.
    const battle = againstIdlePlayer(handMadeDesign('sling'), handMadeDesign('torch'), 25_000 * KM);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const events = battle.advance(1_800);
    const blue = battle.observe('blue').ownShip;
    const fired = blue.weapons.ammunition.slugCapacity - blue.weapons.ammunition.slugs;
    expect(fired).toBeGreaterThan(100);
    const hits = events.filter((e) => e.type === 'impact' && e.munition === 'slug').length;
    expect(hits).toBeLessThan(0.1 * fired);
  }, 20_000);

  it('closes within the short reach of its charged particle beam and fires it', () => {
    const battle = againstIdlePlayer(testDesign(), handMadeDesign('torch'), 60_000 * KM);
    battle.advance(10);
    let red = battle.observe('red').ownShip;
    const reach = red.weapons.particleBeams[0]?.effectiveRange ?? 0;
    expect(reach).toBeLessThan(60_000 * KM);
    expect(red.manoeuvre?.goal).toBe('hold');
    expect(red.manoeuvre?.range).toBeLessThan(reach);
    const events: BattleEvent[] = [];
    while (!red.weapons.particleBeams.some((beam) => beam.firing)) {
      if (battle.time > 6 * HOUR) throw new Error('Red never fired');
      events.push(...battle.advance(60));
      red = battle.observe('red').ownShip;
    }
    events.push(...battle.advance(60));
    expect(
      events.some(
        (e) => e.type === 'hit' && e.attacker === 'red' && e.attack === 'charged-particle',
      ),
    ).toBe(true);
  }, 20_000);

  it('launches a salvo of missiles once the enemy is within their reach, and another once it lands', () => {
    const quiver = handMadeDesign('quiver');
    const far = againstIdlePlayer(testDesign(), quiver, 200_000 * KM);
    expect(far.advance(60).some((e) => e.type === 'launch')).toBe(false);

    const battle = againstIdlePlayer(testDesign(), quiver, 30_000 * KM);
    const reach = battle.observe('red').ownShip.weapons.ammunition.missileDesigns[0]?.reach ?? 0;
    expect(reach).toBeGreaterThan(30_000 * KM);
    const first = battle.advance(10).filter((e) => e.type === 'launch');
    const launchers = quiver.sections.flatMap((s) => s.mounts).filter((m) => m.type === 'launcher');
    expect(first).toHaveLength(launchers.length);
    expect(first.every((e) => e.attacker === 'red' && e.target === 'blue')).toBe(true);
    // One salvo at a time: no more while the first is on its way.
    const events: BattleEvent[] = [];
    while (battle.observe('red').munitions.length > 0) {
      if (battle.time > 2 * HOUR) throw new Error('Missiles still in flight');
      events.push(...battle.step());
    }
    expect(events.some((e) => e.type === 'launch')).toBe(false);
    expect(events.some((e) => e.type === 'impact' && e.munition === 'missile')).toBe(true);
    expect(battle.outcome).toBeNull();
    expect(battle.advance(10).filter((e) => e.type === 'launch')).toHaveLength(launchers.length);
  });

  it('keeps automatic missile defence on, and launches its anti-ship missiles at the enemy', () => {
    const bulwark = handMadeDesign('bulwark');
    const battle = againstIdlePlayer(testDesign(), bulwark, 30_000 * KM);
    battle.giveOrder('red', { type: 'anti-missile', automatic: false });
    const launches = battle.advance(10).filter((e) => e.type === 'launch');
    expect(battle.observe('red').ownShip.weapons.antiMissile.automatic).toBe(true);
    const launchers = bulwark.sections
      .flatMap((s) => s.mounts)
      .filter((m) => m.type === 'launcher');
    expect(launches).toHaveLength(launchers.length);
    expect(launches.every((e) => e.attacker === 'red' && e.target === 'blue')).toBe(true);
    for (const missile of battle.observe('red').munitions) {
      expect(missile).toMatchObject({ kind: 'missile', name: 'Spike', role: 'anti-ship' });
    }
  });

  it('faces anti-missile missiles that shoot down its missiles without any order', () => {
    // An idle player in the Bulwark gives no orders; its automatic missile defence is on.
    const battle = againstIdlePlayer(
      handMadeDesign('bulwark'),
      handMadeDesign('quiver'),
      40_000 * KM,
    );
    const events: BattleEvent[] = [];
    while (!events.some((e) => e.type === 'intercept')) {
      if (battle.time > 2 * HOUR || battle.outcome) throw new Error('No missile was shot down');
      events.push(...battle.advance(60));
    }
    const intercept = events.find((e) => e.type === 'intercept');
    expect(intercept).toMatchObject({
      side: 'blue',
      attacker: 'red',
      weapon: 'anti-missile-missile',
    });
  }, 20_000);

  it('keeps its point defence on missiles, and on the ship once it has nothing else', () => {
    const armed = withSection(defendedTestDesign(), 'forward', {
      ...defendedTestDesign().sections[0],
      mounts: [TEST_LASER],
    });
    const battle = againstIdlePlayer(testDesign(), armed, 20 * KM);
    battle.advance(10);
    expect(battle.observe('red').ownShip.weapons.pointDefencePriority).toBe('missiles');

    // With only point defence, it turns it on the enemy ship and fights at its short reach.
    const lastResort = againstIdlePlayer(testDesign(), defendedTestDesign(), 100 * KM);
    const firedOn = (events: readonly BattleEvent[]) =>
      events.some(
        (e) => e.type === 'impact' && e.attacker === 'red' && e.munition === 'point-defence',
      );
    while (!firedOn(lastResort.advance(10))) {
      if (lastResort.time > 1_200 || lastResort.outcome) throw new Error('Red never fired on blue');
    }
    const red = lastResort.observe('red').ownShip;
    expect(red.weapons.pointDefencePriority).toBe('missiles-then-ship');
    expect(red.manoeuvre?.range).toBeLessThan(red.weapons.pointDefence[0]?.effectiveRange ?? 0);
  });

  it('faces point defence that shoots down its missiles without any order', () => {
    // An idle player in the Rampart gives no orders; its point defence is on missiles from the start.
    const battle = againstIdlePlayer(
      handMadeDesign('rampart'),
      handMadeDesign('quiver'),
      40_000 * KM,
    );
    const events: BattleEvent[] = [];
    while (!events.some((e) => e.type === 'intercept')) {
      if (battle.time > 2 * HOUR || battle.outcome) throw new Error('No missile was shot down');
      events.push(...battle.advance(60));
    }
    const intercept = events.find((e) => e.type === 'intercept');
    expect(intercept).toMatchObject({ side: 'blue', attacker: 'red', weapon: 'point-defence' });
  }, 20_000);

  /** A player in blue's `blue` who launches `missiles` at red at once, and the computer in red. */
  const underMissileAttack = (blue: Design, red: Design, at: number, missiles: number): Battle => {
    const battle = createBattle(duelSetup(blue, red, at));
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles });
    return battle;
  };

  /** Advances the battle until an event turns up, failing if none has by `limit` seconds. */
  const until = (
    battle: Battle,
    found: (e: BattleEvent) => boolean,
    limit: number,
  ): BattleEvent[] => {
    const events: BattleEvent[] = [];
    while (!events.some(found)) {
      if (battle.time > limit || battle.outcome) throw new Error('It never happened');
      events.push(...battle.advance(10));
    }
    return events;
  };

  it.each([
    ['laser', 'lance', 50_000, (e: BattleEvent) => e.type === 'hit' && e.attack === 'laser'],
    [
      'kinetic gun',
      'sling',
      1_000,
      (e: BattleEvent) => e.type === 'impact' && e.munition === 'slug',
    ],
    [
      'missile with a kinetic warhead',
      'quiver',
      30_000,
      (e: BattleEvent) => e.type === 'impact' && e.munition === 'missile',
    ],
    ['missile with a nuclear warhead', 'pyre', 30_000, (e: BattleEvent) => e.type === 'detonation'],
    [
      'charged particle beam',
      'torch',
      10_000,
      (e: BattleEvent) => e.type === 'hit' && e.attack === 'charged-particle',
    ],
    [
      'neutral particle beam',
      'needle',
      50_000,
      (e: BattleEvent) => e.type === 'hit' && e.attack === 'neutral-particle',
    ],
  ])('fires its %s at the enemy ship', (_, design, at, landed) => {
    const battle = againstIdlePlayer(testDesign(), handMadeDesign(design), at * KM);
    const events = until(battle, (e) => 'attacker' in e && e.attacker === 'red' && landed(e), HOUR);
    expect(events.find(landed)).toMatchObject({ attacker: 'red', target: 'blue' });
  });

  it.each([
    ['point defence', defendedTestDesign(), 'point-defence'],
    ['anti-missile missiles', antiMissileTestDesign(), 'anti-missile-missile'],
  ] as const)('fires its %s at incoming missiles', (_, red, weapon) => {
    const battle = withComputerCaptains(
      underMissileAttack(launchingTestDesign(2), red, 20_000 * KM, 2),
    );
    const events = until(battle, (e) => e.type === 'intercept', HOUR);
    expect(events.find((e) => e.type === 'intercept')).toMatchObject({ side: 'red', weapon });
  });

  it('under missile attack, keeps its launchers for anti-missile missiles and its power for the weapons', () => {
    // Both sides are in reach of each other's anti-ship missiles; blue launches first.
    const battle = underMissileAttack(
      launchingTestDesign(4, { launchers: 2 }),
      antiMissileTestDesign({ antiMissiles: 8, missiles: 4, launchers: 2 }),
      20_000 * KM,
      4,
    );
    battle.advance(15);
    const commanded = withComputerCaptains(battle);
    const inbound = () =>
      commanded.observe('red').munitions.some((m) => m.kind === 'missile' && m.attacker === 'blue');
    expect(inbound()).toBe(true);
    const events: BattleEvent[] = [];
    while (inbound()) {
      if (commanded.time > HOUR || commanded.outcome) throw new Error('Missiles still inbound');
      events.push(...commanded.advance(1));
      const red = commanded.observe('red').ownShip;
      expect(red.power.priorities[0]).toBe('weapons');
      expect(red.weapons.pointDefencePriority).toBe('missiles');
    }
    const launches = events.filter((e) => e.type === 'launch' && e.attacker === 'red');
    expect(launches.length).toBeGreaterThan(0);
    // Every missile it launched while under attack went after an incoming missile.
    for (const launch of launches) {
      expect(launch.type === 'launch' && typeof launch.target).toBe('object');
    }
    // Once they are dealt with, it launches at the enemy ship.
    const after = until(commanded, (e) => e.type === 'launch' && e.attacker === 'red', HOUR);
    expect(after.find((e) => e.type === 'launch')).toMatchObject({ target: 'blue' });
  }, 20_000);

  it('sends a second anti-missile missile at each nuclear missile', () => {
    const battle = withComputerCaptains(
      underMissileAttack(
        launchingTestDesign(1, { missile: TEST_NUCLEAR_MISSILE }),
        antiMissileTestDesign({ antiMissiles: 4, launchers: 2 }),
        20_000 * KM,
        1,
      ),
    );
    let most = 0;
    while (battle.observe('red').munitions.some((m) => m.attacker === 'blue') || battle.time < 60) {
      if (battle.time > HOUR || battle.outcome) break;
      battle.advance(1);
      const { engagements } = battle.observe('red').ownShip.weapons.antiMissile;
      most = Math.max(most, engagements.length);
    }
    expect(most).toBe(2);
  }, 20_000);

  it('retracts its radiators as a nuclear missile closes in', () => {
    // Unarmed against nuclear missiles, the computer has its radiators out for the fight.
    const battle = withComputerCaptains(
      underMissileAttack(
        launchingTestDesign(2, { missile: TEST_NUCLEAR_MISSILE }),
        testDesign(),
        20_000 * KM,
        1,
      ),
    );
    battle.advance(10);
    expect(battle.observe('red').ownShip.heat.radiatorsDeployed).toBe(true);
    const events = until(battle, (e) => e.type === 'detonation', HOUR);
    expect(events.some((e) => e.type === 'detonation')).toBe(true);
    expect(battle.observe('red').ownShip.heat.radiatorsDeployed).toBe(false);
  }, 20_000);

  it('heads for its fighting range from far off faster than its autopilot would', () => {
    // At the autopilot's own cruising speed it would take over nine hours to get there.
    const battle = againstIdlePlayer(testDesign(), handMadeDesign('torch'), 200_000 * KM);
    until(battle, (e) => e.type === 'hit' && e.attacker === 'red', 7 * HOUR);
    expect(battle.observe('red').ownShip.deltaV).toBeGreaterThan(0);
  }, 20_000);

  it('deploys its radiators when it runs hot, and retracts them once cool', () => {
    const setup = duelSetup(handMadeDesign('lance'), handMadeDesign('bastion'), 300_000 * KM);
    const observation = createBattle(setup).observe('red');
    const withHeat = (temperature: number, radiatorsDeployed: boolean): SideObservation => ({
      ...observation,
      ownShip: {
        ...observation.ownShip,
        heat: { ...observation.ownShip.heat, temperature, radiatorsDeployed },
      },
    });
    const radiators = (temperature: number, deployed: boolean) =>
      createComputerCaptain(redOf(setup))
        .decide(withHeat(temperature, deployed))
        .find((order) => order.type === 'radiators');

    expect(radiators(300, false)).toBeUndefined();
    expect(radiators(800, false)).toEqual({ type: 'radiators', deployed: true });
    // Out of reach, the radiators stay out until the ship has cooled well down.
    expect(radiators(600, true)).toBeUndefined();
    expect(radiators(350, true)).toEqual({ type: 'radiators', deployed: false });
  });

  it('raises its shields in a fight only against weapons they counter, and lowers them after', () => {
    /** The shields order the computer in red gives at a range against blue's design. */
    const shieldsOrder = (blue: string, red: string, at: number) => {
      const setup = duelSetup(handMadeDesign(blue), handMadeDesign(red), at);
      return createComputerCaptain(redOf(setup))
        .decide(createBattle(setup).observe('red'))
        .find((order) => order.type === 'shields');
    };
    // Ships start with their shields raised. Out of reach the Ward lowers its magnetic shield.
    expect(shieldsOrder('torch', 'ward', 300_000 * KM)).toEqual({ type: 'shields', raised: false });
    expect(shieldsOrder('torch', 'ward', 1_000 * KM)).toBeUndefined();
    // A magnetic shield is no use against a laser, so it stays down even in the fight.
    expect(shieldsOrder('lance', 'ward', 1_000 * KM)).toEqual({ type: 'shields', raised: false });
    // Coolant shields are, so the Rime keeps them up while lasers can reach it.
    expect(shieldsOrder('lance', 'rime', 1_000 * KM)).toBeUndefined();
    expect(shieldsOrder('torch', 'rime', 1_000 * KM)).toEqual({ type: 'shields', raised: false });

    // Lowered out of reach, it raises them again as the enemy closes, ranked above the drive.
    const setup = duelSetup(handMadeDesign('torch'), handMadeDesign('ward'), 1_000 * KM);
    const battle = createBattle(setup);
    battle.giveOrder('red', { type: 'shields', raised: false });
    battle.giveOrder('red', {
      type: 'power',
      priorities: ['drive', 'weapons', 'capacitors', 'shields'],
    });
    const orders = createComputerCaptain(redOf(setup)).decide(battle.observe('red'));
    expect(orders).toContainEqual({ type: 'shields', raised: true });
    expect(orders.find((order) => order.type === 'power')).toEqual({
      type: 'power',
      priorities: ['weapons', 'shields', 'drive', 'capacitors'],
    });
  });

  it('closes in when nothing has happened for a while', () => {
    // With a drive of a newton neither ship gets anywhere, so the Lance cannot reach its standoff
    // range.
    const stuck = (id: string): Design => withComponent(handMadeDesign(id), 'drive', { thrust: 1 });
    const setup = duelSetup(stuck('lance'), stuck('bastion'), 250_000 * KM);
    const battle = runBattle(
      { ...setup, sides: setup.sides.map((side) => ({ ...side, commander: 'computer' })) },
      { maxTime: 60 },
    );
    expect(battle.observe('blue').ownShip.manoeuvre?.goal).toBe('hold');
    battle.advance(HOUR);
    const order = battle.observe('blue').ownShip.manoeuvre;
    expect(order?.goal).toBe('close');
    expect(order?.range).toBeLessThan(BASTION_REACH);
  });
});

describe('two computer captains', () => {
  it('fight the Lance and the Bastion to a result from the opening pass', () => {
    const battle = runBattle(
      {
        seed: 7,
        scenario: OPENING_PASS,
        sides: [
          { id: 'blue', name: 'Blue', commander: 'computer', design: handMadeDesign('lance') },
          { id: 'red', name: 'Red', commander: 'computer', design: handMadeDesign('bastion') },
        ],
      },
      { maxTime: 24 * HOUR },
    );
    expectDecided(battle);
  }, 30_000); // Simulates most of a day of battle; takes a few seconds.

  it.each(['lance', 'bastion', 'quiver', 'torch', 'needle', 'rampart', 'bulwark'])(
    'fight %s against its own design to a result',
    (design) => {
      const battle = runBattle(computerDuel(design, design, 200_000 * KM), { maxTime: 24 * HOUR });
      expectDecided(battle);
    },
    30_000,
  );

  it('replay a battle from its seed with an identical event log', () => {
    const setup = { ...computerDuel('bastion', 'lance', 140_000 * KM), seed: 99, timeLimit: HOUR };
    const eventLog = () => {
      const battle = withComputerCaptains(createBattle(setup));
      const events: BattleEvent[] = [];
      while (!battle.outcome) events.push(...battle.step());
      return events;
    };
    const first = eventLog();
    expect(first.filter((e) => e.type === 'hit').length).toBeGreaterThan(0);
    expect(first.at(-1)?.type).toBe('battle-ended');
    expect(eventLog()).toStrictEqual(first);
  }, 20_000);

  it('fight the same battle every time from the same seed', () => {
    const setup = computerDuel('bastion', 'lance', 140_000 * KM);
    const first = runBattle(setup, { maxTime: 6 * HOUR });
    const second = runBattle(setup, { maxTime: 6 * HOUR });
    expectDecided(first);
    expect(second.outcome).toStrictEqual(first.outcome);
    expect(second.observe('blue')).toStrictEqual(first.observe('blue'));
  }, 20_000);
});
