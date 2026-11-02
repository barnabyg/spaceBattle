import { el } from './el';

export interface MainMenuActions {
  readonly onFreeBattle: () => void;
}

/** The first screen: the game's title and where to go from here. */
export const createMainMenu = ({ onFreeBattle }: MainMenuActions) => {
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
  );

  return {
    element,
    /** Puts the keyboard on the first choice. */
    focus() {
      freeBattle.focus();
    },
  };
};
