import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { effectiveRange } from './beams';
import { createBattle, type Battle, type BattleSetup, type OwnShipObservation } from './battle';
import { withComputerCaptains } from './command';
import { componentSlots } from './components';
import { rollShare } from './damage';
import type { ArmourType } from './design';
import { fullCondition, type ShipCondition } from './ship';
import { armedTestDesign, duelSetup, TEST_LASER, testDesign, withSection } from './testing';
import { ROLL_FIRING_SHARE } from './weapons';

/** How far the test laser fires: where its beam falls to 1 MW/m². */
const REACH = effectiveRange(TEST_LASER);

/** A target whose nose carries 5 cm of armour of a kind. */
const target = (type: ArmourType = 'ablative') =>
  withSection(testDesign(), 'forward', { armour: { type, thickness: 0.05 } });

const own = (battle: Battle, side: string): OwnShipObservation => battle.observe(side).ownShip;

const nose = (ship: OwnShipObservation) => {
  const found = ship.sections.find((s) => s.kind === 'forward');
  if (!found) throw new Error('No forward section');
  return found;
};

/** Blue fires on red's nose from 30% of its reach for 30 s, red rolling or not. */
const underFire = (rolling: boolean) => {
  const battle = createBattle(duelSetup(armedTestDesign(), target(), 0.3 * REACH));
  battle.giveOrder('red', { type: 'roll', rolling });
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
  const hits = battle.advance(30).flatMap((e) => (e.type === 'hit' ? [e] : []));
  const red = own(battle, 'red');
  return {
    battle,
    hit: hits[0],
    red,
    worn: nose(red).armour.thickness - nose(red).armour.remaining,
    peak: nose(red).surfaceTemperature,
  };
};

describe('rolling to spread beam heat', () => {
  it('shares the beam round the section: armour wears and glows for only its lit share', () => {
    const still = underFire(false);
    const rolling = underFire(true);
    expect(rolling.red.rolling).toBe(true);
    // A frigate section is 12 m by 12 m: 48 m round. The spot here is a few metres across.
    const radius = rolling.hit?.spotRadius ?? 0;
    const share = (2 * radius) / 48;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.2);
    expect(rollShare(target(), 'forward', radius)).toBeCloseTo(share);
    expect(still.worn).toBeGreaterThan(0);
    expect(rolling.worn / still.worn).toBeCloseTo(share, 3);
    // Lit for only part of each turn, the armour stays cooler than its glow temperature.
    expect(still.peak).toBeCloseTo(3_000, 0);
    expect(rolling.peak).toBeLessThan(still.peak - 300);
  });

  it('helps nothing once the beam is as wide as the ship', () => {
    expect(rollShare(testDesign(), 'forward', 24)).toBe(1);
    expect(rollShare(testDesign(), 'forward', 100)).toBe(1);
  });

  it("keeps the ship's heading and burns as they were", () => {
    const run = (rolling: boolean) => {
      const battle = createBattle(duelSetup(testDesign(), testDesign(), 50_000e3));
      battle.giveOrder('blue', { type: 'roll', rolling });
      battle.giveOrder('blue', { type: 'attitude', mode: 'away' });
      battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 600 });
      battle.advance(300);
      return own(battle, 'blue');
    };
    const still = run(false);
    const rolling = run(true);
    expect(rolling.rolling).toBe(true);
    expect(rolling.nose).toEqual(still.nose);
    expect(rolling.velocity).toEqual(still.velocity);
    expect(rolling.burn).toEqual(still.burn);
  });

  it("fires the ship's own beams at half power while it rolls", () => {
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 30_000e3));
    battle.giveOrder('blue', { type: 'roll', rolling: true });
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(5);
    const laser = own(battle, 'blue').weapons.lasers[0];
    expect(laser?.beamPower).toBeCloseTo(ROLL_FIRING_SHARE * TEST_LASER.beamPower, -3);
    battle.giveOrder('blue', { type: 'roll', rolling: false });
    battle.advance(1);
    expect(own(battle, 'blue').weapons.lasers[0]?.beamPower).toBeCloseTo(TEST_LASER.beamPower, -3);
  });

  it('is refused while the thrusters are wrecked', () => {
    const design = testDesign();
    const thrusters = componentSlots(design).findIndex((s) => s.component.type === 'thrusters');
    const full = fullCondition(design);
    const wrecked: ShipCondition = {
      ...full,
      integrity: full.integrity.map((value, i) => (i === thrusters ? 0 : value)),
    };
    const setup = duelSetup(design, testDesign(), 50_000e3);
    const battle = createBattle({
      ...setup,
      sides: setup.sides.map((side) =>
        side.id === 'blue' ? { ...side, condition: wrecked } : side,
      ),
    });
    expect(() => {
      battle.giveOrder('blue', { type: 'roll', rolling: true });
    }).toThrow(/thrusters/);
    expect(own(battle, 'blue').rolling).toBe(false);
    // Stopping is always allowed.
    battle.giveOrder('blue', { type: 'roll', rolling: false });
  });

  it('is used by a computer captain under beam fire it cannot answer, and dropped in its reach', () => {
    // Blue, the player's, fires its long-reaching laser at red's computer Torch.
    const run = (range: number) => {
      const setup: BattleSetup = duelSetup(armedTestDesign(), handMadeDesign('torch'), range);
      const battle = withComputerCaptains(createBattle(setup));
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      battle.advance(10);
      return own(battle, 'red');
    };
    const torchReach = effectiveRange(
      handMadeDesign('torch')
        .sections.flatMap((s) => s.mounts)
        .find((m) => m.type === 'charged-particle-beam') as never,
    );
    // Beyond its own reach and under fire, it rolls...
    expect(run(0.5 * REACH).rolling).toBe(true);
    // ...but within it, it does not, so its beam bears in full.
    expect(run(0.5 * torchReach).rolling).toBe(false);
  });
});
