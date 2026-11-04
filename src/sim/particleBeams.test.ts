import { describe, expect, it } from 'vitest';
import { createBattle, type Battle, type OwnShipObservation } from './battle';
import { NEUTRAL_FRACTION } from './beams';
import type { Design, ParticleBeamDesign, SectionKind } from './design';
import {
  armedTestDesign,
  duelSetup,
  TEST_CHARGED_BEAM,
  TEST_NEUTRAL_BEAM,
  testDesign,
  withForwardWeapon,
  withSection,
} from './testing';

const KM = 1000;

const fireAtRed = (battle: Battle) => {
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
};

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const section = (ship: OwnShipObservation, kind: SectionKind) => {
  const found = ship.sections.find((s) => s.kind === kind);
  if (!found) throw new Error(`No ${kind} section`);
  return found;
};

/** A target with thick ablative armour on its nose, so a test never burns through it. */
const armouredTarget = (): Design =>
  withSection(testDesign(), 'forward', { armour: { type: 'ablative', thickness: 0.5 } });

/** Blue fires `beam` at red for `seconds` from `range`: blue's latest hit and red's worn armour. */
const fire = (beam: ParticleBeamDesign, range: number, seconds = 10) => {
  const battle = createBattle(duelSetup(withForwardWeapon(beam), armouredTarget(), range));
  fireAtRed(battle);
  battle.advance(seconds);
  const blue = own(battle, 'blue');
  const red = own(battle, 'red');
  const armour = section(red, 'forward').armour;
  return {
    battle,
    blue,
    red,
    hit: blue.weapons.lastHit,
    worn: armour.thickness - armour.remaining,
  };
};

describe('particle beams', () => {
  it('lose damage with range faster when charged than when neutral', () => {
    const near = 1_000 * KM;
    const far = 10_000 * KM;
    const falloff = (beam: ParticleBeamDesign) => {
      const close = fire(beam, near);
      const distant = fire(beam, far);
      expect(distant.hit?.range).toBeCloseTo(far, -3);
      return {
        intensity: (close.hit?.intensity ?? 0) / (distant.hit?.intensity ?? 1),
        worn: close.worn / distant.worn,
      };
    };
    const charged = falloff(TEST_CHARGED_BEAM);
    const neutral = falloff(TEST_NEUTRAL_BEAM);
    // From the same accelerator, the charged beam's own charge blows its spot up with range.
    expect(charged.intensity).toBeGreaterThan(5 * neutral.intensity);
    expect(charged.worn).toBeGreaterThan(5 * neutral.worn);
  });

  it('spread a neutral beam in a straight-sided cone from its emitter', () => {
    const range = 10_000 * KM;
    const { hit } = fire(TEST_NEUTRAL_BEAM, range);
    const radius = TEST_NEUTRAL_BEAM.aperture / 2 + TEST_NEUTRAL_BEAM.divergence * range;
    expect(hit?.spotRadius).toBeCloseTo(radius, 6);
    expect(hit?.intensity).toBeCloseTo(TEST_NEUTRAL_BEAM.beamPower / (Math.PI * radius ** 2), -2);
  });

  it('deliver less damage per unit of power when neutral, at short range', () => {
    const delivered = (beam: ParticleBeamDesign) => {
      const { blue, red, hit } = fire(beam, 1_000 * KM);
      // The whole beam lands on the target's nose.
      expect(hit?.power).toBeCloseTo(beam.beamPower, -3);
      return {
        perJoule: red.energyLedger.hitEnergy / blue.energyLedger.delivered.weapons,
        power: blue.power.systems.weapons.supplied,
      };
    };
    const charged = delivered(TEST_CHARGED_BEAM);
    const neutral = delivered(TEST_NEUTRAL_BEAM);
    expect(charged.power).toBeCloseTo(
      TEST_CHARGED_BEAM.beamPower / TEST_CHARGED_BEAM.efficiency,
      -3,
    );
    expect(neutral.power).toBeCloseTo(
      TEST_NEUTRAL_BEAM.beamPower / (TEST_NEUTRAL_BEAM.efficiency * NEUTRAL_FRACTION),
      -3,
    );
    expect(neutral.perJoule).toBeLessThan(charged.perJoule);
    expect(neutral.perJoule / charged.perJoule).toBeCloseTo(NEUTRAL_FRACTION, 2);
  });

  it.each([TEST_CHARGED_BEAM, TEST_NEUTRAL_BEAM])(
    'draw power and turn what does not leave in the beam into heat ($type)',
    (beam) => {
      const { blue } = fire(beam, 1_000 * KM);
      const ledger = blue.energyLedger;
      expect(ledger.delivered.weapons).toBeGreaterThan(0);
      expect(ledger.beamEmitted).toBeCloseTo(beam.beamPower * 10, -6);
      // With the drive idle, the heat is the reactor's and what the weapons did not send out.
      expect(ledger.heatGenerated).toBeCloseTo(
        ledger.reactorHeat + ledger.delivered.weapons - ledger.beamEmitted,
        -3,
      );
      expect(blue.weapons.particleBeams[0]?.beamPower).toBeCloseTo(beam.beamPower, -3);
    },
  );

  it('reach much further when neutral, and hold fire beyond their reach', () => {
    const range = 20_000 * KM;
    const charged = fire(TEST_CHARGED_BEAM, range);
    const neutral = fire(TEST_NEUTRAL_BEAM, range);
    const chargedBeam = charged.blue.weapons.particleBeams[0];
    const neutralBeam = neutral.blue.weapons.particleBeams[0];
    expect(chargedBeam?.effectiveRange).toBeLessThan(range);
    expect(neutralBeam?.effectiveRange).toBeGreaterThan(5 * range);
    expect(chargedBeam?.firing).toBe(false);
    expect(charged.hit).toBeNull();
    expect(charged.blue.power.systems.weapons.demand).toBe(0);
    expect(neutralBeam?.firing).toBe(true);
    expect(neutral.hit).not.toBeNull();
  });

  it('say which kind of attack each hit was, in the hit and where it lands', () => {
    for (const [weapon, attack] of [
      [TEST_CHARGED_BEAM, 'charged-particle'],
      [TEST_NEUTRAL_BEAM, 'neutral-particle'],
    ] as const) {
      const { battle, hit, blue } = fire(weapon, 1_000 * KM, 1);
      expect(hit?.attack).toBe(attack);
      expect(blue.weapons.particleBeams.map((b) => b.kind)).toEqual([attack]);
      expect(blue.weapons.lasers).toEqual([]);
      const landing = battle.observe('blue').contacts[0]?.appearance.beamsLanding;
      expect(landing?.map((l) => l.attack)).toEqual([attack]);
    }
    const laser = createBattle(duelSetup(armedTestDesign(), armouredTarget(), 30_000 * KM));
    fireAtRed(laser);
    laser.advance(16);
    expect(own(laser, 'blue').weapons.lastHit?.attack).toBe('laser');
    expect(own(laser, 'blue').weapons.particleBeams).toEqual([]);
  });

  it('are held off far better by ablative armour than by heavy armour of the same mass', () => {
    const heavyThickness = 0.02;
    const timeToBreach = (armour: Design['sections'][number]['armour']) => {
      const target = withSection(testDesign(), 'forward', { armour });
      const battle = createBattle(
        duelSetup(withForwardWeapon(TEST_CHARGED_BEAM), target, 1_000 * KM),
      );
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
    const ablative = timeToBreach({
      type: 'ablative',
      thickness: (heavyThickness * 7_800) / 1_800,
    });
    expect(ablative.mass).toBeCloseTo(heavy.mass, 0);
    expect(ablative.time).toBeGreaterThan(4 * heavy.time);
  });

  it('disable a ship once its only particle beam is lost', () => {
    const battle = createBattle(
      duelSetup(armedTestDesign(), withForwardWeapon(TEST_NEUTRAL_BEAM), 20_000 * KM),
    );
    fireAtRed(battle);
    while (!battle.outcome) {
      if (battle.time > 3_600) throw new Error('The battle never ended');
      battle.advance(10);
    }
    expect(own(battle, 'red').weapons.particleBeams.map((b) => b.integrity)).toEqual([0]);
    expect(battle.outcome.sides[1]?.loss).toEqual({
      result: 'disabled',
      cause: 'no-working-weapons',
    });
  });
});
