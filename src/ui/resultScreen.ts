import type { SideSetup } from '../sim/battle';
import type { BattleOutcome, Loss } from '../sim/outcome';
import { el } from './el';
import { formatBattleTime } from './format';

const CAUSE_TEXT = {
  'reactor-breach': 'reactor breach',
  'structural-failure': 'structural failure of the middle section',
  'no-working-weapons': 'no working weapons',
  'no-working-drive': 'no working drive',
} as const;

const describeLoss = (name: string, loss: Loss): string => {
  switch (loss.result) {
    case 'destroyed':
    case 'disabled':
      return `${name} ${loss.result}: ${CAUSE_TEXT[loss.cause]}`;
    case 'forfeit':
      return `${name} forfeited`;
  }
};

/** The headline of a battle's outcome: who won, a draw, or no result. */
export const outcomeHeadline = (outcome: BattleOutcome, sides: readonly SideSetup[]): string => {
  const nameOf = (id: string) => sides.find((s) => s.id === id)?.name ?? id;
  if (outcome.winner !== null) return `${nameOf(outcome.winner)} wins`;
  return outcome.sides.some((s) => s.loss) ? 'Draw' : 'No result';
};

/** One line for each side that lost, saying how; or that the battle ended with no result. */
export const outcomeDetails = (
  outcome: BattleOutcome,
  sides: readonly SideSetup[],
): readonly string[] => {
  const lines = outcome.sides.flatMap(({ side, loss }) =>
    loss ? [describeLoss(sides.find((s) => s.id === side)?.name ?? side, loss)] : [],
  );
  return lines.length > 0 ? lines : ['Battle ended with no result'];
};

/**
 * A modal screen over the battle saying how it ended, with a button to go on. What going on
 * means, and what the button says, is the caller's choice.
 */
export const createResultScreen = (
  sides: readonly SideSetup[],
  onContinue: () => void,
  continueLabel = 'New battle',
) => {
  const headline = el('h2', { className: 'result-headline' });
  const details = el('ul', { className: 'result-details' });
  const time = el('p', { className: 'result-time' });
  const button = el('button', {
    className: 'order-button result-continue',
    text: continueLabel,
    attrs: { type: 'button' },
  });
  const element = el(
    'dialog',
    { className: 'battle-dialog result-screen', attrs: { 'aria-label': 'Battle result' } },
    headline,
    details,
    time,
    button,
  );
  button.addEventListener('click', onContinue);
  // The result stays up until the captain goes on, and its keys never reach the battle.
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
  });
  element.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });

  return {
    element,
    /** Shows the outcome; showing it again changes nothing. */
    show(outcome: BattleOutcome) {
      if (element.open) return;
      headline.textContent = outcomeHeadline(outcome, sides);
      details.replaceChildren(...outcomeDetails(outcome, sides).map((text) => el('li', { text })));
      time.textContent = `Battle ended at ${formatBattleTime(outcome.time)}`;
      element.showModal();
    },
  };
};
