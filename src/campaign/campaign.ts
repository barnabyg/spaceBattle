import { BALANCE, type Tier } from '../data/balance';
import { handMadeDesign } from '../data/designs';
import { OPPONENTS, type Opponent } from '../data/opponents';
import { STARTING_SCENARIOS } from '../data/scenarios';
import type { BattleSetup } from '../sim/battle';
import type { Design } from '../sim/design';
import type { BattleOutcome } from '../sim/outcome';
import { createRandom } from '../sim/random';
import { fullCondition, type ShipCondition } from '../sim/ship';
import { designCost } from '../shipyard/cost';
import { refitPrice, refittedCondition } from './refit';
import {
  conditionRepairCost,
  conditionRestockCost,
  repairedCondition,
  restockedCondition,
} from './upkeep';

/** The player's side in a campaign battle. */
export const PLAYER_SIDE = 'player';
/** The opponent's side in a campaign battle, commanded by the computer. */
export const OPPONENT_SIDE = 'opponent';

/** A ship the player owns. */
export interface CampaignShip {
  readonly id: string;
  /** "Ship 1", "Ship 2" and so on, in the order built. */
  readonly name: string;
  readonly design: Design;
  /** Its damage, propellant and ammunition, as its last battle and any repairs left them. */
  readonly condition: ShipCondition;
}

/**
 * A campaign as it stands between battles: the player's credits and hangar, the designs they
 * can build, and how many battles they have fought. It changes only through the actions here.
 */
export interface Campaign {
  readonly credits: number;
  readonly hangar: readonly CampaignShip[];
  /** The designs the player can build: the starter designs and any others they have built. */
  readonly designs: readonly Design[];
  /** Picks each battle's opponent, starting scenario and seed. */
  readonly seed: number;
  /** Battles fought so far. */
  readonly battles: number;
  /** Ships built so far, which numbers the next one. */
  readonly shipsBuilt: number;
}

/** The ready-made designs a new campaign offers: a laser, a gun and a missile frigate. */
const STARTER_DESIGNS = ['lance', 'sling', 'quiver'] as const;

/** A new campaign: starting credits, the starter designs and an empty hangar. */
export const newCampaign = (seed: number): Campaign => ({
  credits: BALANCE.startingCredits,
  hangar: [],
  designs: STARTER_DESIGNS.map(handMadeDesign),
  seed: seed >>> 0,
  battles: 0,
  shipsBuilt: 0,
});

/** A tier by number. */
export const tierOf = (tier: number): Tier => {
  const found = BALANCE.tiers.find((t) => t.tier === tier);
  if (!found) throw new Error(`No tier ${tier}`);
  return found;
};

const shipOf = (campaign: Campaign, shipId: string): CampaignShip => {
  const ship = campaign.hangar.find((s) => s.id === shipId);
  if (!ship) throw new Error(`No ship "${shipId}" in the hangar`);
  return ship;
};

/**
 * Builds a ship of a design into the hangar, paying its cost. A design not yet among the
 * campaign's designs, such as one from the shipyard, joins them.
 */
export const buildShip = (campaign: Campaign, design: Design): Campaign => {
  const cost = designCost(design);
  if (cost > campaign.credits) throw new Error('Not enough credits to build this design.');
  const number = campaign.shipsBuilt + 1;
  return {
    ...withDesign(campaign, design),
    credits: campaign.credits - cost,
    hangar: [
      ...campaign.hangar,
      { id: `ship-${number}`, name: `Ship ${number}`, design, condition: fullCondition(design) },
    ],
    shipsBuilt: number,
  };
};

/** A battle the campaign is about to fight: one of the player's ships against a tier's opponent. */
export interface CampaignBattle {
  readonly shipId: string;
  readonly tier: number;
  readonly opponent: Opponent;
  /** The battle to fight: the player's side first, then the opponent's. */
  readonly setup: BattleSetup;
}

/**
 * The next battle for one of the player's ships against an opponent of a tier, picked with the
 * starting scenario and the battle's seed from the campaign's seed and the battles fought, so
 * preparing it again gives the same battle.
 */
export const prepareBattle = (campaign: Campaign, shipId: string, tier: number): CampaignBattle => {
  const ship = shipOf(campaign, shipId);
  const { skill } = tierOf(tier);
  const random = createRandom((campaign.seed ^ Math.imul(campaign.battles + 1, 0x9e3779b1)) >>> 0);
  const pick = <T>(options: readonly T[]): T => {
    const choice = options[Math.floor(random() * options.length)];
    if (choice === undefined) throw new Error('Nothing to pick from');
    return choice;
  };
  const opponent = pick(OPPONENTS.filter((o) => o.tier === tier));
  const scenario = pick(STARTING_SCENARIOS);
  return {
    shipId,
    tier,
    opponent,
    setup: {
      seed: Math.floor(random() * 2 ** 32),
      scenario,
      sides: [
        {
          id: PLAYER_SIDE,
          name: ship.name,
          commander: 'player',
          design: ship.design,
          condition: ship.condition,
        },
        {
          id: OPPONENT_SIDE,
          name: 'Opponent',
          commander: 'computer',
          design: opponent.design,
          skill,
        },
      ],
    },
  };
};

/** What came of a campaign battle. */
export interface CampaignBattleResult {
  readonly outcome: BattleOutcome;
  /**
   * The player's ship's condition at the end (see `OwnShipObservation.condition`); as it went
   * in if left out.
   */
  readonly condition?: ShipCondition;
}

/** A campaign with one of its ships changed. */
const withShip = (
  campaign: Campaign,
  shipId: string,
  change: (ship: CampaignShip) => CampaignShip,
): Campaign => ({
  ...campaign,
  hangar: campaign.hangar.map((ship) => (ship.id === shipId ? change(ship) : ship)),
});

/**
 * Settles a battle fought: a win pays the tier's reward, anything else pays nothing. The ship
 * keeps whatever damage it took and whatever it used until repaired and restocked.
 */
export const recordBattle = (
  campaign: Campaign,
  battle: CampaignBattle,
  { outcome, condition }: CampaignBattleResult,
): Campaign => ({
  ...withShip(campaign, battle.shipId, (ship) => ({
    ...ship,
    condition: condition ?? ship.condition,
  })),
  credits: campaign.credits + (outcome.winner === PLAYER_SIDE ? tierOf(battle.tier).reward : 0),
  battles: campaign.battles + 1,
});

/** What repairing all of a ship's damage costs, credits (see `conditionRepairCost`). */
export const repairCost = (ship: CampaignShip): number =>
  conditionRepairCost(ship.design, ship.condition);

/** What refilling a ship's tanks and magazines costs: the propellant and ammunition used. */
export const restockCost = (ship: CampaignShip): number =>
  conditionRestockCost(ship.design, ship.condition);

const pay = (campaign: Campaign, cost: number): Campaign => {
  if (cost > campaign.credits) throw new Error('Not enough credits for that.');
  return { ...campaign, credits: campaign.credits - cost };
};

/**
 * Repairs `share` (0–1) of every damage a ship has, all of it by default, for that share of the
 * repair cost. What is left unrepaired stays with the ship into its next battle.
 */
export const repairShip = (campaign: Campaign, shipId: string, share = 1): Campaign => {
  if (!(share >= 0 && share <= 1)) throw new Error('A repair covers a share of 0 to 1.');
  const ship = shipOf(campaign, shipId);
  return withShip(pay(campaign, share * repairCost(ship)), shipId, (s) => ({
    ...s,
    condition: repairedCondition(s.design, s.condition, share),
  }));
};

/** Refills a ship's propellant and ammunition, paying for what it used. */
export const restockShip = (campaign: Campaign, shipId: string): Campaign => {
  const ship = shipOf(campaign, shipId);
  return withShip(pay(campaign, restockCost(ship)), shipId, (s) => ({
    ...s,
    condition: restockedCondition(s.design, s.condition),
  }));
};

/** What refitting a ship to another design costs, credits (see `refitPrice`). */
export const refitCost = (ship: CampaignShip, design: Design): number =>
  refitPrice(ship.design, design);

/** Adds a design to those the campaign can build, or updates it. */
const withDesign = (campaign: Campaign, design: Design): Campaign => ({
  ...campaign,
  designs: campaign.designs.some((d) => d.id === design.id)
    ? campaign.designs.map((d) => (d.id === design.id ? design : d))
    : [...campaign.designs, design],
});

/**
 * Refits a ship to another design on the same hull size, paying for the new components and the
 * labour; whatever is taken out is scrapped. Components it keeps keep their damage.
 */
export const refitShip = (campaign: Campaign, shipId: string, design: Design): Campaign => {
  const ship = shipOf(campaign, shipId);
  if (design.hullSize !== ship.design.hullSize) {
    throw new Error(
      `A refit keeps the same hull size: ${ship.name} is a ${ship.design.hullSize}, not a ${design.hullSize}.`,
    );
  }
  return withShip(withDesign(pay(campaign, refitCost(ship, design)), design), shipId, (s) => ({
    ...s,
    design,
    condition: refittedCondition(s.design, s.condition, design),
  }));
};

/**
 * What a ship sells for: `BALANCE.saleShare` of what it would cost new, less what its repairs
 * and restocking would cost, and never less than nothing, credits.
 */
export const saleValue = (ship: CampaignShip): number =>
  BALANCE.saleShare * Math.max(0, designCost(ship.design) - repairCost(ship) - restockCost(ship));

/** Sells a ship: it leaves the hangar and its sale value is paid. */
export const sellShip = (campaign: Campaign, shipId: string): Campaign => {
  const ship = shipOf(campaign, shipId);
  return {
    ...campaign,
    credits: campaign.credits + saleValue(ship),
    hangar: campaign.hangar.filter((s) => s.id !== shipId),
  };
};
