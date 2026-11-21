import { describe, expect, it } from 'vitest';
import { createBattle, type Battle, type BattleSetup, type OwnShipObservation } from './battle';
import { withComputerCaptains } from './command';
import { componentSlots } from './components';
import type { ComponentType, Design } from './design';
import { REPAIR_CAP, REPAIR_PAUSE, REPAIR_RATE } from './repair';
import { fullCondition, type ShipCondition } from './ship';
import { armedTestDesign, duelSetup, testDesign, withSection } from './testing';

/** Blue's condition with the first component of each listed type at that integrity. */
const damaged = (
  design: Design,
  integrity: Partial<Record<ComponentType, number>>,
): ShipCondition => {
  const full = fullCondition(design);
  const slots = componentSlots(design);
  return {
    ...full,
    integrity: full.integrity.map((value, i) => {
      const type = slots[i]?.component.type;
      const first = slots.findIndex((s) => s.component.type === type) === i;
      return type && first && integrity[type] !== undefined ? integrity[type] : value;
    }),
  };
};

/** Blue, damaged, against red; both players' unless red's commander is given. */
const battleWith = (
  blue: Design,
  condition: ShipCondition,
  red: Design = testDesign(),
  redCommander: 'player' | 'computer' = 'player',
  range = 50_000e3,
): Battle => {
  const setup: BattleSetup = duelSetup(blue, red, range);
  return createBattle({
    ...setup,
    sides: setup.sides.map((side) =>
      side.id === 'blue'
        ? { ...side, commander: 'player', condition }
        : { ...side, commander: redCommander },
    ),
  });
};

const own = (battle: Battle, side = 'blue'): OwnShipObservation => battle.observe(side).ownShip;

/** The integrity of the first component of a type on a ship. */
const integrityOf = (ship: OwnShipObservation, type: ComponentType) =>
  ship.sections.flatMap((s) => [...s.components, ...s.mounts]).find((c) => c.type === type)
    ?.integrity ?? NaN;

/** Where the first component of a type sits. */
const addressOf = (design: Design, type: ComponentType) => {
  const slot = componentSlots(design).find((s) => s.component.type === type);
  if (!slot) throw new Error(`No ${type}`);
  return { section: slot.section, mounted: slot.mounted, index: slot.index };
};

describe('damage control', () => {
  it('repairs the chosen component at its rate, up to a field repair, then stops', () => {
    const design = testDesign();
    const battle = battleWith(design, damaged(design, { radiator: 0.3 }));
    battle.giveOrder('blue', { type: 'repair', target: addressOf(design, 'radiator') });
    expect(own(battle).repair).toMatchObject({ type: 'radiator', state: 'working' });
    battle.advance(50);
    expect(integrityOf(own(battle), 'radiator')).toBeCloseTo(0.3 + 50 * REPAIR_RATE, 6);
    battle.advance((REPAIR_CAP - 0.3) / REPAIR_RATE);
    expect(integrityOf(own(battle), 'radiator')).toBeCloseTo(REPAIR_CAP, 9);
    expect(own(battle).repair).toBeNull();
    battle.advance(60);
    expect(integrityOf(own(battle), 'radiator')).toBe(REPAIR_CAP);
  });

  it.each<[string, number, RegExp]>([
    ['wrecked', 0, /wrecked/],
    ['already patched up', REPAIR_CAP, /as sound/],
    ['undamaged', 1, /as sound/],
  ])('refuses a component that is %s', (_, integrity, reason) => {
    const design = testDesign();
    const battle = battleWith(design, damaged(design, { radiator: integrity }));
    expect(() => {
      battle.giveOrder('blue', { type: 'repair', target: addressOf(design, 'radiator') });
    }).toThrow(reason);
    expect(own(battle).repair).toBeNull();
  });

  it('pauses while the section is under fire, and resumes once it has been quiet a while', () => {
    // A capacitor in blue's nose, which faces red's laser.
    const design = withSection(testDesign(), 'forward', {
      components: [
        { type: 'capacitor', mass: 5e3, capacity: 1e9, maxCharge: 1e8, maxDischarge: 1e9 },
      ],
      armour: { type: 'ablative', thickness: 1 },
    });
    const battle = battleWith(design, damaged(design, { capacitor: 0.3 }), armedTestDesign());
    battle.giveOrder('blue', { type: 'repair', target: addressOf(design, 'capacitor') });
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    battle.advance(60);
    expect(own(battle).repair?.state).toBe('paused');
    const held = integrityOf(own(battle), 'capacitor');
    expect(held).toBeLessThan(0.31);
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'hold-fire' });
    battle.advance(REPAIR_PAUSE / 2);
    expect(own(battle).repair?.state).toBe('paused');
    battle.advance(REPAIR_PAUSE);
    expect(own(battle).repair?.state).toBe('working');
    expect(integrityOf(own(battle), 'capacitor')).toBeGreaterThan(held);
  });

  it('can be stopped', () => {
    const design = testDesign();
    const battle = battleWith(design, damaged(design, { radiator: 0.3 }));
    battle.giveOrder('blue', { type: 'repair', target: addressOf(design, 'radiator') });
    battle.giveOrder('blue', { type: 'repair', target: null });
    battle.advance(60);
    expect(own(battle).repair).toBeNull();
    expect(integrityOf(own(battle), 'radiator')).toBe(0.3);
  });

  it('is set by a computer captain of medium skill: the drive before the radiator', () => {
    const design = testDesign();
    const setup: BattleSetup = duelSetup(testDesign(), design, 50_000e3);
    const battle = withComputerCaptains(
      createBattle({
        ...setup,
        sides: setup.sides.map((side) =>
          side.id === 'red'
            ? { ...side, condition: damaged(design, { radiator: 0.2, drive: 0.5 }) }
            : side,
        ),
      }),
    );
    battle.advance(5);
    expect(own(battle, 'red').repair).toMatchObject({ type: 'drive', state: 'working' });
  });

  it('shows a damaged drive as a faltering plume, to its own captain and to the enemy', () => {
    const design = testDesign();
    // One of its two drive units down to 0.4 leaves the drive at 0.7 of its thrust.
    const battle = battleWith(design, damaged(design, { drive: 0.4 }));
    expect(own(battle).appearance.driveFalter).toBeCloseTo(0.3);
    expect(battle.observe('red').contacts[0]?.appearance.driveFalter).toBeCloseTo(0.3);
  });
});
