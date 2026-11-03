import { describe, expect, it } from 'vitest';
import { createBattle, type SideSetup } from './battle';
import type { Design, InternalComponentDesign } from './design';
import { launchingTestDesign, testDesign, testSetup, testSides, withSection } from './testing';

/** The test design with intelligence components inside its forward section. */
const withIntelligence = (...components: InternalComponentDesign[]): Design =>
  withSection(testDesign(), 'forward', { components });

const SCANNER = { type: 'long-range-scanner', mass: 20e3 } as const;
const interceptor = (quality: number) =>
  ({ type: 'signal-interceptor', mass: 10e3, quality }) as const;

/** The intelligence each side goes into a battle with, Blue then Red. */
const intelligence = (blue: Design, red: Design, seed = 1) => {
  const [b, r] = testSides([blue, red]) as [SideSetup, SideSetup];
  const battle = createBattle(testSetup({ seed, sides: [b, r] }));
  return [battle.observe('blue'), battle.observe('red')] as const;
};

describe('intelligence before a battle', () => {
  it('leaves a side without intelligence components knowing nothing before its sensors make it out', () => {
    const [blue] = intelligence(testDesign(), launchingTestDesign(4));
    expect(blue.intelligence).toEqual([{ enemy: 'red', design: null, facts: [] }]);
    const [contact] = blue.contacts;
    expect(contact?.detail).toBe('position');
    expect(contact?.hullSize).toBeNull();
  });

  it('shows a side with a long-range scanner the enemy design in full', () => {
    const enemy = launchingTestDesign(4);
    const [blue] = intelligence(withIntelligence(SCANNER), enemy);
    expect(blue.intelligence[0]?.design).toEqual(enemy);
  });

  it.each([
    [0.3, 3],
    [0.5, 5],
    [1, 10],
  ])('a signal interceptor of quality %f reveals %i true facts', (quality, count) => {
    const enemy = launchingTestDesign(4);
    const [blue] = intelligence(withIntelligence(interceptor(quality)), enemy);
    const facts = blue.intelligence[0]?.facts ?? [];
    expect(facts).toHaveLength(count);
    expect(
      new Set(facts.map((f) => (f.kind === 'armour' ? `armour ${f.section}` : f.kind))).size,
    ).toBe(count);
    for (const fact of facts) {
      if (fact.kind === 'hull-size') expect(fact.hullSize).toBe('frigate');
      if (fact.kind === 'drive-thrust') expect(fact.thrust).toBe(2e6);
      if (fact.kind === 'missiles') expect(fact.missiles).toBe(4);
      if (fact.kind === 'weapons') expect(fact.weapons).toEqual([{ type: 'launcher', count: 1 }]);
    }
    expect(blue.intelligence[0]?.design).toBeNull();
  });

  it('a signal interceptor picks its facts by chance, differently from one battle to another', () => {
    const own = withIntelligence(interceptor(0.3));
    const picked = (seed: number) =>
      intelligence(own, testDesign(), seed)[0]
        .intelligence[0]?.facts.map((f) => f.kind)
        .join();
    const picks = new Set([1, 2, 3, 4, 5, 6].map(picked));
    expect(picks.size).toBeGreaterThan(1);
    expect(picked(4)).toBe(picked(4));
  });

  it('a wrecked intelligence component learns nothing', () => {
    const own = withIntelligence(SCANNER, interceptor(1));
    const [b, r] = testSides([own, testDesign()]) as [SideSetup, SideSetup];
    const fresh = createBattle(testSetup({ sides: [b, r] })).observe('blue').ownShip.condition;
    const condition = { ...fresh, integrity: fresh.integrity.map((v, i) => (i < 2 ? 0 : v)) };
    const battle = createBattle(testSetup({ sides: [{ ...b, condition }, r] }));
    expect(battle.observe('blue').intelligence).toEqual([
      { enemy: 'red', design: null, facts: [] },
    ]);
  });

  it('gives the computer captain’s side its pre-battle knowledge by the same rules', () => {
    const [, blind] = intelligence(testDesign(), testDesign());
    expect(blind.intelligence).toEqual([{ enemy: 'blue', design: null, facts: [] }]);
    const [, scanning] = intelligence(testDesign(), withIntelligence(SCANNER, interceptor(0.5)));
    expect(scanning.intelligence[0]?.design).toEqual(testDesign());
    expect(scanning.intelligence[0]?.facts).toHaveLength(5);
  });
});
