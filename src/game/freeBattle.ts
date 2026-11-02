import { handMadeDesign } from '../data/designs';
import { OPENING_PASS } from '../data/scenarios';
import { createBattle, type Commander, type SideSetup } from '../sim/battle';
import { createBattleRunner, type BattleRunner } from './battleRunner';

/** One side of a free battle as chosen on the setup screen. */
export interface FreeBattleSide {
  /** A hand-made design's id. */
  readonly designId: string;
  readonly commander: Commander;
}

/** The choices for a free battle: always two sides, Blue then Red. */
export interface FreeBattleSetup {
  readonly sides: readonly [FreeBattleSide, FreeBattleSide];
}

/** The two sides' fixed identities, in battle order. */
export const FREE_BATTLE_SIDES = [
  { id: 'blue', name: 'Blue' },
  { id: 'red', name: 'Red' },
] as const;

/** What the setup screen offers first: the player's frigate against a computer cruiser. */
export const DEFAULT_FREE_BATTLE: FreeBattleSetup = {
  sides: [
    { designId: 'lance', commander: 'player' },
    { designId: 'bastion', commander: 'computer' },
  ],
};

/** The battle's sides for a free battle's choices. */
export const freeBattleSides = (setup: FreeBattleSetup): readonly SideSetup[] =>
  FREE_BATTLE_SIDES.map((side, i) => {
    const { designId, commander } = setup.sides[i] ?? DEFAULT_FREE_BATTLE.sides[0];
    return { ...side, commander, design: handMadeDesign(designId) };
  });

/** Sets up a free battle in the opening pass and returns it ready to run. */
export const startFreeBattle = (setup: FreeBattleSetup, seed = Date.now() >>> 0): BattleRunner =>
  createBattleRunner(createBattle({ seed, scenario: OPENING_PASS, sides: freeBattleSides(setup) }));
