import { describe, expect, it } from 'vitest';
import {
  createBattle,
  type Battle,
  type BattleEvent,
  type MissileObservation,
  type OwnShipObservation,
} from './battle';
import { KILOTON, type Design, type MissileDesign } from './design';
import type { DetonationEvent } from './events';
import { fromAxisAngle } from './quaternion';
import {
  armedTestDesign,
  duelSetup,
  launchingTestDesign,
  missileMagazine,
  TEST_LASER,
  TEST_MISSILE,
  TEST_NUCLEAR_MISSILE,
  testDesign,
  withSection,
} from './testing';
import { length, sub, vec3 } from './vector';

const KM = 1000;
/** Red side-on to blue with its nose along +y, so blue sees its middle section's +y face. */
const ACROSS = fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
/** Red with its body +z face towards blue, so blue sees its mounts and radiator fins face-on. */
const TOP_TOWARDS_BLUE = fromAxisAngle(vec3(0, 1, 0), -Math.PI / 2);

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const missilesInFlight = (battle: Battle): MissileObservation[] =>
  battle.observe('blue').munitions.flatMap((m) => (m.kind === 'missile' ? [m] : []));

/** The test missile with a nuclear warhead of a yield, fused at a distance. */
const nuclearMissile = (yieldEnergy: number, detonationDistance: number): MissileDesign => ({
  ...TEST_NUCLEAR_MISSILE,
  warhead: { type: 'nuclear', yield: yieldEnergy, detonationDistance },
});

/** Blue launches one missile of a design at red and steps until it goes off. */
const detonate = (
  missile: MissileDesign,
  red: Design,
  orientation = ACROSS,
): { battle: Battle; detonation: DetonationEvent; events: BattleEvent[] } => {
  const battle = createBattle(
    duelSetup(launchingTestDesign(1, { missile }), red, 1_000 * KM, orientation),
  );
  battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
  const events: BattleEvent[] = [];
  for (;;) {
    if (battle.time > 600) throw new Error('No detonation');
    const step = battle.step();
    events.push(...step);
    const detonation = step.find((e) => e.type === 'detonation');
    if (detonation) return { battle, detonation, events };
  }
};

const exposuresOf = (detonation: DetonationEvent, side: string) =>
  detonation.exposures.filter((e) => e.side === side);

/** The test design with the same armour on every section. */
const armouredTestDesign = (thickness: number, base = testDesign()): Design =>
  (['forward', 'middle', 'engine'] as const).reduce(
    (design, kind) => withSection(design, kind, { armour: { type: 'heavy', thickness } }),
    base,
  );

describe('nuclear warheads', () => {
  it('go off by proximity fuse at their detonation distance from the target', () => {
    const { battle, detonation, events } = detonate(TEST_NUCLEAR_MISSILE, testDesign());
    expect(detonation).toMatchObject({
      attacker: 'blue',
      target: 'red',
      yield: 10 * KILOTON,
      contact: false,
    });
    expect(detonation.distance).toBeCloseTo(2_000, 3);
    expect(length(sub(detonation.position, own(battle, 'red').position))).toBeCloseTo(2_000, -1);
    // It never reaches the target, and is gone once it has gone off.
    expect(events.some((e) => e.type === 'impact')).toBe(false);
    expect(missilesInFlight(battle)).toEqual([]);
    expect(battle.observe('red').events).toContainEqual(detonation);
  });

  it('deliver radiation and heat per area that falls with the square of distance', () => {
    const red = withSection(testDesign(), 'middle', { armour: { type: 'heavy', thickness: 0.1 } });
    const burstAt = (distance: number) => {
      const { battle, detonation } = detonate(nuclearMissile(10 * KILOTON, distance), red);
      const middle = own(battle, 'red').sections.find((s) => s.kind === 'middle');
      const side = exposuresOf(detonation, 'red').find(
        (e) => e.section === 'middle' && e.mount === null,
      );
      if (!middle || !side) throw new Error('The burst missed the middle section');
      return { detonation, side, ablated: 0.1 - middle.armour.remaining };
    };
    const near = burstAt(2 * KM);
    const far = burstAt(4 * KM);

    // Every part the burst reaches takes energy per area in proportion to 1 / r²...
    const parts = [...exposuresOf(near.detonation, 'red'), ...exposuresOf(far.detonation, 'red')];
    expect(parts.length).toBeGreaterThan(2);
    const perSteradian = near.side.fluence * near.side.distance ** 2;
    for (const part of parts) {
      expect((part.fluence * part.distance ** 2) / perSteradian).toBeCloseTo(1, 9);
    }
    // ...most of the yield leaving as X-rays, spread over the sphere around the burst...
    expect((4 * Math.PI * perSteradian) / (10 * KILOTON)).toBeGreaterThan(0.5);
    expect((4 * Math.PI * perSteradian) / (10 * KILOTON)).toBeLessThanOrEqual(1);
    // ...so twice as far away it is a quarter as much...
    expect(near.side.fluence / far.side.fluence).toBeCloseTo(4, 1);
    // ...and so is the armour it boils away.
    expect(near.ablated).toBeGreaterThan(0);
    expect(near.ablated / far.ablated).toBeCloseTo(near.side.fluence / far.side.fluence, 6);
  });

  it('strip exposed mounts and radiators in a near miss, while armour and what is inside hold', () => {
    const red = armouredTestDesign(
      0.02,
      withSection(testDesign(), 'forward', { mounts: [TEST_LASER] }),
    );
    const battle = createBattle(
      duelSetup(
        launchingTestDesign(1, { missile: nuclearMissile(10 * KILOTON, 1.5 * KM) }),
        red,
        1_000 * KM,
        TOP_TOWARDS_BLUE,
      ),
    );
    battle.giveOrder('red', { type: 'radiators', deployed: true });
    battle.giveOrder('blue', { type: 'launch', target: 'red', missiles: 1 });
    const events: BattleEvent[] = [];
    while (!events.some((e) => e.type === 'detonation')) {
      if (battle.time > 600) throw new Error('No detonation');
      events.push(...battle.step());
    }
    const { sections } = own(battle, 'red');
    const lost = events.flatMap((e) =>
      e.type === 'component-lost' && e.side === 'red' ? [e.component] : [],
    );
    expect(lost.sort()).toEqual(['laser', 'radiator', 'sensor']);
    for (const section of sections) {
      for (const mount of section.mounts) expect(mount.integrity).toBe(0);
      for (const component of section.components) expect(component.integrity).toBe(1);
      expect(section.structure).toBe(1);
      expect(section.armour.remaining).toBeGreaterThan(0.99 * section.armour.thickness);
    }
    // With its only weapon gone, red is disabled but not destroyed.
    expect(battle.outcome?.sides.find((s) => s.side === 'red')?.loss).toEqual({
      result: 'disabled',
      cause: 'no-working-weapons',
    });
  });

  it('go off on contact when fused at no distance, which is devastating', () => {
    const { battle, detonation } = detonate(nuclearMissile(10 * KILOTON, 0), testDesign());
    expect(detonation.contact).toBe(true);
    expect(detonation.distance).toBeLessThan(10);
    expect(battle.observe('blue').events.some((e) => e.type === 'impact')).toBe(false);
    expect(battle.outcome?.winner).toBe('blue');
    expect(battle.outcome?.sides.find((s) => s.side === 'red')?.loss).toEqual({
      result: 'destroyed',
      cause: 'structural-failure',
    });
  });

  it('do little beyond a few tens of kilometres', () => {
    const red = armouredTestDesign(0.02);
    const { battle } = detonate(nuclearMissile(10 * KILOTON, 30 * KM), red);
    for (const section of own(battle, 'red').sections) {
      for (const part of [...section.components, ...section.mounts]) {
        expect(part.integrity).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('a magazine of nuclear missiles', () => {
  /**
   * The test design with its middle section holding nothing but a magazine of 20 missiles of a
   * design, so a beam through the middle section's side bores into the magazine; what was in the
   * middle section moves forward, its radiator to the engine section.
   */
  const magazineShip = (missile: MissileDesign, missiles = 20): Design => {
    const middle = testDesign().sections.find((s) => s.kind === 'middle');
    if (!middle) throw new Error('No middle section');
    const moved = withSection(testDesign(), 'forward', { components: middle.components });
    const emptied = withSection(moved, 'middle', {
      components: [missileMagazine(missiles, missile)],
      mounts: [],
    });
    return withSection(emptied, 'engine', {
      ...testDesign().sections.find((s) => s.kind === 'engine'),
      mounts: middle.mounts,
    });
  };

  /** Blue's laser burns into red's middle section until red's magazine is lost. */
  const burnTheMagazine = (red: Design, seed = 1) => {
    const battle = createBattle({ ...duelSetup(armedTestDesign(), red, 100 * KM, ACROSS), seed });
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    for (;;) {
      if (battle.time > 900) throw new Error('The magazine was never lost');
      const events = battle.step();
      const lost = events.some(
        (e) => e.type === 'component-lost' && e.side === 'red' && e.component === 'magazine',
      );
      if (lost) return { battle, events };
    }
  };

  it('can destroy the ship when the magazine is hit', () => {
    const { battle, events } = burnTheMagazine(magazineShip(TEST_NUCLEAR_MISSILE));
    const explosion = events.find((e) => e.type === 'magazine-explosion');
    expect(explosion).toMatchObject({ side: 'red', section: 'middle', index: 0 });
    if (explosion?.type !== 'magazine-explosion') throw new Error('No magazine explosion');
    expect(explosion.warheads).toBeGreaterThan(0);
    expect(explosion.warheads).toBeLessThanOrEqual(20);
    expect(explosion.energy).toBeGreaterThan(0);
    expect(explosion.energy).toBeLessThan(explosion.warheads * 10 * KILOTON);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'structural-failure', side: 'red', section: 'middle' }),
    );
    expect(battle.outcome?.sides.find((s) => s.side === 'red')?.loss).toEqual({
      result: 'destroyed',
      cause: 'structural-failure',
    });
  });

  it('is only lost, like any other, when its missiles are not nuclear', () => {
    const { battle, events } = burnTheMagazine(magazineShip(TEST_MISSILE));
    expect(events.some((e) => e.type === 'magazine-explosion')).toBe(false);
    expect(own(battle, 'red').sections.find((s) => s.kind === 'middle')?.structure).toBeGreaterThan(
      0,
    );
    expect(battle.outcome).toBeNull();
  });

  it('sets its warheads off by chance', () => {
    const exploded = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
      burnTheMagazine(magazineShip(TEST_NUCLEAR_MISSILE, 1), seed).events.some(
        (e) => e.type === 'magazine-explosion',
      ),
    );
    expect(exploded).toContain(true);
    expect(exploded).toContain(false);
  });
});
