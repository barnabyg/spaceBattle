import { describe, expect, it } from 'vitest';
import { createBattle, TIME_STEP, type BattleEvent, type BattleSetup } from '../sim/battle';
import {
  armedTestDesign,
  duelSetup,
  launchingTestDesign,
  testDesign,
  testSetup,
  testSides,
} from '../sim/testing';
import { ADVANCE_DURATION, ownReach, separationOf, type AdvanceCondition } from './advance';
import { createBattleRunner, type BattleRunner } from './battleRunner';

/** Both sides left to players, so nothing slows time but the advance itself. */
const playersOnly = (setup: BattleSetup): BattleSetup => ({
  ...setup,
  sides: setup.sides.map((side) => ({ ...side, commander: 'player' })),
});

/** The test scenario's ships close at about 2 km/s from 200,000 km apart. */
const closingRunner = (designs = testSides()) =>
  createBattleRunner(createBattle(playersOnly(testSetup({ sides: designs }))));

/** Runs real time through the runner until it pauses, or gives up. */
const runUntilPaused = (r: BattleRunner) => {
  const events: BattleEvent[] = [];
  for (let i = 0; i < 2_000 && !r.paused && !r.battle.outcome; i++) events.push(...r.update(0.25));
  return events;
};

const blueSeparation = (r: BattleRunner) => separationOf(r.battle.observe('blue')) ?? NaN;

describe('advancing the battle until a condition', () => {
  it('runs at the highest compression until the separation is reached, then pauses', () => {
    const r = closingRunner();
    r.setTimeCompression(10);
    const start = blueSeparation(r);
    const goal = start - 10_000e3;
    expect(r.advanceUntil('blue', { type: 'separation', distance: goal })).toBeNull();
    expect(r.advancing).toEqual({ type: 'separation', distance: goal });
    expect(r.timeCompression).toBe(1000);
    runUntilPaused(r);
    expect(r.paused).toBe(true);
    expect(r.advancing).toBeNull();
    expect(r.advanceReached).toEqual({ type: 'separation', distance: goal });
    // The first step at or inside the goal: closing at about 2 km/s, within one step of it.
    const separation = blueSeparation(r);
    expect(separation).toBeLessThanOrEqual(goal);
    expect(goal - separation).toBeLessThan(3_000 * TIME_STEP);
    // It resumes at the speed chosen before.
    expect(r.timeCompression).toBe(10);
    r.togglePause();
    expect(r.advanceReached).toBeNull();
  });

  it('waits for an opening separation when the ships start inside it', () => {
    const r = closingRunner();
    const goal = blueSeparation(r) + 1_000e3;
    // Closing, the ships never open to it: the advance is still running at the time limit.
    expect(r.advanceUntil('blue', { type: 'separation', distance: goal })).toBeNull();
    for (let i = 0; i < 20; i++) r.update(0.25);
    expect(r.paused).toBe(false);
    expect(r.advancing).not.toBeNull();
  });

  it('pauses once the enemy comes within reach of its own weapons', () => {
    const r = closingRunner(testSides([armedTestDesign(), testDesign()]));
    expect(r.advanceUntil('blue', { type: 'own-reach' })).toBeNull();
    runUntilPaused(r);
    const observation = r.battle.observe('blue');
    expect(r.advanceReached).toEqual({ type: 'own-reach' });
    const separation = separationOf(observation) ?? NaN;
    expect(separation).toBeLessThanOrEqual(ownReach(observation));
    expect(ownReach(observation) - separation).toBeLessThan(3_000 * TIME_STEP);
  });

  it('runs for ten minutes of battle time', () => {
    const r = closingRunner();
    r.update(0.1);
    const start = r.battle.time;
    expect(r.advanceUntil('blue', { type: 'duration', seconds: ADVANCE_DURATION })).toBeNull();
    runUntilPaused(r);
    expect(r.battle.time).toBeCloseTo(start + ADVANCE_DURATION, 5);
  });

  it('pauses at the next missile launch', () => {
    // Red is the computer's, unarmed, so it stays put and only Blue's launch happens.
    const battle = createBattle(duelSetup(launchingTestDesign(1), testDesign(), 10_000e3));
    const r = createBattleRunner(battle);
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    expect(r.advanceUntil('blue', { type: 'launch' })).toBeNull();
    const events = runUntilPaused(r);
    expect(r.advanceReached).toEqual({ type: 'launch' });
    expect(events.at(-1)).toMatchObject({ type: 'launch' });
  });

  it('stops early at 1× for an event that needs the captain, naming it', () => {
    const lost: BattleEvent = {
      type: 'armour-breached',
      time: 1,
      side: 'blue',
      section: 'forward',
    };
    const real = createBattle(testSetup());
    let steps = 0;
    const r = createBattleRunner({
      ...real,
      step: () => {
        steps += 1;
        real.step();
        return steps === 100 ? [lost] : [];
      },
    });
    r.setTimeCompression(100);
    expect(r.advanceUntil('blue', { type: 'duration', seconds: ADVANCE_DURATION })).toBeNull();
    r.update(0.25);
    expect(steps).toBe(100);
    expect(r.paused).toBe(false);
    expect(r.advancing).toBeNull();
    expect(r.advanceReached).toBeNull();
    expect(r.timeCompression).toBe(1);
    expect(r.slowdownEvent).toEqual(lost);
  });

  it('is cancelled by choosing a speed or pausing, back at the speed chosen before', () => {
    const r = closingRunner();
    r.setTimeCompression(100);
    const condition: AdvanceCondition = { type: 'duration', seconds: ADVANCE_DURATION };
    r.advanceUntil('blue', condition);
    r.setTimeCompression(10);
    expect(r.advancing).toBeNull();
    expect(r.timeCompression).toBe(10);
    r.advanceUntil('blue', condition);
    r.togglePause();
    expect(r.advancing).toBeNull();
    expect(r.paused).toBe(true);
    expect(r.timeCompression).toBe(10);
    // Advancing from a pause resumes the battle.
    r.advanceUntil('blue', condition);
    expect(r.paused).toBe(false);
    expect(r.timeCompression).toBe(1000);
  });

  it.each<[string, AdvanceCondition, string]>([
    ['the enemy is already in reach', { type: 'own-reach' }, 'Already within reach of our weapons'],
    [
      'no separation above zero',
      { type: 'separation', distance: 0 },
      'Enter a separation above 0 km',
    ],
    [
      'an unbounded separation',
      { type: 'separation', distance: Infinity },
      'Enter a separation above 0 km',
    ],
  ])('refuses to start when %s', (_, condition, reason) => {
    const r = createBattleRunner(
      createBattle(playersOnly(duelSetup(armedTestDesign(), testDesign(), 20_000e3))),
    );
    r.setTimeCompression(10);
    expect(r.advanceUntil('blue', condition)).toBe(reason);
    expect(r.advancing).toBeNull();
    expect(r.timeCompression).toBe(10);
  });

  it('refuses to advance until its own reach without a weapon', () => {
    expect(closingRunner().advanceUntil('blue', { type: 'own-reach' })).toBe(
      'No weapon with a reach',
    );
  });
});
