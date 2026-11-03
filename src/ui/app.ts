import {
  DEFAULT_FREE_BATTLE,
  freeBattleBatch,
  newSeed,
  startFreeBattle,
  type FreeBattleSetup,
} from '../game/freeBattle';
import type { RecordedAction } from '../game/orderLog';
import { HAND_MADE_DESIGNS } from '../data/designs';
import type { Design } from '../sim/design';
import { createBatchScreen } from './batchScreen';
import { createBattleScreen } from './battleScreen';
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

  const show = (screen: Screen) => {
    current?.dispose?.();
    root.replaceChildren(screen.element);
    current = screen;
    screen.focus?.();
  };

  const showMainMenu = () => {
    show(
      createMainMenu({
        onFreeBattle: showSetup,
        onShipyard: showShipyard,
        testMode,
        onTestModeChange: (on) => {
          testMode = on;
        },
      }),
    );
  };

  const showShipyard = () => {
    show(createShipyardScreen(library, { onBack: showMainMenu }));
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
