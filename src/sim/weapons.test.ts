import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { createBattle, type Battle, type BattleEvent, type OwnShipObservation } from './battle';
import { designComponent, designComponentsOfType, type Design, type SectionKind } from './design';
import { CUTOFF_TEMPERATURE, DAMAGE_TEMPERATURE, OVERHEAT_TEMPERATURE } from './heat';
import { fromAxisAngle, multiply } from './quaternion';
import {
  armedTestDesign,
  duelSetup,
  FACING_BLUE,
  TEST_LASER,
  testDesign,
  withComponent,
  withSection,
} from './testing';
import { vec3 } from './vector';
import { SPEED_OF_LIGHT } from './weapons';

const KM = 1000;
const DEGREE = Math.PI / 180;

const fireAtRed = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
};

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const section = (ship: OwnShipObservation, kind: SectionKind) => {
  const found = ship.sections.find((s) => s.kind === kind);
  if (!found) throw new Error(`No ${kind} section`);
  return found;
};

const hitsOn = (events: readonly BattleEvent[], target: string) =>
  events.flatMap((e) => (e.type === 'hit' && e.target === target ? [e] : []));

/** A target with thick ablative armour on its nose, so a test never burns through it. */
const armouredTarget = (): Design =>
  withSection(testDesign(), 'forward', { armour: { type: 'ablative', thickness: 0.5 } });

describe('lasers', () => {
  it('spreads the beam by diffraction, so intensity on target falls with range', () => {
    const fire = (range: number) => {
      const battle = createBattle(duelSetup(armedTestDesign(), armouredTarget(), range));
      fireAtRed(battle);
      battle.advance(10);
      const hit = own(battle, 'blue').weapons.lastHit;
      const armour = section(own(battle, 'red'), 'forward').armour;
      return { hit, worn: armour.thickness - armour.remaining };
    };
    const near = fire(40_000 * KM);
    const far = fire(80_000 * KM);
    for (const [range, { hit }] of [
      [40_000 * KM, near],
      [80_000 * KM, far],
    ] as const) {
      // Airy disc: r = 1.22 λR/D, intensity P/(πr²).
      const radius = (1.22 * TEST_LASER.wavelength * range) / TEST_LASER.aperture;
      expect(hit?.range).toBeCloseTo(range, -3);
      expect(hit?.spotRadius).toBeCloseTo(radius, 6);
      expect(hit?.intensity).toBeCloseTo(TEST_LASER.beamPower / (Math.PI * radius ** 2), -2);
    }
    expect((near.hit?.intensity ?? 0) / (far.hit?.intensity ?? 1)).toBeCloseTo(4, 6);
    // Damage per area follows: the nearer beam burns four times as deep in the same time.
    expect(near.worn / far.worn).toBeCloseTo(4, 1);
  });

  it('reaches its target at light speed', () => {
    const range = 120_000 * KM;
    const battle = createBattle(duelSetup(armedTestDesign(), armouredTarget(), range));
    fireAtRed(battle);
    let hit: BattleEvent | undefined;
    while (!hit) hit = hitsOn(battle.step(), 'red')[0];
    expect(battle.time).toBeGreaterThanOrEqual(range / SPEED_OF_LIGHT);
    expect(battle.time).toBeLessThan(range / SPEED_OF_LIGHT + 0.1 + 1e-9);
  });

  it('holds fire beyond its effective range, or when ordered to', () => {
    const outOfRange = createBattle(duelSetup(armedTestDesign(), testDesign(), 200_000 * KM));
    fireAtRed(outOfRange);
    expect(outOfRange.advance(5)).toEqual([]);
    const laser = own(outOfRange, 'blue').weapons.lasers[0];
    expect(laser?.effectiveRange).toBeLessThan(200_000 * KM);
    expect(laser?.firing).toBe(false);
    expect(own(outOfRange, 'blue').power.systems.weapons.demand).toBe(0);

    const holding = createBattle(duelSetup(armedTestDesign(), testDesign(), 30_000 * KM));
    holding.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    expect(holding.advance(5)).toEqual([]);
    expect(own(holding, 'blue').energyLedger.beamEmitted).toBe(0);
  });

  it('draws power and turns what does not leave in the beam into heat', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 30_000 * KM));
    fireAtRed(battle);
    battle.advance(10);
    const blue = own(battle, 'blue');
    const { delivered, beamEmitted } = blue.energyLedger;
    expect(blue.power.systems.weapons.supplied).toBeCloseTo(
      TEST_LASER.beamPower / TEST_LASER.efficiency,
      -3,
    );
    expect(blue.weapons.lasers[0]?.beamPower).toBeCloseTo(TEST_LASER.beamPower, -3);
    expect(beamEmitted).toBeCloseTo(delivered.weapons * TEST_LASER.efficiency, -3);
    // What landed on red is at most what blue sent out.
    const red = own(battle, 'red');
    expect(red.energyLedger.hitEnergy).toBeGreaterThan(0);
    expect(red.energyLedger.hitEnergy).toBeLessThanOrEqual(beamEmitted);
  });

  it('throttles back as the ship overheats', () => {
    const hot = withComponent(armedTestDesign(), 'radiator', { retractedArea: 100 });
    const battle = createBattle(duelSetup(hot, testDesign(), 30_000 * KM));
    fireAtRed(battle);
    while (own(battle, 'blue').heat.temperature < (OVERHEAT_TEMPERATURE + CUTOFF_TEMPERATURE) / 2) {
      battle.advance(1);
    }
    const blue = own(battle, 'blue');
    const beam = blue.weapons.lasers[0]?.beamPower ?? 0;
    expect(beam).toBeLessThan(TEST_LASER.beamPower * 0.6);
    expect(beam).toBeGreaterThan(TEST_LASER.beamPower * 0.3);
  });

  it('takes weapons orders while the battle is not advancing, but not at its own ship', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 30_000 * KM));
    fireAtRed(battle);
    expect(own(battle, 'blue').weapons).toMatchObject({ target: 'red', mode: 'fire-freely' });
    expect(() => {
      battle.giveOrder('blue', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    }).toThrow();
    expect(() => {
      battle.giveOrder('blue', { type: 'weapons', target: 'green', mode: 'fire-freely' });
    }).toThrow();
  });
});

describe('hits', () => {
  it.each([
    ['lance', false],
    ['lance', true],
    ['bastion', false],
    ['bastion', true],
  ] as const)(
    'lands nose-on shots on the forward section or its mounts (%s, radiators deployed: %s)',
    (id, deployed) => {
      const tilts = [
        [vec3(0, 0, 1), 0],
        [vec3(0, 0, 1), 8 * DEGREE],
        [vec3(0, 0, 1), -8 * DEGREE],
        [vec3(0, 1, 0), 8 * DEGREE],
        [vec3(0, 1, 0), -8 * DEGREE],
        [vec3(1, 0, 0), 30 * DEGREE],
      ] as const;
      for (const [axis, angle] of tilts) {
        const orientation = multiply(FACING_BLUE, fromAxisAngle(axis, angle));
        const battle = createBattle(
          duelSetup(armedTestDesign(), handMadeDesign(id), 30_000 * KM, orientation),
        );
        battle.giveOrder('red', { type: 'radiators', deployed });
        fireAtRed(battle);
        const hits = hitsOn(battle.advance(2), 'red');
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) expect(hit.section).toBe('forward');
      }
    },
  );

  it('lands broadside shots on the middle section or its mounts', () => {
    const broadside = multiply(FACING_BLUE, fromAxisAngle(vec3(0, 0, 1), Math.PI / 2));
    const battle = createBattle(
      duelSetup(armedTestDesign(), handMadeDesign('bastion'), 30_000 * KM, broadside),
    );
    fireAtRed(battle);
    const hits = hitsOn(battle.advance(2), 'red');
    expect(hits.map((h) => h.section)).toEqual(['middle']);
  });

  it('resists lasers better with ablative armour than with heavy armour of the same mass', () => {
    const heavyThickness = 0.02;
    const timeToBreach = (armour: Design['sections'][number]['armour']) => {
      const target = withSection(testDesign(), 'forward', { armour });
      const battle = createBattle(duelSetup(armedTestDesign(), target, 30_000 * KM));
      fireAtRed(battle);
      while (battle.time < 3_600) {
        const events = battle.step();
        if (events.some((e) => e.type === 'armour-breached' && e.side === 'red')) {
          return { time: battle.time, mass: own(battle, 'red').mass };
        }
      }
      throw new Error('Never breached');
    };
    const heavy = timeToBreach({ type: 'heavy', thickness: heavyThickness });
    // Same mass per area: ablative armour is less dense, so it is thicker.
    const ablative = timeToBreach({
      type: 'ablative',
      thickness: (heavyThickness * 7_800) / 1_800,
    });
    expect(ablative.mass).toBeCloseTo(heavy.mass, 0);
    expect(ablative.time).toBeGreaterThan(3 * heavy.time);
  });

  it('breaks through armour, then into structure and components, until the section fails', () => {
    const target = withSection(testDesign(), 'forward', {
      armour: { type: 'ablative', thickness: 0.01 },
      components: [
        { type: 'capacitor', mass: 5e3, capacity: 1e9, maxCharge: 1e8, maxDischarge: 1e9 },
      ],
    });
    const battle = createBattle(duelSetup(armedTestDesign(), target, 20_000 * KM));
    fireAtRed(battle);
    const events: BattleEvent[] = [];
    while (!events.some((e) => e.type === 'structural-failure') && battle.time < 3_600) {
      events.push(...battle.advance(1));
    }
    const types = events.filter((e) => e.type !== 'hit').map((e) => e.type);
    expect(types).toEqual(['armour-breached', 'component-lost', 'structural-failure']);
    const forward = section(own(battle, 'red'), 'forward');
    expect(forward.structure).toBe(0);
    expect(forward.components[0]?.integrity).toBe(0);
    // With the forward section gone, the line of fire reaches the middle section.
    const next = hitsOn(battle.advance(2), 'red');
    expect(next.map((h) => h.section)).toEqual(['middle']);
  });
});

describe('integrity', () => {
  it("scales a drive's thrust with its integrity, down to nothing at zero", () => {
    // Red flies away from blue, so blue's beam lands on its unarmoured engine section.
    const battle = createBattle(
      duelSetup(armedTestDesign(), testDesign(), 20_000 * KM, fromAxisAngle(vec3(0, 0, 1), 0)),
    );
    const { thrust } = designComponent(testDesign(), 'drive');
    battle.giveOrder('red', { type: 'burn', throttle: 1, duration: 3_600 });
    fireAtRed(battle);
    const seen: number[] = [];
    for (let i = 0; i < 100; i++) {
      battle.advance(10);
      const red = own(battle, 'red');
      const drive = section(red, 'engine').components[0];
      expect(drive?.type).toBe('drive');
      const integrity = drive?.integrity ?? 0;
      seen.push(integrity);
      expect(red.thrust / thrust).toBeCloseTo(integrity, 2);
      if (integrity === 0) break;
    }
    expect(seen.some((x) => x > 0.2 && x < 0.9)).toBe(true);
    expect(seen.at(-1)).toBe(0);
    battle.advance(10);
    expect(own(battle, 'red').thrust).toBe(0);
  });

  it("scales a radiator's area with its integrity", () => {
    // Red's +y side, where its radiator is folded, faces blue.
    const battle = createBattle(
      duelSetup(
        armedTestDesign(),
        testDesign(),
        20_000 * KM,
        fromAxisAngle(vec3(0, 0, 1), Math.PI / 2),
      ),
    );
    const retractedArea = designComponentsOfType(testDesign(), 'radiator')[0]?.retractedArea ?? 0;
    fireAtRed(battle);
    const seen: number[] = [];
    for (let i = 0; i < 100; i++) {
      battle.advance(1);
      const red = own(battle, 'red');
      const radiator = section(red, 'middle').mounts[0];
      const integrity = radiator?.integrity ?? 0;
      seen.push(integrity);
      expect(red.heat.radiatorArea).toBeCloseTo(retractedArea * integrity, 3);
      if (integrity === 0) break;
    }
    expect(seen.some((x) => x > 0.2 && x < 0.9)).toBe(true);
    expect(seen.at(-1)).toBe(0);
  });

  it('damages components once the ship overheats past the damage temperature', () => {
    // A wasteful reactor recharging drained capacitors keeps heating a ship already at cutoff.
    let design = withComponent(testDesign(), 'reactor', { output: 0.5e9, efficiency: 0.05 });
    design = withComponent(design, 'capacitor', {
      capacity: 100e9,
      maxCharge: 0.5e9,
      maxDischarge: 5e9,
    });
    design = withComponent(design, 'radiator', { retractedArea: 100 });
    const battle = createBattle(duelSetup(design, testDesign(), 200_000 * KM));
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 3_600 });
    const integrities = () =>
      own(battle, 'blue')
        .sections.flatMap((s) => [...s.components, ...s.mounts])
        .map((c) => c.integrity);
    while (own(battle, 'blue').heat.temperature < DAMAGE_TEMPERATURE) {
      expect(Math.min(...integrities())).toBe(1);
      battle.step();
    }
    const events = battle.advance(60);
    expect(Math.min(...integrities())).toBeLessThan(1);
    expect(events.some((e) => e.type === 'component-lost' && e.side === 'blue')).toBe(true);
  });
});
