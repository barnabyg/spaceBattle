import { el } from './el';

export interface MainMenuActions {
  readonly onFreeBattle: () => void;
  /** Whether test mode is on now. */
  readonly testMode: boolean;
  /** Test mode is switched on and off here, and nowhere else. */
  readonly onTestModeChange: (on: boolean) => void;
}

/** The first screen: the game's title, where to go from here, and the test mode switch. */
export const createMainMenu = ({ onFreeBattle, testMode, onTestModeChange }: MainMenuActions) => {
  const freeBattle = el('button', {
    className: 'menu-button',
    text: 'Free battle',
    attrs: { type: 'button' },
  });
  const campaign = el('button', {
    className: 'menu-button',
    text: 'Campaign',
    attrs: { type: 'button', disabled: '', 'aria-describedby': 'campaign-note' },
  });
  freeBattle.addEventListener('click', onFreeBattle);
  const testModeSwitch = el('input', {
    attrs: { type: 'checkbox', 'aria-describedby': 'test-mode-note' },
  });
  testModeSwitch.checked = testMode;
  testModeSwitch.addEventListener('change', () => {
    onTestModeChange(testModeSwitch.checked);
  });

  const element = el(
    'main',
    { className: 'menu-screen main-menu' },
    el('h1', { className: 'menu-title', text: 'Space Battle' }),
    el('p', {
      className: 'menu-tagline',
      text: 'Long-range combat between warships, under known physics.',
    }),
    el(
      'nav',
      { className: 'menu-items', attrs: { 'aria-label': 'Main menu' } },
      el(
        'div',
        { className: 'menu-item' },
        freeBattle,
        el('span', {
          className: 'menu-note',
          text: 'Any two designs, each side commanded by you or the computer.',
        }),
      ),
      el(
        'div',
        { className: 'menu-item' },
        campaign,
        el('span', {
          className: 'menu-note',
          text: 'Coming later.',
          attrs: { id: 'campaign-note' },
        }),
      ),
    ),
    el(
      'div',
      { className: 'menu-item test-mode-switch' },
      el('label', { className: 'switch' }, testModeSwitch, el('span', { text: 'Test mode' })),
      el('span', {
        className: 'menu-note',
        text: 'For testing the game rather than playing it: a battle time limit, extra logging, the full enemy design, faster time compression, replay from a seed and batch runs.',
        attrs: { id: 'test-mode-note' },
      }),
    ),
  );

  return {
    element,
    /** Puts the keyboard on the first choice. */
    focus() {
      freeBattle.focus();
    },
  };
};
