import type { BattleRunner } from '../game/battleRunner';
import { el } from './el';
import { formatBattleTime } from './format';

/** How many time compressions have a number key: 1 to 5. */
const NUMBERED = 5;

/**
 * Pause and time compression, as buttons and keyboard shortcuts: one button per time
 * compression the runner offers, the current one pressed, and kept pressed while paused.
 */
export const createTimeControls = (runner: BattleRunner) => {
  const clock = el('output', { className: 'battle-clock', attrs: { 'aria-label': 'Battle time' } });
  const pause = el('button', { className: 'time-button', attrs: { type: 'button' } });
  const speeds = runner.compressions.map((compression, i) => {
    const button = el('button', {
      className: 'time-button time-speed',
      text: `${compression}×`,
      attrs: {
        type: 'button',
        'aria-pressed': 'false',
        title: i < NUMBERED ? `${compression}× ( ${i + 1} )` : `${compression}×`,
      },
    });
    button.addEventListener('click', () => {
      runner.setTimeCompression(compression);
    });
    return { compression, button };
  });
  const element = el(
    'div',
    { className: 'time-controls', attrs: { role: 'group', 'aria-label': 'Time controls' } },
    clock,
    pause,
    el(
      'div',
      { className: 'time-speeds', attrs: { role: 'group', 'aria-label': 'Time compression' } },
      ...speeds.map(({ button }) => button),
    ),
    el('span', {
      className: 'time-hint',
      text: `Space pause · 1–${String(Math.min(speeds.length, NUMBERED))} or + / − time compression`,
    }),
  );

  pause.addEventListener('click', () => {
    runner.togglePause();
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    switch (event.key) {
      case ' ':
        runner.togglePause();
        break;
      case '+':
      case '=':
      case ']':
        runner.faster();
        break;
      case '-':
      case '_':
      case '[':
        runner.slower();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5': {
        const compression = runner.compressions[Number(event.key) - 1];
        if (compression === undefined) return;
        runner.setTimeCompression(compression);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  return {
    element,
    update() {
      clock.textContent = formatBattleTime(runner.battle.time);
      pause.textContent = runner.paused ? '▶' : '❚❚';
      pause.setAttribute('aria-label', runner.paused ? 'Resume' : 'Pause');
      pause.title = runner.paused ? 'Resume (Space)' : 'Pause (Space)';
      pause.classList.toggle('time-paused', runner.paused);
      for (const { compression, button } of speeds) {
        button.setAttribute('aria-pressed', String(compression === runner.timeCompression));
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
    },
  };
};
