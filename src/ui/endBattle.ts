import type { BattleRunner } from '../game/battleRunner';
import type { SideSetup } from '../sim/battle';
import { el } from './el';

/**
 * The "End battle" button and the confirmation it asks for. For a player side ending the battle
 * is a forfeit; a viewer of a battle between computer sides ends it with no result. The battle
 * pauses while the captain decides.
 */
export const createEndBattle = (runner: BattleRunner, viewer: SideSetup, onEnd: () => void) => {
  const forfeit = viewer.commander === 'player';
  const button = el('button', {
    className: 'time-button end-battle',
    text: 'End battle',
    attrs: { type: 'button' },
  });
  const confirm = el('button', {
    className: 'order-button',
    text: forfeit ? 'Forfeit' : 'End battle',
    attrs: { type: 'button' },
  });
  const cancel = el('button', {
    className: 'order-button',
    text: forfeit ? 'Keep fighting' : 'Keep watching',
    attrs: { type: 'button' },
  });
  const dialog = el(
    'dialog',
    { className: 'battle-dialog', attrs: { 'aria-label': 'End battle' } },
    el('h2', { text: 'End battle?' }),
    el('p', {
      text: forfeit
        ? `This is a forfeit: ${viewer.name} loses and the ship is treated as destroyed.`
        : 'The battle ends with no result.',
    }),
    el('div', { className: 'order-row' }, confirm, cancel),
  );

  let wasPaused = false;
  button.addEventListener('click', () => {
    wasPaused = runner.paused;
    runner.setPaused(true);
    dialog.showModal();
  });
  confirm.addEventListener('click', () => {
    dialog.close();
    onEnd();
  });
  cancel.addEventListener('click', () => {
    dialog.close();
  });
  // Escape closes the dialog too; either way the battle goes back to how it was.
  dialog.addEventListener('close', () => {
    runner.setPaused(wasPaused);
  });
  // Keys pressed in the dialog never reach the battle's keyboard shortcuts.
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });

  return {
    button,
    dialog,
    /** Disables the button once the battle is over. */
    update(over: boolean) {
      button.disabled = over;
    },
  };
};
