import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { OPENING_PASS, STARTING_SCENARIOS } from '../data/scenarios';
import { createBattle, type Battle, type BattleEvent, type CaptainSkill } from './battle';
import { withComputerCaptains } from './command';
import { duelSetup, testDesign, withComponent, withSection } from './testing';
import { distance, dot, normalize, sub } from './vector';

const KM = 1_000;
const HOUR = 3_600;

const fire = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
  battle.giveOrder('blue', { type: 'radiators', deployed: true });
};

const reproduction = (skill: CaptainSkill = 'medium') => {
  const setup = duelSetup(handMadeDesign('lance'), handMadeDesign('sling'), 100_000 * KM);
  const battle = withComputerCaptains(
    createBattle({
      ...setup,
      seed: 1,
      scenario: OPENING_PASS,
      sides: setup.sides.map((side) => (side.id === 'red' ? { ...side, skill } : side)),
    }),
  );
  fire(battle);
  battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: 100_000 * KM });
  return battle;
};

describe('massive weapon-range mismatches', () => {
  it.each(['medium', 'high'] as const)(
    'at %s skill builds closing speed and abandons the reported untenable approach with drive and reserve left',
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
      while (
        !battle.outcome &&
        !battle.observe('red').ownShip.withdrawing &&
        battle.time < 6 * HOUR
      )
        battle.advance(1);
      const leaving = battle.observe('red').ownShip;
      expect(leaving.withdrawing).toBe(true);
      expect(leaving.deltaV).toBeGreaterThan(leaving.reserve);
      const drive = leaving.sections
        .flatMap((section) => section.components)
        .find((component) => component.type === 'drive');
      expect(drive?.integrity).toBeGreaterThan(0);
      expect(
        leaving.sections.some(
          (section) => section.armour.remaining <= section.armour.thickness / 2,
        ),
      ).toBe(true);
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

// A repeatable evaluation at the same observation boundary as the regression above.
// RANGE_REPORT=1 prints one JSON record per battle for the balance report.
describe('range balance evaluation', () => {
  for (const [blue, red] of [
    ['lance', 'sling'],
    ['lance', 'lance'],
    ['sling', 'sling'],
    ['lance', 'quiver'],
    ['lance', 'torch'],
    ['quiver', 'quiver'],
    ['lance', 'needle'],
  ] as const) {
    it.each(STARTING_SCENARIOS.flatMap((scenario) => [1, 7].map((seed) => ({ scenario, seed }))))(
      `${blue} / ${red}: $scenario.id, seed $seed`,
      ({ scenario, seed }) => {
        const setup = duelSetup(handMadeDesign(blue), handMadeDesign(red), scenario.separation);
        const battle = withComputerCaptains(
          createBattle({
            ...setup,
            seed,
            scenario,
            timeLimit: 12 * HOUR,
            sides: setup.sides.map((side) => ({ ...side, commander: 'computer' })),
          }),
        );
        const first: Record<string, number> = {};
        const hitRanges: number[] = [];
        const withdrawals: BattleEvent[] = [];
        let minimumRange = Infinity;
        while (!battle.outcome) {
          const events = battle.advance(10);
          const observation = battle.observe('red');
          const contact = observation.contacts[0];
          if (contact)
            minimumRange = Math.min(
              minimumRange,
              distance(observation.ownShip.position, contact.position),
            );
          for (const event of events) {
            if (event.type === 'hit') hitRanges.push(event.range / KM);
            if (event.type === 'hit' || event.type === 'impact' || event.type === 'launch')
              first[event.attacker] ??= event.time;
            if (event.type === 'withdrawal') withdrawals.push(event);
          }
        }
        if (process.env.RANGE_REPORT)
          console.log(
            JSON.stringify({
              blue,
              red,
              scenario: scenario.id,
              seed,
              time: battle.time,
              winner: battle.outcome.winner,
              losses: battle.outcome.sides.map((side) => side.loss?.result ?? null),
              first,
              minimumKm: Math.round(minimumRange / KM),
              hitKm: hitRanges.length
                ? [Math.round(Math.min(...hitRanges)), Math.round(Math.max(...hitRanges))]
                : [],
              withdrawals,
            }),
          );
        expect(battle.outcome.sides.some((side) => side.loss !== null)).toBe(true);
        if (blue === red) {
          expect(first.blue).toBeDefined();
          expect(first.red).toBeDefined();
        }
        if (red === 'sling' && blue === 'lance') {
          expect(
            withdrawals.some((event) => event.type === 'withdrawal' && event.side === 'red'),
          ).toBe(true);
        }
      },
      120_000,
    );
  }
});
