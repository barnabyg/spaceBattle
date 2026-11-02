import { DEFAULT_FREE_BATTLE, startFreeBattle, type FreeBattleSetup } from '../game/freeBattle';
import { createBattleScreen } from './battleScreen';
import { createMainMenu } from './mainMenu';
import { createSetupScreen } from './setupScreen';

/** A screen the app can show: its element, and anything it must release when it goes. */
interface Screen {
  readonly element: HTMLElement;
  focus?(): void;
  dispose?(): void;
}

/**
 * The game's screens and the way between them: main menu, free battle setup, battle (whose
 * result screen leads back to setup). One screen at a time fills `root`; the one it replaces
 * is disposed, so battles fought one after another never stack loops, listeners or renderers.
 */
export const createApp = (root: HTMLElement) => {
  let current: Screen | null = null;
  // The last choices made on the setup screen, kept for the next visit.
  let setup: FreeBattleSetup = DEFAULT_FREE_BATTLE;

  const show = (screen: Screen) => {
    current?.dispose?.();
    root.replaceChildren(screen.element);
    current = screen;
    screen.focus?.();
  };

  const showMainMenu = () => {
    show(createMainMenu({ onFreeBattle: showSetup }));
  };

  const showSetup = () => {
    show(
      createSetupScreen(setup, {
        onStart: (chosen) => {
          setup = chosen;
          showBattle();
        },
        onBack: (chosen) => {
          setup = chosen;
          showMainMenu();
        },
      }),
    );
  };

  const showBattle = () => {
    show(
      createBattleScreen(startFreeBattle(setup), {
        onContinue: showSetup,
        continueLabel: 'Back to setup',
      }),
    );
  };

  showMainMenu();
};
