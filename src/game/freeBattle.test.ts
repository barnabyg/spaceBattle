import { describe, expect, it } from 'vitest';
import { HEAD_ON, OPENING_PASS, PURSUIT } from '../data/scenarios';
import type { SideObservation } from '../sim/battle';
import type { Order } from '../sim/orders';
import { distance } from '../sim/vector';
import { runBatchBattle } from './batch';
import {
  DEFAULT_FREE_BATTLE,
  freeBattleBatch,
  freeBattleSides,
  startFreeBattle,
  type FreeBattleSetup,
} from './freeBattle';
import type { RecordedAction } from './orderLog';

/** How far apart a side sees the ships. */
const separation = ({ ownShip, contacts }: SideObservation) =>
  distance(ownShip.position, contacts[0]?.position ?? ownShip.position);

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

  it("gives a computer side's captain the chosen skill, medium if none is chosen", () => {
    const sides = freeBattleSides({
      sides: [
        { designId: 'lance', commander: 'computer', skill: 'high' },
        { designId: 'lance', commander: 'computer' },
      ],
    });
    expect(sides.map((side) => side.skill ?? 'medium')).toEqual(['high', 'medium']);
    const batch = freeBattleBatch(
      {
        sides: [
          { designId: 'lance', commander: 'player', skill: 'low' },
          DEFAULT_FREE_BATTLE.sides[1],
        ],
      },
      { battles: 1, seed: 1, timeLimit: 60 },
    );
    expect(batch.sides[0]?.skill).toBe('low');
  });

  it('starts in the opening pass unless another scenario is chosen', () => {
    const opening = startFreeBattle(DEFAULT_FREE_BATTLE, 1).battle.observe('blue');
    expect(separation(opening)).toBeCloseTo(OPENING_PASS.separation, -3);
    const headOn = startFreeBattle({ ...DEFAULT_FREE_BATTLE, scenarioId: 'head-on' }, 1);
    expect(separation(headOn.battle.observe('blue'))).toBeCloseTo(HEAD_ON.separation, -3);
  });

  it('replays a battle in the scenario it was fought in', () => {
    const setup: FreeBattleSetup = { ...DEFAULT_FREE_BATTLE, scenarioId: 'pursuit' };
    const first = startFreeBattle(setup, 2, { timeLimit: 60 });
    first.update(0.2);
    const replay = startFreeBattle(setup, 2, { timeLimit: 60, replay: first.orders });
    expect(separation(replay.battle.observe('blue'))).toBeCloseTo(PURSUIT.separation, -3);
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

  describe('in test mode, replays a battle with a player side exactly', () => {
    const timeLimit = 1_800;
    /** What the player does once the battle's time reaches `time`, s. */
    type Play = readonly [time: number, action: Order | 'end-battle'];

    /** Fights the default free battle to its end, playing Blue as `plays` say. */
    const fight = (replay?: readonly RecordedAction[], plays: readonly Play[] = []) => {
      const runner = startFreeBattle(DEFAULT_FREE_BATTLE, 5, {
        timeLimit,
        ...(replay && { replay }),
      });
      const events = [];
      let next = 0;
      while (!runner.battle.outcome) {
        runner.setTimeCompression(1000);
        events.push(...runner.update(0.037));
        const play = plays[next];
        if (play && runner.battle.time >= play[0]) {
          const [, action] = play;
          if (action === 'end-battle') events.push(...runner.battle.endBattle('blue'));
          else runner.battle.giveOrder('blue', action);
          next++;
        }
      }
      return {
        orders: runner.orders,
        log: {
          events,
          outcome: runner.battle.outcome,
          blue: runner.battle.observe('blue'),
          red: runner.battle.observe('red'),
        },
      };
    };

    it("gives the player's orders again at the same moments", () => {
      const first = fight(undefined, [
        [20, { type: 'radiators', deployed: true }],
        [140, { type: 'manoeuvre', goal: 'close', range: 50e6 }],
        [700, { type: 'weapons', target: 'red', mode: 'fire-freely' }],
        [900, { type: 'radiators', deployed: false }],
      ]);
      expect(first.orders.map((o) => o.action.type)).toEqual(['order', 'order', 'order', 'order']);
      // The orders change the battle, so a replay without them would not match.
      expect(fight().log).not.toStrictEqual(first.log);
      expect(fight(first.orders).log).toStrictEqual(first.log);
    }, 20_000);

    it('ends the replay where the player ended the battle', () => {
      const first = fight(undefined, [[300, 'end-battle']]);
      expect(first.log.outcome.time).toBeLessThan(timeLimit);
      expect(fight(first.orders).log).toStrictEqual(first.log);
    });

    it('records the replayed orders too, so a replay can be replayed', () => {
      const first = fight(undefined, [[60, { type: 'attitude', mode: 'away' }]]);
      expect(first.orders).toHaveLength(1);
      expect(fight(first.orders).orders).toStrictEqual(first.orders);
    });
  });

  it('batches battles between the chosen designs, both commanded by the computer', () => {
    const batch = freeBattleBatch(DEFAULT_FREE_BATTLE, { battles: 100, seed: 4, timeLimit: 600 });
    expect(batch).toMatchObject({ battles: 100, seed: 4, timeLimit: 600 });
    expect(batch.sides.map((s) => [s.id, s.design.id])).toEqual([
      ['blue', 'lance'],
      ['red', 'bastion'],
    ]);
    expect(runBatchBattle(batch, 0).outcome).toMatchObject({ winner: null });
    expect(batch.scenario).toBe(OPENING_PASS);
  });

  it('batches battles in the chosen scenario', () => {
    const setup: FreeBattleSetup = { ...DEFAULT_FREE_BATTLE, scenarioId: 'head-on' };
    const batch = freeBattleBatch(setup, { battles: 2, seed: 4, timeLimit: 600 });
    expect(batch.scenario).toBe(HEAD_ON);
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

  it('rejects a scenario that does not exist', () => {
    expect(() => startFreeBattle({ ...DEFAULT_FREE_BATTLE, scenarioId: 'nonesuch' })).toThrow(
      /nonesuch/,
    );
  });
});
