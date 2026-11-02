import { describe, expect, it } from 'vitest';
import { createBattle } from '../sim/battle';
import { testSetup } from '../sim/testing';
import { createBattleRunner, TIME_COMPRESSIONS } from './battleRunner';

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

  it('does not try to catch up a long gap in real time', () => {
    const r = runner();
    r.setTimeCompression(10);
    r.update(30);
    expect(r.battle.time).toBeLessThanOrEqual(2.5);
  });
});
