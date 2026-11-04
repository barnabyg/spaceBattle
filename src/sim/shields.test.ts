import { describe, expect, it } from 'vitest';
import { createBattle, type BattleEvent, type OwnShipObservation } from './battle';
import { PROTON_REST_ENERGY } from './beams';
import type { Design, MountedComponentDesign, ShieldDesign } from './design';
import type { Order } from './orders';
import type { PowerSystem } from './power';
import {
  duelSetup,
  gunnedTestDesign,
  TEST_CHARGED_BEAM,
  TEST_COOLANT_SHIELD,
  TEST_KINETIC_GUN,
  TEST_LASER,
  TEST_MAGNETIC_SHIELD,
  TEST_NEUTRAL_BEAM,
  testDesign,
  withComponent,
  withForwardWeapon,
  withSection,
} from './testing';

const KM = 1000;
const SECONDS = 10;
/** Beams fire from here; their spots are far smaller than the target's nose. */
const BEAM_RANGE = 1_000 * KM;
/** Slugs fire from here, so they arrive within the test. */
const SLUG_RANGE = 100 * KM;

/** Thick ablative armour on the nose, so no test burns through it. */
const NOSE_ARMOUR = { type: 'ablative', thickness: 0.5 } as const;

/** The test design with nose armour and `shields` inside its nose, or in another section. */
const target = (
  shields: readonly ShieldDesign[] = [],
  section: 'forward' | 'engine' = 'forward',
): Design => {
  const armoured = withSection(testDesign(), 'forward', { armour: NOSE_ARMOUR });
  if (section === 'forward') return withSection(armoured, 'forward', { components: shields });
  const engine = armoured.sections.find((s) => s.kind === 'engine');
  return withSection(armoured, 'engine', {
    components: [...(engine?.components ?? []), ...shields],
  });
};

/** The attacker for a weapon: a kinetic gun comes with a magazine of slugs. */
const attacker = (weapon: MountedComponentDesign): Design =>
  weapon.type === 'kinetic-gun' ? gunnedTestDesign(1_000) : withForwardWeapon(weapon);

interface Attack {
  /** Red's own ship once blue has fired at it. */
  readonly red: OwnShipObservation;
  /** How much of red's nose armour was worn away, m. */
  readonly worn: number;
  /** The hits and impacts on red. */
  readonly hits: readonly BattleEvent[];
}

/** Gives red its orders before blue opens fire. */
type Prepare = (give: (order: Order) => void) => void;

/** Blue fires `weapon` at red, in `design`, for `seconds`, once `prepare` has given red orders. */
const attack = (
  weapon: MountedComponentDesign,
  design: Design,
  { seconds = SECONDS, prepare }: { seconds?: number; prepare?: Prepare } = {},
): Attack => {
  const range = weapon.type === 'kinetic-gun' ? SLUG_RANGE : BEAM_RANGE;
  const battle = createBattle(duelSetup(attacker(weapon), design, range));
  prepare?.((order) => {
    battle.giveOrder('red', order);
  });
  battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
  const hits = battle
    .advance(seconds)
    .filter((e) => (e.type === 'hit' || e.type === 'impact') && e.target === 'red');
  const red = battle.observe('red').ownShip;
  const nose = red.sections.find((s) => s.kind === 'forward')?.armour;
  return { red, worn: (nose?.thickness ?? 0) - (nose?.remaining ?? 0), hits };
};

/** A proton's momentum times c at a kinetic energy, J. */
const momentum = (energy: number) => Math.sqrt(energy ** 2 + 2 * energy * PROTON_REST_ENERGY);

const firstHit = (events: readonly BattleEvent[]) => {
  const hit = events.find((e) => e.type === 'hit');
  if (!hit) throw new Error('No hit');
  return hit;
};

describe('magnetic shields', () => {
  it('turn a charged particle beam away entirely while powered', () => {
    const bare = attack(TEST_CHARGED_BEAM, target());
    const shielded = attack(TEST_CHARGED_BEAM, target([TEST_MAGNETIC_SHIELD]));
    expect(bare.worn).toBeGreaterThan(0);
    expect(shielded.worn).toBe(0);

    const { power, energyLedger, shields } = shielded.red;
    expect(power.systems.shields).toEqual({
      demand: TEST_MAGNETIC_SHIELD.power,
      supplied: TEST_MAGNETIC_SHIELD.power,
    });
    expect(shields.raised).toBe(true);
    expect(shields.powered).toBe(1);
    expect(shields.fullDeflection).toBeCloseTo(TEST_MAGNETIC_SHIELD.maxParticleEnergy, 20);
    // The hit shows the beam turned away; the ship took none of it.
    const hit = firstHit(shielded.hits);
    expect(hit.power).toBe(0);
    expect(hit.deflected).toBeCloseTo(TEST_CHARGED_BEAM.beamPower, -3);
    expect(hit.absorbed).toBe(0);
    expect(energyLedger.hitEnergy).toBe(0);
    expect(energyLedger.beamDeflected).toBeCloseTo(bare.red.energyLedger.hitEnergy, -3);
  });

  it('turn away only part of a beam of harder protons, by their momentum', () => {
    const weak = {
      ...TEST_MAGNETIC_SHIELD,
      maxParticleEnergy: TEST_CHARGED_BEAM.particleEnergy / 4,
    };
    const share = momentum(weak.maxParticleEnergy) / momentum(TEST_CHARGED_BEAM.particleEnergy);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
    const bare = attack(TEST_CHARGED_BEAM, target());
    const shielded = attack(TEST_CHARGED_BEAM, target([weak]));
    const hit = firstHit(shielded.hits);
    expect(hit.deflected / (hit.deflected + hit.power)).toBeCloseTo(share, 6);
    expect(shielded.worn / bare.worn).toBeCloseTo(1 - share, 3);
  });

  it.each([TEST_NEUTRAL_BEAM, TEST_LASER, TEST_KINETIC_GUN])(
    'have no effect on any other weapon: $type',
    (weapon) => {
      const bare = attack(weapon, target(), { seconds: 30 });
      const shielded = attack(weapon, target([TEST_MAGNETIC_SHIELD]), { seconds: 30 });
      // Powered throughout, though a slug through the armour may damage it.
      const { demand, supplied } = shielded.red.power.systems.shields;
      expect(demand).toBeGreaterThan(0);
      expect(supplied).toBe(demand);
      expect(bare.worn).toBeGreaterThan(0);
      expect(shielded.worn).toBeCloseTo(bare.worn, 9);
      expect(shielded.red.energyLedger.hitEnergy).toBeCloseTo(bare.red.energyLedger.hitEnergy, -3);
      expect(shielded.red.energyLedger.beamDeflected).toBe(0);
      for (const hit of shielded.hits) {
        if (hit.type === 'hit') expect(hit.deflected).toBe(0);
      }
    },
  );
});

describe('coolant shields', () => {
  it('carry laser heat into the ship, burning less of the armour away', () => {
    const bare = attack(TEST_LASER, target());
    const shielded = attack(TEST_LASER, target([TEST_COOLANT_SHIELD]));
    const { capacity } = TEST_COOLANT_SHIELD;
    // The whole beam lands on the nose; the coolant carries off its capacity of it.
    const hit = firstHit(shielded.hits);
    expect(hit.power).toBeCloseTo(2 * TEST_LASER.beamPower, -3);
    expect(hit.absorbed).toBeCloseTo(capacity, -3);
    expect(hit.deflected).toBe(0);
    const left = (2 * TEST_LASER.beamPower - capacity) / (2 * TEST_LASER.beamPower);
    expect(shielded.worn / bare.worn).toBeCloseTo(left, 3);
    expect(shielded.red.shields.coolantCapacity.forward).toBeCloseTo(capacity, -3);
    expect(shielded.red.heat.absorbed).toBeCloseTo(capacity, -3);

    // The ship's heat rises by what the coolant carried in, and the books still balance.
    const ledger = shielded.red.energyLedger;
    expect(ledger.heatAbsorbed).toBeCloseTo(
      capacity * (bare.red.energyLedger.hitEnergy / (2 * TEST_LASER.beamPower)),
      -3,
    );
    expect(ledger.heatAbsorbed + ledger.hitEnergy).toBeCloseTo(bare.red.energyLedger.hitEnergy, -3);
    const startHeat = shielded.red.heat.heatCapacity * 300;
    expect(shielded.red.heat.heat - startHeat).toBeCloseTo(
      ledger.heatGenerated + ledger.heatAbsorbed - ledger.heatRadiated,
      -3,
    );
    expect(shielded.red.heat.heat - bare.red.heat.heat).toBeGreaterThan(0.9 * ledger.heatAbsorbed);
  });

  it('protect only the section they are in', () => {
    const bare = attack(TEST_LASER, target());
    const elsewhere = attack(TEST_LASER, target([TEST_COOLANT_SHIELD], 'engine'));
    expect(elsewhere.red.power.systems.shields.supplied).toBe(TEST_COOLANT_SHIELD.power);
    expect(elsewhere.red.shields.coolantCapacity.engine).toBeCloseTo(
      TEST_COOLANT_SHIELD.capacity,
      -3,
    );
    expect(elsewhere.worn).toBeCloseTo(bare.worn, 9);
    expect(elsewhere.red.energyLedger.heatAbsorbed).toBe(0);
  });

  it.each([TEST_CHARGED_BEAM, TEST_NEUTRAL_BEAM, TEST_KINETIC_GUN])(
    'have no effect on particle beams or slugs: $type',
    (weapon) => {
      const bare = attack(weapon, target(), { seconds: 30 });
      const shielded = attack(weapon, target([TEST_COOLANT_SHIELD]), { seconds: 30 });
      expect(shielded.worn).toBeCloseTo(bare.worn, 9);
      expect(shielded.red.energyLedger.heatAbsorbed).toBe(0);
    },
  );
});

describe('unpowered shields', () => {
  const BOTH: readonly ShieldDesign[] = [TEST_MAGNETIC_SHIELD, TEST_COOLANT_SHIELD];

  it.each([TEST_CHARGED_BEAM, TEST_LASER])(
    'have no effect once lowered, and draw no power: $type',
    (weapon) => {
      const bare = attack(weapon, target());
      const lowered = attack(weapon, target(BOTH), {
        prepare: (give) => {
          give({ type: 'shields', raised: false });
        },
      });
      expect(lowered.red.shields.raised).toBe(false);
      expect(lowered.red.shields.powered).toBe(0);
      expect(lowered.red.power.systems.shields).toEqual({ demand: 0, supplied: 0 });
      expect(lowered.worn).toBeCloseTo(bare.worn, 9);
      expect(lowered.red.energyLedger.beamDeflected).toBe(0);
      expect(lowered.red.energyLedger.heatAbsorbed).toBe(0);
    },
  );

  it.each([TEST_CHARGED_BEAM, TEST_LASER])(
    'have no effect when higher priorities take all the power: $type',
    (weapon) => {
      // A reactor too weak for the drive alone: the drive takes all of it and the capacitors'
      // discharge, and shields ranked below charging get nothing.
      const weak = (design: Design) => withComponent(design, 'reactor', { output: 1e9 });
      const priorities: PowerSystem[] = ['drive', 'capacitors', 'shields', 'weapons'];
      const prepare: Prepare = (give) => {
        give({ type: 'power', priorities });
        give({ type: 'burn', throttle: 1, duration: SECONDS });
      };
      const design = weak(target(BOTH));
      // The same ship with its shields lowered, so that it burns away from the beam just the same.
      const lowered = attack(weapon, design, {
        prepare: (give) => {
          prepare(give);
          give({ type: 'shields', raised: false });
        },
      });
      const starved = attack(weapon, design, { prepare });
      const shields = starved.red.power.systems.shields;
      expect(shields.demand).toBeGreaterThan(0);
      expect(shields.supplied).toBe(0);
      expect(starved.red.shields.powered).toBe(0);
      expect(starved.worn).toBeGreaterThan(0);
      expect(starved.worn).toBe(lowered.worn);
      expect(starved.red.energyLedger.beamDeflected).toBe(0);
      expect(starved.red.energyLedger.heatAbsorbed).toBe(0);
    },
  );

  it('work in part on part of their power', () => {
    // A reactor that leaves the shields a quarter of what they ask for once the drive has its share.
    const shieldPower = TEST_MAGNETIC_SHIELD.power + TEST_COOLANT_SHIELD.power;
    const design = withComponent(target(BOTH), 'reactor', { output: 1.5e9 + shieldPower / 4 });
    const prepare: Prepare = (give) => {
      give({ type: 'power', priorities: ['drive', 'capacitors', 'shields', 'weapons'] });
      give({ type: 'burn', throttle: 1, duration: SECONDS });
    };
    const charged = attack(TEST_CHARGED_BEAM, design, { prepare });
    expect(charged.red.shields.powered).toBeCloseTo(0.25, 6);
    // The field goes as the square root of the power.
    const hit = firstHit(charged.hits);
    expect(hit.deflected / (hit.deflected + hit.power)).toBeCloseTo(0.5, 6);
    const laser = attack(TEST_LASER, design, { prepare });
    expect(firstHit(laser.hits).absorbed).toBeCloseTo(TEST_COOLANT_SHIELD.capacity / 4, -3);
  });
});
