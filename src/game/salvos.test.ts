import { describe, expect, it } from 'vitest';
import { createBattle, type Battle, type BattleEvent, type BattleSetup } from '../sim/battle';
import { defendedTestDesign, duelSetup, launchingTestDesign, testDesign } from '../sim/testing';
import { createSalvoTracker, SALVO_LINGER, type SalvoEntry } from './salvos';

/** Red launches at blue, both players' sides so neither captain acts on its own. */
const duel = (blue = testDesign(), red = launchingTestDesign(2), range = 10_000e3): Battle => {
  const setup: BattleSetup = duelSetup(blue, red, range);
  return createBattle({
    ...setup,
    sides: setup.sides.map((side) => ({ ...side, commander: 'player' })),
  });
};

/** Advances `battle` by `seconds`, then updates the tracker with what happened and what blue sees. */
const step = (tracker: ReturnType<typeof createSalvoTracker>, battle: Battle, seconds: number) => {
  const events = battle.advance(seconds);
  return tracker.update(battle.observe('blue'), events);
};

/** Advances `battle` in steps of `seconds`, feeding the tracker, until `done` or a limit. */
const follow = (
  battle: Battle,
  done: (entries: readonly SalvoEntry[], events: readonly BattleEvent[]) => boolean,
  seconds = 1,
) => {
  const tracker = createSalvoTracker('blue');
  let entries: SalvoEntry[] = tracker.update(battle.observe('blue'), []);
  let events: readonly BattleEvent[] = [];
  for (let i = 0; i < 20_000 && !done(entries, events); i++) {
    events = battle.advance(seconds);
    entries = tracker.update(battle.observe('blue'), events);
  }
  return { tracker, entries, events };
};

describe('incoming salvo timeline', () => {
  it('groups missiles launched at the ship within the salvo window into one salvo', () => {
    const battle = duel();
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 2 });
    const { entries } = follow(battle, (e) => (e[0]?.missiles ?? 0) >= 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      missiles: 2,
      inFlight: 2,
      warhead: 'kinetic',
      state: 'incoming',
    });
    expect(entries[0]?.ids).toHaveLength(2);
  });

  it('counts down to impact, matching when the missile strikes to within a second', () => {
    const battle = duel(testDesign(), launchingTestDesign(2), 20_000e3);
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    // On its final approach, at a steady closing speed on the coasting ship, the countdown holds.
    const close = follow(battle, (e) => (e[0]?.impactIn ?? Infinity) <= 30);
    const predicted = battle.time + (close.entries[0]?.impactIn ?? NaN);
    const tracker = close.tracker;
    let struck = false;
    for (let i = 0; i < 1_000 && !struck; i++) {
      const events = battle.advance(0.1);
      tracker.update(battle.observe('blue'), events);
      struck = events.some((e) => e.type === 'impact' && e.target === 'blue');
    }
    expect(struck).toBe(true);
    expect(Math.abs(battle.time - predicted)).toBeLessThan(1);
  });

  it('tells when point defence can engage, counts what it shoots down, then marks and drops the salvo', () => {
    // Red keeps a second missile, so the battle goes on after the first is shot down.
    const battle = duel(defendedTestDesign({ mounts: 4 }), launchingTestDesign(2), 2_000e3);
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    const launched = follow(battle, (e) => e.length > 0);
    const before = launched.entries[0];
    expect(before?.pointDefenceIn).toBeGreaterThan(0);
    const tracker = launched.tracker;
    let entries: SalvoEntry[] = launched.entries;
    let sawInside = false;
    for (let i = 0; i < 5_000 && entries[0]?.state === 'incoming'; i++) {
      entries = step(tracker, battle, 0.5);
      if (entries[0]?.state === 'incoming' && entries[0].pointDefenceIn === 0) sawInside = true;
    }
    expect(sawInside).toBe(true);
    expect(entries[0]).toMatchObject({ state: 'defeated', inFlight: 0, shotDown: 1, struck: 0 });
    // It stays marked for a while, then leaves the timeline.
    const over = battle.time;
    const after = (seconds: number) => {
      while (battle.time < over + seconds) {
        entries = step(tracker, battle, 1);
      }
      return entries;
    };
    expect(after(SALVO_LINGER / 2)).toHaveLength(1);
    expect(after(SALVO_LINGER + 2)).toEqual([]);
  });

  it('ignores missiles launched at the enemy and anti-missile missiles', () => {
    const battle = duel(launchingTestDesign(1), testDesign());
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    const { entries } = follow(battle, () => battle.time > 30);
    expect(entries).toEqual([]);
  });
});
