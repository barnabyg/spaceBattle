import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { createBattle, type Battle, type BattleEvent } from '../sim/battle';
import { IDENTITY } from '../sim/quaternion';
import {
  armedTestDesign,
  duelSetup,
  gunnedTestDesign,
  testDesign,
  testSetup,
  testSides,
} from '../sim/testing';
import { createBattleRunner, TIME_COMPRESSIONS, type TimeCompression } from './battleRunner';

const runner = () => createBattleRunner(createBattle(testSetup()));

describe('battle runner', () => {
  it('runs simulated time at real time by default', () => {
    const r = runner();
    for (let i = 0; i < 10; i++) r.update(0.1);
    expect(r.battle.time).toBeCloseTo(1);
  });

  it('stops the battle while paused', () => {
    const r = runner();
    r.togglePause();
    r.update(0.2);
    expect(r.battle.time).toBe(0);
    r.togglePause();
    r.update(0.2);
    expect(r.battle.time).toBeCloseTo(0.2);
  });

  it('compresses time up to 1000x', () => {
    const r = runner();
    TIME_COMPRESSIONS.forEach(() => {
      r.faster();
    });
    expect(r.timeCompression).toBe(1000);
    r.update(0.1);
    expect(r.battle.time).toBeCloseTo(100);
  });

  it('never goes below real time', () => {
    const r = runner();
    r.slower();
    expect(r.timeCompression).toBe(1);
  });

  it('carries fractions of a step over to the next update', () => {
    const r = runner();
    for (let i = 0; i < 60; i++) r.update(1 / 60);
    expect(r.battle.time).toBeCloseTo(1, 1);
  });

  it('drops to real time when a laser hits', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 50_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const r = createBattleRunner(battle);
    r.setTimeCompression(1000);
    const events = r.update(0.1);
    expect(events.map((e) => e.type)).toEqual(['hit']);
    expect(r.timeCompression).toBe(1);
    // The rest of the update's compressed time is not run.
    expect(r.battle.time).toBeLessThan(1);
  });

  it('drops to real time when a slug hits', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(1), testDesign(), 1_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const r = createBattleRunner(battle);
    r.setTimeCompression(1000);
    const events = r.update(0.1);
    expect(events.map((e) => e.type)).toEqual(['impact']);
    expect(r.timeCompression).toBe(1);
    expect(r.battle.time).toBeLessThan(100);
  });

  it('drops to real time when a component is lost', () => {
    const lost: BattleEvent = {
      type: 'component-lost',
      time: 0.1,
      side: 'blue',
      section: 'middle',
      mounted: true,
      index: 0,
      component: 'radiator',
    };
    const real = createBattle(testSetup());
    let stepsTaken = 0;
    // A battle whose 50th step loses a component.
    const scripted: Battle = {
      ...real,
      step: () => {
        stepsTaken += 1;
        real.step();
        return stepsTaken === 50 ? [lost] : [];
      },
    };
    const r = createBattleRunner(scripted);
    r.setTimeCompression(100);
    expect(r.update(0.1)).toEqual([lost]);
    expect(stepsTaken).toBe(50);
    expect(r.timeCompression).toBe(1);
  });

  it('stops when the battle ends', () => {
    const battle = createBattle(testSetup());
    const r = createBattleRunner(battle);
    r.setTimeCompression(100);
    r.update(0.1);
    const ended = battle.endBattle('blue');
    const time = battle.time;
    expect(r.update(0.1)).toEqual([]);
    expect(battle.time).toBe(time);
    expect(ended.map((e) => e.type)).toEqual(['battle-ended']);
  });

  it('drops to real time and stops at the step in which a ship loses', () => {
    // Blue's beam burns through red's unarmoured engine section and its drive.
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 20_000e3, IDENTITY));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const r = createBattleRunner(battle);
    const events: BattleEvent[] = [];
    while (!battle.outcome && battle.time < 3_600) {
      r.setTimeCompression(1000);
      events.push(...r.update(0.1));
    }
    expect(events.at(-1)?.type).toBe('battle-ended');
    expect(r.timeCompression).toBe(1);
    expect(battle.time).toBe(battle.outcome?.time);
  });

  it('lets computer captains command their sides, the same at any time compression', () => {
    const run = (compression: TimeCompression, updates: number) => {
      const sides = testSides([handMadeDesign('lance'), handMadeDesign('bastion')]);
      const r = createBattleRunner(createBattle(testSetup({ sides })));
      r.setTimeCompression(compression);
      for (let i = 0; i < updates; i++) r.update(0.1);
      return r.battle;
    };
    const realTime = run(1, 600);
    const compressed = run(100, 6);
    expect(compressed.time).toBe(realTime.time);
    // Red is the computer's: it targets blue and manoeuvres. Blue waits for the player's orders.
    const red = realTime.observe('red').ownShip;
    expect(red.weapons).toMatchObject({ target: 'blue', mode: 'fire-freely' });
    expect(red.manoeuvre).not.toBeNull();
    expect(realTime.observe('blue').ownShip.weapons.target).toBeNull();
    expect(compressed.observe('red')).toStrictEqual(realTime.observe('red'));
  });

  it('does not try to catch up a long gap in real time', () => {
    const r = runner();
    r.setTimeCompression(10);
    r.update(30);
    expect(r.battle.time).toBeLessThanOrEqual(2.5);
  });
});
