import { describe, expect, it } from 'vitest';
import { createBattle, type ShipCondition, type SideSetup } from './battle';
import { launchingTestDesign, testSetup, testSides } from './testing';

/** A missile frigate with some of its missiles and propellant gone and its reactor half wrecked. */
const design = launchingTestDesign(4);
const worn = (full: ShipCondition): ShipCondition => ({
  ...full,
  // Slots: the forward magazine and launcher, then the middle's thrusters, reactor and so on.
  integrity: full.integrity.map((value, i) => (i === 3 ? 0.5 : value)),
  sections: { ...full.sections, forward: { armour: 0, structure: 0.6 } },
  propellantMass: full.propellantMass / 2,
  magazines: full.magazines.map((m) => ({ ...m, missiles: m.missiles - 1 })),
});

describe('a ship starting a battle in the condition the last one left it', () => {
  const [blue, red] = testSides([design, design]) as [SideSetup, SideSetup];
  const fresh = createBattle(testSetup({ sides: [blue, red] })).observe('blue').ownShip;

  it('starts undamaged and full when no condition is given, and observes as much', () => {
    const { condition } = fresh;
    expect(condition.integrity.every((value) => value === 1)).toBe(true);
    expect(condition.propellantMass).toBe(design.propellantMass);
    expect(condition.sections.middle).toEqual({ armour: 0, structure: 1 });
    expect(condition.magazines.map((m) => m.missiles)).toEqual([4]);
  });

  it('starts with the damage, propellant and ammunition it is given', () => {
    const condition = worn(fresh.condition);
    const own = createBattle(testSetup({ sides: [{ ...blue, condition }, red] })).observe(
      'blue',
    ).ownShip;
    expect(own.condition).toEqual(condition);
    expect(own.propellantMass).toBe(design.propellantMass / 2);
    const middle = own.sections.find((s) => s.kind === 'middle');
    expect(middle?.components[1]?.integrity).toBe(0.5);
    expect(own.sections.find((s) => s.kind === 'forward')?.structure).toBe(0.6);
    expect(own.weapons.ammunition.missiles).toBe(3);
    // Lighter by half its propellant and one missile.
    expect(own.mass).toBeLessThan(fresh.mass - design.propellantMass / 2);
  });

  it('refuses a condition that does not fit its design', () => {
    const condition = { ...fresh.condition, integrity: [1] };
    expect(() => createBattle(testSetup({ sides: [{ ...blue, condition }, red] }))).toThrow(
      'condition',
    );
  });
});
