import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import {
  HEAD_ON,
  OPENING_PASS,
  scenarioFor,
  STARTING_SCENARIOS,
  type StartingScenario,
} from '../data/scenarios';
import { createBattle, type Battle, type BattleEvent, type CaptainSkill } from './battle';
import { withComputerCaptains } from './command';
import { duelSetup, testDesign, testSides, withComponent, withSection } from './testing';
import { distance, dot, normalize, sub } from './vector';

const KM = 1_000;
const HOUR = 3_600;

// The original loadouts isolate changes to tactics from the stock weapon rebalance.
const legacyLance = withComponent(handMadeDesign('lance'), 'laser', { aperture: 4 });
const legacyBastion = withComponent(handMadeDesign('bastion'), 'laser', {
  aperture: 4,
  beamPower: 400e6,
  efficiency: 0.4,
  mass: 40e3,
});

const fire = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
  battle.giveOrder('blue', { type: 'radiators', deployed: true });
};

const lanceAttack = (
  setup: ReturnType<typeof duelSetup>,
  scenario: StartingScenario,
  seed: number,
) => {
  const battle = withComputerCaptains(
    createBattle({ ...setup, scenario, seed, timeLimit: 12 * HOUR }),
  );
  fire(battle);
  battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: 100_000 * KM });
  return battle;
};

describe('responding to standoff fire', () => {
  it('gets the outranged Bastion into range to land a hit before losing fire control', () => {
    const setup = duelSetup(legacyLance, legacyBastion, OPENING_PASS.separation);
    const battle = lanceAttack(setup, OPENING_PASS, 1);
    let response: BattleEvent | undefined;
    while (!battle.outcome && !response) {
      response = battle
        .advance(10)
        .find(
          (event) =>
            (event.type === 'hit' && event.attacker === 'red') ||
            (event.type === 'component-lost' &&
              event.side === 'red' &&
              event.component === 'sensor'),
        );
    }
    expect(response).toMatchObject({ type: 'hit', attacker: 'red' });
  }, 60_000);

  it('presses on with a worn nose when its guns will reach sooner than a withdrawal would end', () => {
    // Head-on, the Sling's attack run wears half its nose away some 20,000 km out. Closing at
    // over 12 km/s, its guns reach the Lance within the 30 minutes a withdrawal would still
    // spend under fire, so it keeps on, as before it turned away and coasted past unarmed.
    const designs = [handMadeDesign('sling'), handMadeDesign('lance')] as const;
    const battle = withComputerCaptains(
      createBattle({
        seed: 1,
        scenario: scenarioFor(HEAD_ON, designs),
        sides: testSides(designs).map((side) => ({ ...side, commander: 'computer' as const })),
      }),
    );
    let pressedOn = false;
    let impact: BattleEvent | undefined;
    while (!battle.outcome && !impact) {
      const events = battle.advance(10);
      impact = events.find((event) => event.type === 'impact' && event.attacker === 'blue');
      const own = battle.observe('blue').ownShip;
      const nose = own.sections.find((section) => section.kind === 'forward')?.armour;
      if (nose && nose.remaining <= nose.thickness / 2 && !own.withdrawing) pressedOn = true;
    }
    expect(pressedOn).toBe(true);
    expect(impact).toMatchObject({ type: 'impact', attacker: 'blue', target: 'red' });
  }, 60_000);

  it('withdraws when a slow Bastion is losing its sensor too fast to return fire', () => {
    const bastion = withComponent(legacyBastion, 'drive', { thrust: 100_000 });
    const battle = withComputerCaptains(
      createBattle(duelSetup(legacyLance, bastion, 155_000 * KM)),
    );
    fire(battle);
    battle.giveOrder('blue', {
      type: 'weapons',
      mode: 'fire-freely',
      target: 'red',
      aim: { section: 'forward', mount: 0 },
    });
    while (!battle.outcome && !battle.observe('red').ownShip.withdrawing && battle.time < 1_800)
      battle.advance(1);
    const own = battle.observe('red').ownShip;
    const sensor = own.sections
      .flatMap((section) => section.mounts)
      .find((m) => m.type === 'sensor');
    expect(own.withdrawing).toBe(true);
    expect(own.energyLedger.beamEmitted).toBe(0);
    expect(sensor?.integrity).toBeGreaterThan(0);
    expect(sensor?.integrity).toBeLessThan(1);
    expect(own.deltaV).toBeGreaterThan(own.reserve);
  }, 30_000);

  describe.each(STARTING_SCENARIOS)('$name', (scenario) => {
    it('gives the cruiser first effective fire against a starter laser', () => {
      const setup = duelSetup(
        handMadeDesign('lance'),
        handMadeDesign('bastion'),
        scenario.separation,
      );
      const battle = lanceAttack(setup, scenario, 1);
      let firstHit: BattleEvent | undefined;
      while (!battle.outcome && !firstHit) {
        firstHit = battle.advance(10).find((event) => event.type === 'hit');
      }
      expect(firstHit).toMatchObject({ type: 'hit', attacker: 'red' });
    }, 60_000);

    it('lets the gunboat close under fire, rolling its ablative nose, and survive', () => {
      const setup = duelSetup(
        handMadeDesign('lance'),
        handMadeDesign('sling'),
        scenario.separation,
      );
      const battle = lanceAttack(setup, scenario, 1);
      let closest = Infinity;
      let rolled = false;
      while (!battle.outcome) {
        battle.advance(10);
        const red = battle.observe('red');
        rolled ||= red.ownShip.rolling;
        const contact = red.contacts[0];
        if (contact) closest = Math.min(closest, distance(red.ownShip.position, contact.position));
      }
      // Its nose sheds the Lance's laser beyond half its reach, and rolling spreads it closer
      // in, so it presses its attack into its own guns' reach rather than turn back far off.
      expect(rolled).toBe(true);
      expect(closest).toBeLessThan(10_000 * KM);
      expect(battle.observe('blue').ownShip.energyLedger.beamEmitted).toBeGreaterThan(0);
      // It either wins there or gets away; the laser does not destroy it on the way in.
      expect(battle.outcome.sides[1]).toMatchObject({ shipLost: false });
    }, 60_000);
  });
});

const reproduction = (skill: CaptainSkill = 'medium') => {
  const setup = duelSetup(legacyLance, handMadeDesign('sling'), OPENING_PASS.separation);
  return lanceAttack(
    { ...setup, sides: setup.sides.map((side) => (side.id === 'red' ? { ...side, skill } : side)) },
    OPENING_PASS,
    1,
  );
};

describe('massive weapon-range mismatches', () => {
  it.each(['medium', 'high'] as const)(
    'at %s skill builds closing speed and, its guns nearer than a withdrawal would end, presses home with its nose worn',
    (skill) => {
      const battle = reproduction(skill);
      battle.advance(9_000);
      const observation = battle.observe('red');
      const own = observation.ownShip;
      const enemy = observation.contacts[0];
      expect(enemy).toBeDefined();
      if (!enemy) throw new Error('No contact');
      const closing = dot(
        sub(own.velocity, enemy.velocity),
        normalize(sub(enemy.position, own.position)),
      );
      expect(closing).toBeGreaterThan(15_000);
      expect(distance(own.position, enemy.position)).toBeLessThan(200_000 * KM);
      expect(own.power.priorities[0]).toBe('drive');
      expect(own.withdrawing).toBe(false);
      // Half its armour goes some 30,000 km out, under half an hour from its guns' reach at
      // that speed: turning away then would only keep it under fire for longer.
      let worn = false;
      while (!battle.outcome) {
        battle.advance(10);
        const ship = battle.observe('red').ownShip;
        worn ||= ship.sections.some(
          (section) => section.armour.remaining <= section.armour.thickness / 2,
        );
        expect(ship.withdrawing).toBe(false);
      }
      expect(worn).toBe(true);
      expect(battle.outcome.winner).toBe('red');
    },
    60_000,
  );

  it('firing a long-range laser takes power from the drive after stored energy is spent', () => {
    const target = withSection(testDesign(), 'forward', {
      armour: { type: 'ablative', thickness: 1 },
    });
    const fighting = createBattle(duelSetup(handMadeDesign('lance'), target, 100_000 * KM));
    const running = createBattle(duelSetup(handMadeDesign('lance'), target, 100_000 * KM));
    for (const battle of [fighting, running]) {
      battle.giveOrder('blue', { type: 'radiators', deployed: true });
      battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 300 });
    }
    fire(fighting);
    fighting.advance(120);
    running.advance(120);
    const firing = fighting.observe('blue').ownShip;
    const escaping = running.observe('blue').ownShip;
    expect(firing.energyLedger.beamEmitted).toBeGreaterThan(0);
    expect(firing.power.stored).toBeLessThan(1);
    expect(firing.power.systems.drive.supplied).toBeLessThan(escaping.power.systems.drive.supplied);
    expect(firing.thrust).toBeLessThan(escaping.thrust);
  });

  it('can complete an early withdrawal with worn armour before entering a known long-range threat', () => {
    // A larger telescope makes the threat known before its weapon can reach Sling.
    const sling = withComponent(handMadeDesign('sling'), 'sensor', { aperture: 40 });
    const setup = duelSetup(handMadeDesign('lance'), sling, 170_000 * KM);
    const condition = createBattle(setup).observe('red').ownShip.condition;
    const battle = withComputerCaptains(
      createBattle({
        ...setup,
        sides: setup.sides.map((side) =>
          side.id === 'red'
            ? {
                ...side,
                condition: {
                  ...condition,
                  sections: { ...condition.sections, engine: { armour: 0.004, structure: 1 } },
                },
              }
            : side,
        ),
      }),
    );
    battle.advance(10);
    expect(battle.outcome?.sides[1]).toMatchObject({
      loss: { result: 'withdrawn' },
      shipLost: false,
    });
  });

  it('leaves low-skill captains on their conventional approach', () => {
    const battle = reproduction('low');
    battle.advance(9_000);
    expect(battle.observe('red').ownShip.manoeuvre?.goal).toBe('close');
  }, 30_000);

  it('does not infer a beam disadvantage from unresolved enemy weapons', () => {
    const setup = duelSetup(handMadeDesign('lance'), handMadeDesign('torch'), 300_000 * KM);
    const battle = withComputerCaptains(createBattle(setup));
    battle.advance(10);
    expect(battle.observe('red').ownShip.manoeuvre).not.toBeNull();
  });
});
