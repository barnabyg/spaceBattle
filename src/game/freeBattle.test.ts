import { describe, expect, it } from 'vitest';
import { runBatchBattle } from './batch';
import {
  DEFAULT_FREE_BATTLE,
  freeBattleBatch,
  startFreeBattle,
  type FreeBattleSetup,
} from './freeBattle';

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

  it('in test mode, ends with no result at the time limit and compresses time above 1000x', () => {
    const runner = startFreeBattle(DEFAULT_FREE_BATTLE, 1, { timeLimit: 60 });
    runner.setTimeCompression(1000);
    while (!runner.battle.outcome) runner.update(0.1);
    expect(runner.battle.outcome.time).toBeCloseTo(60);
    expect(runner.battle.outcome.winner).toBeNull();
    runner.setTimeCompression(10_000);
    expect(runner.timeCompression).toBe(10_000);
  });

  it('fights the same battle again from the same seed', () => {
    const setup: FreeBattleSetup = {
      sides: [
        { designId: 'bastion', commander: 'computer' },
        { designId: 'lance', commander: 'computer' },
      ],
    };
    const fight = (seed: number) => {
      const runner = startFreeBattle(setup, seed, { timeLimit: 600 });
      runner.setTimeCompression(1000);
      const events = [];
      while (!runner.battle.outcome) events.push(...runner.update(0.1));
      return { events, blue: runner.battle.observe('blue'), red: runner.battle.observe('red') };
    };
    expect(fight(3)).toStrictEqual(fight(3));
  });

  it('batches battles between the chosen designs, both commanded by the computer', () => {
    const batch = freeBattleBatch(DEFAULT_FREE_BATTLE, { battles: 100, seed: 4, timeLimit: 600 });
    expect(batch).toMatchObject({ battles: 100, seed: 4, timeLimit: 600 });
    expect(batch.sides.map((s) => [s.id, s.design.id])).toEqual([
      ['blue', 'lance'],
      ['red', 'bastion'],
    ]);
    expect(runBatchBattle(batch, 0).outcome).toMatchObject({ winner: null });
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
