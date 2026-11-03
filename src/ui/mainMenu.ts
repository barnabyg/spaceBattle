import { el } from './el';
import { textFilePicker } from './files';

export interface MainMenuActions {
  readonly onFreeBattle: () => void;
  readonly onShipyard: () => void;
  /** Goes to the campaign under way, or starts a new one. */
  readonly onCampaign: () => void;
  /** Loads a campaign from the text of a campaign file. */
  readonly onLoadCampaign: (text: string) => void;
  /** What the last action came to, such as a file that would not load. */
  readonly message?: string;
  /** Whether test mode is on now. */
  readonly testMode: boolean;
  /** Test mode is switched on and off here, and nowhere else. */
  readonly onTestModeChange: (on: boolean) => void;
}

/** The first screen: the game's title, where to go from here, and the test mode switch. */
export const createMainMenu = ({
  onFreeBattle,
  onShipyard,
  onCampaign,
  onLoadCampaign,
  message = '',
  testMode,
  onTestModeChange,
}: MainMenuActions) => {
  const freeBattle = el('button', {
    className: 'menu-button',
    text: 'Free battle',
    attrs: { type: 'button' },
  });
  const campaign = el('button', {
    className: 'menu-button',
    text: 'Campaign',
    attrs: { type: 'button' },
  });
  campaign.addEventListener('click', onCampaign);
  freeBattle.addEventListener('click', onFreeBattle);
  const shipyard = el('button', {
    className: 'menu-button',
    text: 'Shipyard',
    attrs: { type: 'button' },
  });
  shipyard.addEventListener('click', onShipyard);
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
        shipyard,
        el('span', {
          className: 'menu-note',
          text: 'Design your own ships and use them in free battles.',
        }),
      ),
      el(
        'div',
        { className: 'menu-item' },
        campaign,
        el('span', {
          className: 'menu-note',
          text: 'Build ships, fight ever more capable opponents and earn credits.',
        }),
      ),
      el(
        'div',
        { className: 'menu-item' },
        textFilePicker('Load campaign', onLoadCampaign),
        el('span', { className: 'menu-note', text: 'Carry on a campaign saved to a file.' }),
      ),
    ),
    el('p', { className: 'menu-note', text: message, attrs: { role: 'status' } }),
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
