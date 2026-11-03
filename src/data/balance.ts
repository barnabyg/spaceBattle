import type { CaptainSkill } from '../sim/captain';
import type { ArmourType, ComponentType } from '../sim/design';

/** A level of opponent difficulty in the campaign. */
export interface Tier {
  /** 1 for the easiest. */
  readonly tier: number;
  /** The most an opponent's design may cost, credits. */
  readonly budget: number;
  /** How skilled the opponent's computer captain is. */
  readonly skill: CaptainSkill;
  /** What a win pays, credits. */
  readonly reward: number;
}

/**
 * The game's balance numbers in one place: what things cost, and what the campaign's tiers field
 * and pay. Prices are in credits; a modest frigate costs about 8 million.
 */
export const BALANCE = {
  /** The campaign's tiers, easiest first. */
  tiers: [
    { tier: 1, budget: 8.5e6, skill: 'low', reward: 3e6 },
    { tier: 2, budget: 10e6, skill: 'medium', reward: 5e6 },
    { tier: 3, budget: 26e6, skill: 'high', reward: 12e6 },
  ] satisfies readonly Tier[],
  /** What a new campaign starts with, credits: enough for a modest frigate and a little over. */
  startingCredits: 9e6,
  /**
   * Repairs cost this share of the price of new for the share of each component, armour and
   * structure that is wrecked.
   */
  repairPriceShare: 0.5,
  /** A refit's labour costs this share of all the new design's components and armour. */
  refitLabourShare: 0.2,
  /** A ship sells for this share of what it would cost new, less its repairs and restocking. */
  saleShare: 0.25,
  /** Price of each type of component, per kg of it; a magazine's ammunition is extra. */
  componentPrice: {
    drive: 30,
    thrusters: 15,
    reactor: 40,
    capacitor: 20,
    magazine: 10,
    'magnetic-shield': 35,
    'coolant-shield': 30,
    'long-range-scanner': 50,
    'signal-interceptor': 50,
    radiator: 10,
    laser: 40,
    'charged-particle-beam': 45,
    'neutral-particle-beam': 45,
    'kinetic-gun': 25,
    'point-defence': 30,
    launcher: 20,
    sensor: 60,
  } satisfies Readonly<Record<ComponentType, number>>,
  /** Price of a hull's bare structure, per kg. */
  structurePrice: 2,
  /** Price of armour, per kg. */
  armourPrice: { heavy: 3, ablative: 6 } satisfies Readonly<Record<ArmourType, number>>,
  /** Price of propellant, per kg. */
  propellantPrice: 0.2,
  /** Price of a kinetic gun's slug. */
  slugPrice: 50,
  /** Price of a point defence round. */
  roundPrice: 0.5,
  /** Price of a missile, per kg of its launch mass. */
  missilePrice: 10,
} as const;
