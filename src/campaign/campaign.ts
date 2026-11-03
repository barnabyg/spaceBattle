import { BALANCE, type Tier } from '../data/balance';
import { handMadeDesign } from '../data/designs';
import { OPPONENTS, type Opponent } from '../data/opponents';
import { STARTING_SCENARIOS } from '../data/scenarios';
import type { BattleSetup } from '../sim/battle';
import type { Design } from '../sim/design';
import type { BattleOutcome } from '../sim/outcome';
import { createRandom } from '../sim/random';
import { designCost } from '../shipyard/cost';

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
  const known = campaign.designs.some((d) => d.id === design.id);
  return {
    ...campaign,
    credits: campaign.credits - cost,
    hangar: [...campaign.hangar, { id: `ship-${number}`, name: `Ship ${number}`, design }],
    designs: known
      ? campaign.designs.map((d) => (d.id === design.id ? design : d))
      : [...campaign.designs, design],
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
        { id: PLAYER_SIDE, name: ship.name, commander: 'player', design: ship.design },
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
}

/** Settles a battle fought: a win pays the tier's reward, anything else pays nothing. */
export const recordBattle = (
  campaign: Campaign,
  battle: CampaignBattle,
  { outcome }: CampaignBattleResult,
): Campaign => ({
  ...campaign,
  credits: campaign.credits + (outcome.winner === PLAYER_SIDE ? tierOf(battle.tier).reward : 0),
  battles: campaign.battles + 1,
});
