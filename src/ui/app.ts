import {
  DEFAULT_FREE_BATTLE,
  freeBattleBatch,
  newSeed,
  startFreeBattle,
  type FreeBattleSetup,
} from '../game/freeBattle';
import type { RecordedAction } from '../game/orderLog';
import {
  buildShip,
  newCampaign,
  PLAYER_SIDE,
  prepareBattle,
  recordBattle,
  refitShip,
  repairShip,
  restockShip,
  sellShip,
  tierOf,
  type Campaign,
  type CampaignBattle,
} from '../campaign/campaign';
import { loadCampaign, saveCampaign } from '../campaign/campaignFile';
import { HAND_MADE_DESIGNS } from '../data/designs';
import { createBattleRunner } from '../game/battleRunner';
import { createBattle } from '../sim/battle';
import type { Design } from '../sim/design';
import { createBatchScreen } from './batchScreen';
import { createBattleScreen } from './battleScreen';
import { createBriefingScreen } from './briefingScreen';
import { createCampaignHub } from './campaignHub';
import { downloadText } from './files';
import { formatCredits } from './format';
import { createMainMenu } from './mainMenu';
import { createDesignLibrary, localStore } from './designLibrary';
import { createSetupScreen, DEFAULT_TEST_SETTINGS, type TestSettings } from './setupScreen';
import { createShipyardScreen } from './shipyardScreen';

/** A screen the app can show: its element, and anything it must release when it goes. */
interface Screen {
  readonly element: HTMLElement;
  focus?(): void;
  dispose?(): void;
}

/**
 * The game's screens and the way between them: main menu, free battle setup, battle (whose
 * result screen leads back to setup) and, in test mode, batch runs. One screen at a time fills
 * `root`; the one it replaces is disposed, so battles fought one after another never stack
 * loops, listeners or renderers. Test mode is switched on from the main menu and nowhere else.
 */
export const createApp = (root: HTMLElement) => {
  let current: Screen | null = null;
  // The last choices made on the setup screen, kept for the next visit.
  let setup: FreeBattleSetup = DEFAULT_FREE_BATTLE;
  let testMode = false;
  let testSettings: TestSettings = DEFAULT_TEST_SETTINGS;
  const library = createDesignLibrary(localStore());
  /** Every design a free battle may use: the hand-made ones and those saved from the shipyard. */
  const designs = (): readonly Design[] => [...HAND_MADE_DESIGNS, ...library.designs()];
  // The campaign under way, kept until the page closes.
  let campaign: Campaign | null = null;
  // Where the shipyard's Back button goes: the main menu, or the campaign hub it was opened from.
  let shipyardReturn = () => {
    showMainMenu();
  };

  const show = (screen: Screen) => {
    current?.dispose?.();
    root.replaceChildren(screen.element);
    current = screen;
    screen.focus?.();
  };

  const showMainMenu = (message = '') => {
    show(
      createMainMenu({
        message,
        onLoadCampaign: (text) => {
          try {
            campaign = loadCampaign(text);
            showCampaign('Campaign loaded.');
          } catch (error) {
            showMainMenu(error instanceof Error ? error.message : String(error));
          }
        },
        onFreeBattle: showSetup,
        onShipyard: () => {
          shipyardReturn = () => {
            showMainMenu();
          };
          showShipyard();
        },
        onCampaign: () => {
          campaign ??= newCampaign(newSeed());
          showCampaign();
        },
        testMode,
        onTestModeChange: (on) => {
          testMode = on;
        },
      }),
    );
  };

  const showShipyard = () => {
    show(createShipyardScreen(library, { onBack: shipyardReturn }));
  };

  /** Takes a campaign action, then shows the hub with what came of it. */
  const act = (action: (c: Campaign) => Campaign, done: string) => {
    if (!campaign) return;
    try {
      campaign = action(campaign);
      showCampaign(done);
    } catch (error) {
      showCampaign(error instanceof Error ? error.message : String(error));
    }
  };

  const showCampaign = (message = '') => {
    if (!campaign) return;
    show(
      createCampaignHub(
        campaign,
        library.designs(),
        {
          onBuild: (design) => {
            if (!campaign) return;
            try {
              campaign = buildShip(campaign, design);
              showCampaign(`Built a ${design.name}; ${formatCredits(campaign.credits)} left.`);
            } catch (error) {
              showCampaign(error instanceof Error ? error.message : String(error));
            }
          },
          onRepair: (shipId, share) => {
            act((c) => repairShip(c, shipId, share), 'Repaired.');
          },
          onRestock: (shipId) => {
            act((c) => restockShip(c, shipId), 'Restocked.');
          },
          onRefit: (shipId, design) => {
            act((c) => refitShip(c, shipId, design), `Refitted to ${design.name}.`);
          },
          onSell: (shipId) => {
            act((c) => sellShip(c, shipId), 'Sold.');
          },
          onFight: (shipId, tier) => {
            if (campaign) showBriefing(prepareBattle(campaign, shipId, tier));
          },
          onShipyard: () => {
            shipyardReturn = () => {
              showCampaign();
            };
            showShipyard();
          },
          onMainMenu: () => {
            showMainMenu();
          },
          onSave: () => {
            if (!campaign) return;
            downloadText(
              `space-battle-campaign-${String(campaign.battles)}-battles.json`,
              saveCampaign(campaign),
            );
            showCampaign('Campaign saved.');
          },
          onNewCampaign: () => {
            campaign = newCampaign(newSeed());
            showCampaign('A new campaign.');
          },
        },
        message,
      ),
    );
  };

  /**
   * Fights a campaign battle, then settles it and goes back to the hub; in test mode `replay`
   * gives the orders of an earlier try again.
   */
  /** A campaign battle about to be fought, as the battle it will be. */
  const campaignBattle = (pending: CampaignBattle) =>
    createBattle(
      testMode ? { ...pending.setup, timeLimit: testSettings.timeLimit } : pending.setup,
    );

  /** The intelligence report before a campaign battle, and the choice to fight it or go back. */
  const showBriefing = (pending: CampaignBattle) => {
    const battle = campaignBattle(pending);
    show(
      createBriefingScreen(
        pending,
        battle.observe(PLAYER_SIDE).intelligence[0],
        tierOf(pending.tier),
        {
          onFight: () => {
            showCampaignBattle(pending);
          },
          onBack: () => {
            showCampaign();
          },
        },
      ),
    );
  };

  const showCampaignBattle = (pending: CampaignBattle, replay?: readonly RecordedAction[]) => {
    const { setup } = pending;
    const battle = campaignBattle(pending);
    const runner = createBattleRunner(battle, { testMode, ...(replay && { replay }) });
    show(
      createBattleScreen(runner, {
        continueLabel: 'Back to campaign',
        onContinue: () => {
          const { outcome } = battle;
          if (!campaign || !outcome) return;
          campaign = recordBattle(campaign, pending, {
            outcome,
            condition: battle.observe(PLAYER_SIDE).ownShip.condition,
          });
          const shipLost = outcome.sides.find((s) => s.side === PLAYER_SIDE)?.shipLost;
          showCampaign(
            outcome.winner === PLAYER_SIDE
              ? `Won: paid ${formatCredits(tierOf(pending.tier).reward)}.`
              : shipLost
                ? `Lost, and ${setup.sides[0]?.name ?? 'the ship'} with it: no pay.`
                : 'Lost: no pay.',
          );
        },
        ...(testMode && {
          test: {
            seed: setup.seed,
            timeLimit: testSettings.timeLimit,
            onReplay: () => {
              showCampaignBattle(pending, runner.orders);
            },
          },
        }),
      }),
    );
  };

  const showSetup = () => {
    const available = designs();
    // A design saved earlier may have been deleted in the shipyard since.
    if (!setup.sides.every((side) => available.some((d) => d.id === side.designId))) {
      setup = DEFAULT_FREE_BATTLE;
    }
    show(
      createSetupScreen(
        setup,
        available,
        {
          onStart: (chosen) => {
            setup = chosen;
            showBattle(testSettings.seed ?? newSeed());
          },
          onBack: (chosen) => {
            setup = chosen;
            showMainMenu();
          },
        },
        testMode
          ? {
              settings: testSettings,
              onChange: (settings) => {
                testSettings = settings;
              },
              onRunBatch: (chosen, settings) => {
                setup = chosen;
                showBatch(settings);
              },
            }
          : undefined,
      ),
    );
  };

  /** Starts a battle; in test mode `replay` gives the orders of an earlier one again. */
  const showBattle = (seed: number, replay?: readonly RecordedAction[]) => {
    const runner = testMode
      ? startFreeBattle(
          setup,
          seed,
          { timeLimit: testSettings.timeLimit, ...(replay && { replay }) },
          designs(),
        )
      : startFreeBattle(setup, seed, undefined, designs());
    show(
      createBattleScreen(runner, {
        onContinue: showSetup,
        continueLabel: 'Back to setup',
        ...(testMode && {
          test: {
            seed,
            timeLimit: testSettings.timeLimit,
            onReplay: () => {
              showBattle(seed, runner.orders);
            },
          },
        }),
      }),
    );
  };

  const showBatch = (settings: TestSettings) => {
    const batch = freeBattleBatch(
      setup,
      {
        battles: settings.battles,
        seed: settings.seed ?? newSeed(),
        timeLimit: settings.timeLimit,
      },
      designs(),
    );
    show(createBatchScreen(batch, { onBack: showSetup }));
  };

  showMainMenu();
};
