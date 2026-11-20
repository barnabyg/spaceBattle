import { describe, expect, it } from 'vitest';
import { beamResistance } from './armour';
import { effectiveRange } from './beams';
import {
  createBattle,
  TIME_STEP,
  type Battle,
  type BattleEvent,
  type OwnShipObservation,
} from './battle';
import type { ArmourType, SectionKind } from './design';
import { BASE_TEMPERATURE, GLOW_CONDUCTED_SHARE, GLOW_COOLING_TIME, radiativeLimit } from './heat';
import {
  armedTestDesign,
  duelSetup,
  TEST_CHARGED_BEAM,
  TEST_LASER,
  testDesign,
  withSection,
} from './testing';

/** How far the test laser fires: where its beam falls to 1 MW/m². */
const REACH = effectiveRange(TEST_LASER);

/** A target whose nose carries 5 cm of armour of a kind. */
const target = (type: ArmourType) =>
  withSection(testDesign(), 'forward', { armour: { type, thickness: 0.05 } });

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const nose = (ship: OwnShipObservation) => {
  const found = ship.sections.find((s) => s.kind === ('forward' satisfies SectionKind));
  if (!found) throw new Error('No forward section');
  return found;
};

/** Blue's laser fires on red's nose from `range` for `seconds`; the hits and the end state. */
const fire = (type: ArmourType, range: number, seconds: number) => {
  const battle = createBattle(duelSetup(armedTestDesign(), target(type), range));
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
  const events = battle.advance(seconds);
  const hits = events.flatMap((e: BattleEvent) =>
    e.type === 'hit' && e.target === 'red' ? [e] : [],
  );
  const red = own(battle, 'red');
  const armour = nose(red).armour;
  return { battle, events, hits, red, worn: armour.thickness - armour.remaining };
};

describe('armour shedding a laser by glowing', () => {
  it('has radiative limits of about 0.38 MW/m² for heavy armour and 4.1 MW/m² for ablative', () => {
    expect(radiativeLimit('heavy')).toBeCloseTo(0.379e6, -4);
    expect(radiativeLimit('ablative')).toBeCloseTo(4.13e6, -4);
  });

  it('only heats ablative armour struck below its limit, soaking a share into the ship', () => {
    // At 70% of reach the beam lands at about 2 MW/m², half what ablative armour sheds.
    const { events, hits, red, worn } = fire('ablative', 0.7 * REACH, 30);
    const intensity = hits[0]?.intensity ?? 0;
    expect(intensity).toBeLessThan(radiativeLimit('ablative'));
    expect(worn).toBe(0);
    expect(events.some((e) => e.type === 'armour-breached')).toBe(false);
    // The surface glows where it radiates what lands: εσT⁴ = I.
    const temperature = nose(red).surfaceTemperature;
    expect(temperature).toBeGreaterThan(2_000);
    expect(temperature).toBeLessThan(3_000);
    expect(0.9 * 5.670374419e-8 * temperature ** 4).toBeCloseTo(intensity, -4);
    // A quarter of what landed soaks into red's heat; none of it burned the armour.
    const { hitEnergy, heatConducted, heatAbsorbed } = red.energyLedger;
    expect(hitEnergy).toBeGreaterThan(0);
    expect(heatConducted).toBeCloseTo(GLOW_CONDUCTED_SHARE * hitEnergy, -3);
    expect(heatAbsorbed).toBe(0);
    expect(red.heat.conducted).toBeGreaterThan(0);
  });

  it('burns ablative armour away closer in, with only the excess over its limit', () => {
    // At 30% of reach the beam lands at about 11 MW/m².
    const seconds = 30;
    const { hits, red, worn } = fire('ablative', 0.3 * REACH, seconds);
    const intensity = hits[0]?.intensity ?? 0;
    expect(intensity).toBeGreaterThan(radiativeLimit('ablative'));
    // The beam burns at (I − L)/(ρe) in every step from the one it first lands in.
    const lit = seconds - (hits[0]?.time ?? 0) + TIME_STEP;
    const expected =
      ((intensity - radiativeLimit('ablative')) * lit) / beamResistance('ablative', 'laser');
    expect(worn).toBeCloseTo(expected, 5);
    // Burning, the surface glows at its hottest.
    expect(nose(red).surfaceTemperature).toBeCloseTo(3_000, 0);
  });

  it('cannot keep a laser off heavy armour, which glows only to 1,700 K', () => {
    const { hits, worn, red } = fire('heavy', 0.7 * REACH, 30);
    expect(hits[0]?.intensity ?? 0).toBeGreaterThan(radiativeLimit('heavy'));
    expect(worn).toBeGreaterThan(0);
    expect(nose(red).surfaceTemperature).toBeCloseTo(1_700, 0);
  });

  it('cools back towards the ship once the beam is off', () => {
    const { battle, red } = fire('ablative', 0.7 * REACH, 30);
    const hot = nose(red).surfaceTemperature;
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    // The last beam in flight lands, then GLOW_COOLING_TIME later the glow is down to 1/e.
    battle.advance(1);
    const start = nose(own(battle, 'red')).surfaceTemperature;
    expect(start).toBeLessThan(hot);
    battle.advance(GLOW_COOLING_TIME);
    const cooled = nose(own(battle, 'red')).surfaceTemperature;
    expect(cooled - BASE_TEMPERATURE).toBeCloseTo((start - BASE_TEMPERATURE) / Math.E, -1);
  });

  it('shows the glow on a contact whose sections the sensors make out', () => {
    const { battle, red } = fire('ablative', 0.1 * REACH, 5);
    expect(nose(red).surfaceTemperature).toBeGreaterThan(BASE_TEMPERATURE);
    const contact = battle.observe('blue').contacts[0];
    const seen = contact?.sections.find((s) => s.kind === 'forward');
    expect(seen?.surfaceTemperature).toBe(nose(red).surfaceTemperature);
  });

  it('sheds particle beams alike: heated through its depth, it still radiates from its surface', () => {
    const particle = withSection(testDesign(), 'forward', { mounts: [TEST_CHARGED_BEAM] });
    const reach = effectiveRange(TEST_CHARGED_BEAM);
    const shed = (range: number) => {
      const battle = createBattle(duelSetup(particle, target('ablative'), range));
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      const hits = battle.advance(10).flatMap((e) => (e.type === 'hit' ? [e] : []));
      return { intensity: hits[0]?.intensity ?? 0, red: own(battle, 'red') };
    };
    // Far out, below the limit, it only glows; close in, it wears the armour away.
    const far = shed(0.9 * reach);
    expect(far.intensity).toBeLessThan(radiativeLimit('ablative'));
    expect(nose(far.red).armour.remaining).toBe(nose(far.red).armour.thickness);
    expect(nose(far.red).surfaceTemperature).toBeGreaterThan(BASE_TEMPERATURE);
    const near = shed(0.1 * reach);
    expect(near.intensity).toBeGreaterThan(radiativeLimit('ablative'));
    expect(nose(near.red).armour.remaining).toBeLessThan(nose(near.red).armour.thickness);
  });

  it('shows in how the ship looks: by section on its own ship, hottest first', () => {
    const { red } = fire('ablative', 0.7 * REACH, 30);
    expect(red.appearance.armourGlow).toEqual([
      { section: 'forward', temperature: nose(red).surfaceTemperature },
    ]);
  });

  it('shows on a contact by section once made out, and as a hot spot anywhere before', () => {
    // Close in, the sensors make out red's sections: its nose glows.
    const near = fire('ablative', 0.1 * REACH, 5);
    const seen = near.battle.observe('blue').contacts[0];
    expect(seen?.sections.length).toBeGreaterThan(0);
    expect(seen?.appearance.armourGlow).toEqual([
      { section: 'forward', temperature: nose(near.red).surfaceTemperature },
    ]);
    // Far off, they make out no section, yet the hot spot shows: hottest, with no section.
    const far = fire('ablative', 0.7 * REACH, 30);
    const distant = far.battle.observe('blue').contacts[0];
    expect(distant?.sections).toEqual([]);
    expect(distant?.appearance.armourGlow).toEqual([
      { section: null, temperature: nose(far.red).surfaceTemperature },
    ]);
  });

  it('does not show armour that has cooled back towards the ship', () => {
    const { battle } = fire('ablative', 0.7 * REACH, 30);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    battle.advance(10 * GLOW_COOLING_TIME);
    expect(own(battle, 'red').appearance.armourGlow).toEqual([]);
  });

  it('shows a breach in how the ship looks, and a damaged drive as faltering', () => {
    // A thin nose burned through close in.
    const thin = withSection(testDesign(), 'forward', {
      armour: { type: 'ablative', thickness: 0.002 },
    });
    const battle = createBattle(duelSetup(armedTestDesign(), thin, 0.1 * REACH));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(30);
    const red = own(battle, 'red');
    expect(
      red.appearance.damage?.find((d) => d.section === 'forward' && d.mount === null)?.breached,
    ).toBe(true);
    // Seen from blue, the contact's breach shows on a section the sensors make out.
    const seen = battle.observe('blue').contacts[0];
    expect(
      seen?.appearance.damage?.find((d) => d.section === 'forward' && d.mount === null)?.breached,
    ).toBe(true);
    expect(red.appearance.driveFalter).toBe(0);
  });
});
