import { describe, expect, it } from 'vitest';
import {
  createBattle,
  type Battle,
  type BattleEvent,
  type OwnShipObservation,
  type SectionObservation,
} from './battle';
import type { ArmourDesign, Design } from './design';
import { fromAxisAngle } from './quaternion';
import {
  armedTestDesign,
  duelSetup,
  gunnedTestDesign,
  TEST_KINETIC_GUN,
  testDesign,
  testMagazine,
  withSection,
} from './testing';
import { add, length, normalize, scale, vec3, ZERO } from './vector';

const KM = 1000;
/** Red side-on to blue with its nose along +y, so its drive pushes it across blue's line of fire. */
const ACROSS = fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
const { slugMass, muzzleVelocity, efficiency } = TEST_KINETIC_GUN;
const SLUG_ENERGY = 0.5 * slugMass * muzzleVelocity ** 2;
const SHOT_ENERGY = SLUG_ENERGY / efficiency;

const fireAtRed = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
};

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const section = (ship: OwnShipObservation, kind: SectionObservation['kind']) => {
  const found = ship.sections.find((s) => s.kind === kind);
  if (!found) throw new Error(`No ${kind} section`);
  return found;
};

const impactsOn = (events: readonly BattleEvent[], target: string) =>
  events.flatMap((e) => (e.type === 'impact' && e.target === target ? [e] : []));

const slugsFired = (battle: Battle) => {
  const { slugs, slugCapacity } = own(battle, 'blue').weapons.ammunition;
  return slugCapacity - slugs;
};

/** Steps the battle until no slug is in flight, returning what happened. */
const untilSlugsLand = (battle: Battle, limit: number): BattleEvent[] => {
  const events: BattleEvent[] = [];
  while (battle.observe('blue').munitions.length > 0) {
    if (battle.time > limit) throw new Error('Slugs still in flight');
    events.push(...battle.step());
  }
  return events;
};

describe('kinetic guns', () => {
  it('lead a target holding constant acceleration, so every slug hits', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(10), testDesign(), 2_000 * KM, ACROSS));
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
    fireAtRed(battle);
    const events = [...battle.advance(20), ...untilSlugsLand(battle, 600)];
    expect(slugsFired(battle)).toBe(10);
    expect(impactsOn(events, 'red')).toHaveLength(10);
    // Each slug flew for most of two minutes while red accelerated across the line of fire, so a
    // slug aimed where red was, or where it was drifting to, would have missed by kilometres.
    const red = own(battle, 'red');
    expect(red.acceleration.y).toBeGreaterThan(2);
    expect(red.position.y).toBeGreaterThan(10 * KM);
  });

  it('miss at long range a target that changes its acceleration after they are fired', () => {
    const fireOneSlug = (dodge: boolean) => {
      const battle = createBattle(
        duelSetup(gunnedTestDesign(1), testDesign(), 15_000 * KM, ACROSS),
      );
      fireAtRed(battle);
      while (battle.observe('blue').munitions.length === 0) battle.step();
      // The slug takes over ten minutes to cross the gap; red burns as soon as it is fired.
      if (dodge) battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
      return impactsOn(untilSlugsLand(battle, 2_000), 'red');
    };
    expect(fireOneSlug(false)).toHaveLength(1);
    expect(fireOneSlug(true)).toHaveLength(0);
  });

  it('stop firing when the magazine is empty', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(5), testDesign(), 1_000 * KM));
    expect(own(battle, 'blue').weapons.ammunition).toMatchObject({ slugs: 5, slugCapacity: 5 });
    fireAtRed(battle);
    const events = battle.advance(120);
    const blue = own(battle, 'blue');
    expect(blue.weapons.ammunition).toMatchObject({ slugs: 0, slugCapacity: 5 });
    expect(impactsOn(events, 'red')).toHaveLength(5);
    expect(battle.observe('blue').munitions).toEqual([]);
    // With nothing left to fire the gun draws no power, and no more slugs arrive.
    expect(blue.weapons.kineticGuns[0]?.firing).toBe(false);
    expect(blue.power.systems.weapons.demand).toBe(0);
    expect(impactsOn(battle.advance(120), 'red')).toEqual([]);
  });

  it('draw power for each shot at their rate of fire and turn what the slug does not take into heat', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(100), testDesign(), 10_000 * KM));
    fireAtRed(battle);
    battle.advance(10);
    const blue = own(battle, 'blue');
    // One shot a second, each once its energy is drawn: the first after a second's charging.
    expect(slugsFired(battle)).toBe(10);
    expect(blue.power.systems.weapons.supplied).toBeCloseTo(SHOT_ENERGY * 1, -3);
    const { delivered, slugEnergy } = blue.energyLedger;
    expect(delivered.weapons).toBeCloseTo(10 * SHOT_ENERGY, -3);
    expect(slugEnergy).toBeCloseTo(10 * SLUG_ENERGY, -3);
    expect(blue.weapons.kineticGuns[0]).toMatchObject({
      firing: true,
      shotEnergy: SHOT_ENERGY,
      muzzleVelocity,
      slugMass,
    });
  });

  it('hold fire beyond their effective range, or when ordered to', () => {
    const far = createBattle(duelSetup(gunnedTestDesign(10), testDesign(), 200_000 * KM));
    fireAtRed(far);
    far.advance(5);
    const gun = own(far, 'blue').weapons.kineticGuns[0];
    expect(gun?.effectiveRange).toBeLessThan(200_000 * KM);
    expect(gun?.firing).toBe(false);
    expect(far.observe('blue').munitions).toEqual([]);

    const holding = createBattle(duelSetup(gunnedTestDesign(10), testDesign(), 1_000 * KM));
    holding.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    holding.advance(5);
    expect(own(holding, 'blue').weapons.ammunition.slugs).toBe(10);
  });

  it('show both sides every slug in flight, leaving the gun at its muzzle velocity', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(10), testDesign(), 10_000 * KM));
    fireAtRed(battle);
    while (battle.observe('blue').munitions.length === 0) battle.step();
    const [slug] = battle.observe('red').munitions;
    expect(battle.observe('blue').munitions).toStrictEqual(battle.observe('red').munitions);
    expect(slug).toMatchObject({ kind: 'slug', attacker: 'blue', target: 'red', mass: slugMass });
    // Blue fired from rest at red, sitting still on its +x axis, so the slug flies straight at it.
    const velocity = slug?.velocity ?? ZERO;
    expect(length(velocity)).toBeCloseTo(muzzleVelocity, 6);
    expect(normalize(velocity).x).toBeCloseTo(1, 9);
    const before = slug?.position ?? ZERO;
    battle.advance(10);
    const after = battle.observe('blue').munitions[0]?.position ?? ZERO;
    expect(after.x - before.x).toBeCloseTo(10 * (slug?.velocity.x ?? 0), 3);
  });

  it('push the firing ship back, conserving momentum', () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(3), testDesign(), 10_000 * KM));
    fireAtRed(battle);
    battle.advance(4);
    const blue = own(battle, 'blue');
    const slugs = battle.observe('blue').munitions;
    expect(slugs).toHaveLength(3);
    const momentum = slugs.reduce(
      (total, s) => add(total, scale(s.velocity, s.mass)),
      scale(blue.velocity, blue.mass),
    );
    expect(blue.velocity.x).toBeLessThan(0);
    expect(length(momentum)).toBeLessThan(1e-4 * slugMass * muzzleVelocity);
  });

  it("hit with the slug's kinetic energy, on the part the line of fire reaches", () => {
    const battle = createBattle(duelSetup(gunnedTestDesign(1), testDesign(), 1_000 * KM));
    fireAtRed(battle);
    let events: readonly BattleEvent[] = [];
    while (impactsOn(events, 'red').length === 0) {
      if (battle.time > 120) throw new Error('No impact');
      events = battle.step();
    }
    const [impact] = impactsOn(events, 'red');
    // Red faces blue nose-on and sits still, so the slug strikes its nose at its muzzle velocity.
    expect(impact).toMatchObject({ attacker: 'blue', section: 'forward', mount: null });
    expect(impact?.energy).toBeCloseTo(SLUG_ENERGY, -3);
    expect(impact?.speed).toBeCloseTo(muzzleVelocity, 0);
    const red = own(battle, 'red');
    expect(red.energyLedger.hitEnergy).toBeCloseTo(SLUG_ENERGY, -3);
    expect(red.appearance.impacts).toHaveLength(1);
    const nose = red.appearance.parts.find((p) => p.section === 'forward' && p.mount === null);
    expect(red.appearance.impacts[0]?.point.x).toBeCloseTo(nose?.max.x ?? NaN, 3);
    expect(section(red, 'forward').structure).toBeLessThan(1);
    expect(battle.observe('blue').munitions).toEqual([]);
  });

  it('punch through ablative armour more easily than heavy armour of the same mass', () => {
    const firstImpact = (armour: ArmourDesign) => {
      const target = withSection(testDesign(), 'forward', { armour });
      const battle = createBattle(duelSetup(gunnedTestDesign(1), target, 1_000 * KM));
      fireAtRed(battle);
      const events = battle.advance(120);
      expect(impactsOn(events, 'red')).toHaveLength(1);
      return {
        breached: events.some((e) => e.type === 'armour-breached'),
        forward: section(own(battle, 'red'), 'forward'),
        mass: own(battle, 'red').mass,
      };
    };
    const heavy = firstImpact({ type: 'heavy', thickness: 0.28 });
    const ablative = firstImpact({ type: 'ablative', thickness: (0.28 * 7_800) / 1_800 });
    expect(ablative.mass).toBeCloseTo(heavy.mass, 0);
    expect(heavy.breached).toBe(false);
    expect(heavy.forward.armour.remaining).toBeGreaterThan(0);
    expect(heavy.forward.structure).toBe(1);
    expect(ablative.breached).toBe(true);
    expect(ablative.forward.structure).toBeLessThan(1);
  });

  it('lose the ammunition in a magazine that is wrecked', () => {
    const target: Design = withSection(gunnedTestDesign(50), 'forward', {
      armour: { type: 'ablative', thickness: 0.01 },
      components: [testMagazine(50)],
    });
    const battle = createBattle(duelSetup(armedTestDesign(), target, 20_000 * KM));
    fireAtRed(battle);
    let lost = false;
    while (!lost && battle.time < 3_600) {
      lost = battle
        .advance(1)
        .some((e) => e.type === 'component-lost' && e.side === 'red' && e.component === 'magazine');
    }
    expect(lost).toBe(true);
    expect(own(battle, 'red').weapons.ammunition).toMatchObject({ slugs: 0, slugCapacity: 50 });
  });
});
