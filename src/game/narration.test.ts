import { describe, expect, it } from 'vitest';
import { createBattle, type BattleEvent, type BattleSetup } from '../sim/battle';
import { effectiveRange } from '../sim/beams';
import {
  armedTestDesign,
  duelSetup,
  launchingTestDesign,
  TEST_LASER,
  testDesign,
  testSetup,
  testSides,
} from '../sim/testing';
import { vec3 } from '../sim/vector';
import { createNarrator } from './narration';

const sides = testSides();

/** A battle's observation for blue, to narrate scripted events against. */
const observe = (setup: BattleSetup = testSetup()) => createBattle(setup).observe('blue');

describe('battle narration', () => {
  it('tells what happens to the own ship, and what it means', () => {
    const narrator = createNarrator('blue', sides);
    const lines = narrator.narrate(observe(), [
      { type: 'armour-breached', time: 10, side: 'blue', section: 'forward' },
      {
        type: 'component-lost',
        time: 10,
        side: 'blue',
        section: 'middle',
        mounted: true,
        index: 0,
        component: 'radiator',
      },
    ]);
    expect(lines).toEqual([
      { time: 10, text: 'Our forward armour breached.', about: 'own', major: true },
      {
        time: 10,
        text: 'Our radiator lost (middle) — our heat will rise.',
        about: 'own',
        major: true,
      },
    ]);
  });

  it('names an enemy part only when the sensors had made it out', () => {
    const lost: BattleEvent = {
      type: 'component-lost',
      time: 5,
      side: 'red',
      section: 'forward',
      mounted: true,
      index: 0,
      component: 'laser',
    };
    // Far off, red's laser mount is not made out: the loss is only "combat damage".
    const far = createNarrator('blue', sides);
    const distant = observe(duelSetup(testDesign(), armedTestDesign(), 400_000e3));
    expect(distant.contacts[0]?.mounts).toEqual([]);
    far.narrate(distant, []);
    expect(far.narrate(distant, [lost]).map((l) => l.text)).toEqual(['Enemy combat damage.']);
    // Close in, it is made out, and named with what its loss means.
    const near = createNarrator('blue', sides);
    const close = observe(duelSetup(testDesign(), armedTestDesign(), 2_000e3));
    expect(close.contacts[0]?.mounts.some((m) => m.section === 'forward' && m.mount === 0)).toBe(
      true,
    );
    near.narrate(close, []);
    expect(near.narrate(close, [lost]).map((l) => l.text)).toEqual([
      'Enemy laser torn away — one weapon fewer.',
    ]);
    // An internal part never shows what it was.
    expect(
      near.narrate(close, [{ ...lost, mounted: false, component: 'reactor' }]).map((l) => l.text),
    ).toEqual(['Enemy combat damage.']);
  });

  it.each<[string, BattleEvent]>([
    ['own armour breached', { type: 'armour-breached', time: 1, side: 'blue', section: 'engine' }],
    [
      'own component lost',
      {
        type: 'component-lost',
        time: 1,
        side: 'blue',
        section: 'engine',
        mounted: false,
        index: 0,
        component: 'drive',
      },
    ],
    [
      'own structural failure',
      { type: 'structural-failure', time: 1, side: 'blue', section: 'engine' },
    ],
    [
      'a magazine explosion',
      {
        type: 'magazine-explosion',
        time: 1,
        side: 'red',
        section: 'forward',
        index: 0,
        warheads: 1,
        energy: 1e12,
      },
    ],
    ['a withdrawal', { type: 'withdrawal', time: 1, side: 'red' }],
    [
      'the battle ending',
      { type: 'battle-ended', time: 1, outcome: { time: 1, winner: 'blue', sides: [] } },
    ],
  ])('tells %s, which slows time, as a major line', (_, event) => {
    const lines = createNarrator('blue', sides).narrate(observe(), [event]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.major).toBe(true);
  });

  it('tells a new missile threat at us, with when it strikes', () => {
    const setup = duelSetup(testDesign(), launchingTestDesign(2), 10_000e3);
    const battle = createBattle({
      ...setup,
      sides: setup.sides.map((side) => ({ ...side, commander: 'player' })),
    });
    const narrator = createNarrator('blue', sides);
    narrator.narrate(battle.observe('blue'), []);
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 2 });
    const events = battle.advance(1);
    const lines = narrator.narrate(battle.observe('blue'), events);
    expect(lines.map((l) => l.text)).toEqual([
      expect.stringMatching(/^A missile launched at us\. Impact in about \d+ min \d+ s\.$/),
    ]);
    expect(lines[0]?.major).toBe(true);
  });

  it('tells each time the ships come into or out of reach, either way', () => {
    // Red flies past blue's laser, which outreaches red's: in, then out, of blue's reach.
    const reach = effectiveRange(TEST_LASER);
    const battle = createBattle(
      testSetup({
        sides: testSides([armedTestDesign(), testDesign()]).map((s) => ({
          ...s,
          commander: 'player' as const,
        })),
        scenario: {
          name: 'Passing',
          starts: [
            { position: vec3(0, 0, 0), velocity: vec3(0, 0, 0) },
            { position: vec3(reach + 2_000e3, 1_000e3, 0), velocity: vec3(-4_000, 0, 0) },
          ],
        },
      }),
    );
    const narrator = createNarrator('blue', sides);
    const told: string[] = [];
    narrator.narrate(battle.observe('blue'), []);
    for (let t = 0; t < 2 * (reach / 4_000) + 2_000; t += 10) {
      told.push(...narrator.narrate(battle.observe('blue'), battle.advance(10)).map((l) => l.text));
    }
    expect(told.filter((t) => t.includes('reach'))).toEqual([
      'The enemy is now within reach of our weapons.',
      'The enemy has drawn out of our weapons’ reach.',
    ]);
  });

  it('tells the same unseen enemy damage in one update once', () => {
    const narrator = createNarrator('blue', sides);
    const unseen = (index: number): BattleEvent => ({
      type: 'component-lost',
      time: 3,
      side: 'red',
      section: 'middle',
      mounted: false,
      index,
      component: 'capacitor',
    });
    expect(narrator.narrate(observe(), [unseen(0), unseen(1)])).toHaveLength(1);
  });
});
