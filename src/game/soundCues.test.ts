import { describe, expect, it } from 'vitest';
import { createBattle, type Battle, type SideId } from '../sim/battle';
import type { Design } from '../sim/design';
import { OVERHEAT_TEMPERATURE } from '../sim/heat';
import { fromAxisAngle, IDENTITY } from '../sim/quaternion';
import {
  armedTestDesign,
  duelSetup,
  gunnedTestDesign,
  launchingTestDesign,
  testDesign,
  testMagazine,
  withComponent,
  withSection,
} from '../sim/testing';
import { vec3 } from '../sim/vector';
import { createSoundCues, type SoundCues } from './soundCues';

const KM = 1000;
/** Red side-on to blue with its nose along +y, so its drive pushes it across blue's line of fire. */
const ACROSS = fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);

/** A battle between two test designs, red facing blue `range` metres off. */
const duel = (blue: Design, red: Design, range: number, orientation?: typeof ACROSS): Battle =>
  createBattle(duelSetup(blue, red, range, orientation));

const sideOf = (battle: Battle, sideId: SideId) => {
  const side = battle.sides.find((s) => s.id === sideId);
  if (!side) throw new Error(`No side ${sideId}`);
  return side;
};

/**
 * Listens to a battle from inside one side's ship: each frame advances the battle by
 * `battleSeconds` while `realSeconds` of real time pass, and derives that frame's cues.
 */
const listen = (battle: Battle, sideId: SideId) => {
  const cues = createSoundCues(sideOf(battle, sideId));
  let now = 0;
  return {
    frame(battleSeconds = 0.1, realSeconds = battleSeconds, running = true): SoundCues {
      const events = running ? battle.advance(battleSeconds) : [];
      now += realSeconds;
      return cues.next({
        observation: battle.observe(sideId),
        events,
        running: running && !battle.outcome,
        realTime: now,
      });
    },
  };
};

/**
 * Every frame's cues for blue and red until a battle time, both hearing the same steps: each frame
 * advances the battle by `frameSeconds` while as much real time passes.
 */
const framesUntil = (battle: Battle, time: number, frameSeconds = 0.1) => {
  const blue = createSoundCues(sideOf(battle, 'blue'));
  const red = createSoundCues(sideOf(battle, 'red'));
  const frames = { blue: [] as SoundCues[], red: [] as SoundCues[] };
  let now = 0;
  while (battle.time < time && !battle.outcome) {
    const events = battle.advance(frameSeconds);
    now += frameSeconds;
    const frame = (sideId: SideId) => ({
      observation: battle.observe(sideId),
      events,
      running: !battle.outcome,
      realTime: now,
    });
    frames.blue.push(blue.next(frame('blue')));
    frames.red.push(red.next(frame('red')));
  }
  return frames;
};

const total = (frames: readonly SoundCues[], cue: 'gunShots' | 'launches') =>
  frames.reduce((sum, f) => sum + f[cue], 0);
const hits = (frames: readonly SoundCues[]) => frames.flatMap((f) => f.hullHits);
const silent = (cues: SoundCues) =>
  cues.drive === 0 &&
  cues.beams === 0 &&
  cues.beamsLanding === 0 &&
  cues.gunShots === 0 &&
  cues.pointDefenceBursts === 0 &&
  cues.launches === 0 &&
  cues.hullHits.length === 0 &&
  !cues.damage &&
  cues.alarms.length === 0;

describe('the sound cues derive from battle events for the player ship only', () => {
  it('rumble with the drive while the own ship burns, never with the enemy drive', () => {
    const battle = duel(testDesign(), testDesign(), 10_000 * KM);
    const blue = listen(battle, 'blue');
    const red = listen(battle, 'red');
    expect(blue.frame().drive).toBe(0);
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 60 });
    expect(blue.frame().drive).toBeCloseTo(1);
    expect(red.frame().drive).toBe(0);
    battle.giveOrder('blue', { type: 'burn', throttle: 0.5, duration: 60 });
    expect(blue.frame().drive).toBeCloseTo(0.5);
    // Paused, the drive falls silent though it is still ordered to burn.
    expect(blue.frame(0, 0.1, false).drive).toBe(0);
  });

  it('thump for each of the own kinetic gun shots, and hit the enemy hull without a sound', () => {
    // Red is left idle, so every slug hits.
    const battle = duel(gunnedTestDesign(5), testDesign(), 1_000 * KM);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const { blue, red } = framesUntil(battle, 120);
    expect(total(blue, 'gunShots')).toBe(5);
    expect(hits(blue)).toEqual([]);
    expect(total(red, 'gunShots')).toBe(0);
    expect(hits(red).map((h) => h.kind)).toEqual(['slug', 'slug', 'slug', 'slug', 'slug']);
    for (const hit of hits(red)) {
      expect(hit.strength).toBeGreaterThan(0);
      expect(hit.strength).toBeLessThanOrEqual(1);
    }
  });

  it('say nothing of an enemy slug that misses', () => {
    const heardByRed = (dodge: boolean) => {
      const battle = duel(gunnedTestDesign(1), testDesign(), 15_000 * KM, ACROSS);
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      const red = listen(battle, 'red');
      const frames: SoundCues[] = [];
      while (battle.observe('red').munitions.length === 0) frames.push(red.frame());
      // The slug takes over ten minutes to cross the gap; red burns as soon as it is fired.
      if (dodge) battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
      while (battle.observe('red').munitions.length > 0) frames.push(red.frame(1));
      return frames;
    };
    const dodged = heardByRed(true);
    expect(hits(dodged)).toEqual([]);
    expect(total(dodged, 'gunShots')).toBe(0);
    // Not dodged, the same slug is heard as it strikes the hull.
    expect(hits(heardByRed(false)).map((h) => h.kind)).toEqual(['slug']);
  });

  it('sound the own launches but not the enemy launches, and warn of a missile coming in', () => {
    const battle = duel(launchingTestDesign(1), testDesign(), 200 * KM);
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    const { blue, red } = framesUntil(battle, 600);
    expect(total(blue, 'launches')).toBe(1);
    expect(total(red, 'launches')).toBe(0);
    expect(red.some((f) => f.alarms.includes('missile-inbound'))).toBe(true);
    expect(blue.some((f) => f.alarms.includes('missile-inbound'))).toBe(false);
    // The missile is heard only when it strikes red.
    expect(hits(blue)).toEqual([]);
    expect(hits(red).map((h) => h.kind)).toEqual(['missile']);
  });

  it('hear the own beams fire, and enemy beams only as they land on the own hull', () => {
    const battle = duel(armedTestDesign(), testDesign(), 50_000 * KM);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const { blue, red } = framesUntil(battle, 10);
    expect(blue.at(-1)?.beams).toBeCloseTo(1);
    expect(red.at(-1)?.beams).toBe(0);
    expect(hits(blue)).toEqual([]);
    expect(blue.every((f) => f.beamsLanding === 0)).toBe(true);
    expect(hits(red).map((h) => h.kind)).toEqual(['beam']);
    expect(red.at(-1)?.beamsLanding).toBeGreaterThan(0);
  });

  it('sound the damage alarm when the own ship loses a component, not when the enemy does', () => {
    // Blue's beam burns through red's unarmoured engine section and its drive.
    const battle = duel(armedTestDesign(), testDesign(), 20_000 * KM, IDENTITY);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const { blue, red } = framesUntil(battle, 3_600, 1);
    expect(red.some((f) => f.damage)).toBe(true);
    expect(blue.some((f) => f.damage)).toBe(false);
  });

  it('take no gun shots from ammunition lost with a wrecked magazine', () => {
    const target: Design = withSection(gunnedTestDesign(50), 'forward', {
      armour: { type: 'ablative', thickness: 0.01 },
      components: [testMagazine(50)],
    });
    const battle = duel(armedTestDesign(), target, 20_000 * KM);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const red = listen(battle, 'red');
    const frames: SoundCues[] = [];
    while (battle.observe('red').ownShip.weapons.ammunition.slugs > 0 && battle.time < 3_600) {
      frames.push(red.frame(1));
    }
    expect(battle.observe('red').ownShip.weapons.ammunition.slugs).toBe(0);
    expect(total(frames, 'gunShots')).toBe(0);
    expect(frames.some((f) => f.damage)).toBe(true);
  });

  it('sound the overheat alarm while the own ship runs hotter than the overheat temperature', () => {
    // A radiator too small to shed the drive's heat.
    const hot = withComponent(testDesign(), 'radiator', { deployedArea: 10, retractedArea: 10 });
    const battle = duel(hot, testDesign(), 10_000 * KM);
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 36_000 });
    const blue = listen(battle, 'blue');
    let cues = blue.frame();
    expect(cues.alarms).toEqual([]);
    while (battle.observe('blue').ownShip.heat.temperature <= OVERHEAT_TEMPERATURE) {
      if (battle.time > 36_000) throw new Error('Never overheated');
      cues = blue.frame(10);
    }
    expect(cues.alarms).toEqual(['overheat']);
    // Paused, the alarm is silent.
    expect(blue.frame(0, 0.1, false).alarms).toEqual([]);
    // The enemy, running cool, hears nothing of it.
    expect(listen(battle, 'red').frame().alarms).toEqual([]);
  });

  it('sound the reserve alarm as the delta-v left nears the reserve, until the ship withdraws', () => {
    // Red burns most of its propellant away; blue, far off and unarmed, hears nothing.
    const battle = duel(testDesign(), { ...testDesign(), reserve: 40e3 }, 10_000 * KM);
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 36_000 });
    const red = listen(battle, 'red');
    expect(red.frame().alarms).toEqual([]);
    while (!battle.observe('red').ownShip.reserveWarning) {
      if (battle.time > 36_000) throw new Error('Never near the reserve');
      red.frame(10);
    }
    const cues = red.frame();
    expect(cues.alarms).toEqual(['reserve']);
    expect(listen(battle, 'blue').frame().alarms).toEqual([]);
    battle.giveOrder('red', { type: 'withdraw' });
    expect(red.frame(1).alarms).toEqual([]);
  });

  it('fall silent while paused and once the battle is over', () => {
    const battle = duel(armedTestDesign(), testDesign(), 50_000 * KM);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 60 });
    const blue = listen(battle, 'blue');
    expect(silent(blue.frame(1))).toBe(false);
    expect(silent(blue.frame(0, 0.1, false))).toBe(true);
    battle.endBattle('blue');
    expect(silent(blue.frame(0))).toBe(true);
  });

  it('never repeat a cue faster than the ear can follow under time compression', () => {
    const battle = duel(gunnedTestDesign(1_000), testDesign(), 1_000 * KM);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const blue = listen(battle, 'blue');
    // A minute of battle a second: the gun fires 60 times while one second passes.
    const frames = Array.from({ length: 60 }, () => blue.frame(1, 1 / 60));
    expect(battle.observe('blue').ownShip.weapons.ammunition.slugs).toBeLessThan(950);
    const shots = total(frames, 'gunShots');
    expect(shots).toBeGreaterThan(0);
    expect(shots).toBeLessThanOrEqual(10);
  });
});
