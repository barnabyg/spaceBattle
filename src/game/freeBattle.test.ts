import { describe, expect, it } from 'vitest';
import { DEFAULT_FREE_BATTLE, startFreeBattle, type FreeBattleSetup } from './freeBattle';

describe('free battle', () => {
  it('fights the chosen designs, each side commanded as chosen', () => {
    const setup: FreeBattleSetup = {
      sides: [
        { designId: 'bastion', commander: 'computer' },
        { designId: 'lance', commander: 'computer' },
      ],
    };
    const { battle } = startFreeBattle(setup, 1);
    expect(battle.sides.map((s) => [s.id, s.name, s.design.id, s.commander])).toEqual([
      ['blue', 'Blue', 'bastion', 'computer'],
      ['red', 'Red', 'lance', 'computer'],
    ]);
    expect(battle.observe('blue').contacts.map((c) => c.sideId)).toEqual(['red']);
  });

  it('starts with the player in a frigate against a computer cruiser', () => {
    const { battle } = startFreeBattle(DEFAULT_FREE_BATTLE, 1);
    expect(battle.sides.map((s) => [s.design.hullSize, s.commander])).toEqual([
      ['frigate', 'player'],
      ['cruiser', 'computer'],
    ]);
  });

  it('runs: time passes and nothing has ended yet', () => {
    const runner = startFreeBattle(DEFAULT_FREE_BATTLE, 1);
    runner.update(0.2);
    expect(runner.battle.time).toBeGreaterThan(0);
    expect(runner.battle.observe('blue').outcome).toBeNull();
  });

  it('rejects a design that does not exist', () => {
    expect(() =>
      startFreeBattle({
        sides: [
          { designId: 'lance', commander: 'player' },
          { designId: 'nonesuch', commander: 'computer' },
        ],
      }),
    ).toThrow(/nonesuch/);
  });
});
