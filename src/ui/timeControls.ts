import type { BattleRunner } from '../game/battleRunner';
import { el } from './el';
import { formatBattleTime } from './format';

/** Pause and time compression, as buttons and keyboard shortcuts. */
export const createTimeControls = (runner: BattleRunner) => {
  const clock = el('output', { className: 'battle-clock', attrs: { 'aria-label': 'Battle time' } });
  const pause = el('button', { className: 'time-button', attrs: { type: 'button' } });
  const slower = el('button', {
    className: 'time-button',
    text: '«',
    attrs: { type: 'button', 'aria-label': 'Slower', title: 'Slower ( - )' },
  });
  const faster = el('button', {
    className: 'time-button',
    text: '»',
    attrs: { type: 'button', 'aria-label': 'Faster', title: 'Faster ( + )' },
  });
  const compression = el('output', {
    className: 'time-compression',
    attrs: { 'aria-label': 'Time compression' },
  });
  const element = el(
    'div',
    { className: 'time-controls', attrs: { role: 'group', 'aria-label': 'Time controls' } },
    clock,
    pause,
    slower,
    compression,
    faster,
    el('span', { className: 'time-hint', text: 'Space pause · + / − time compression' }),
  );

  pause.addEventListener('click', () => {
    runner.togglePause();
  });
  slower.addEventListener('click', () => {
    runner.slower();
  });
  faster.addEventListener('click', () => {
    runner.faster();
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
      compression.textContent = runner.paused ? 'Paused' : `${runner.timeCompression}×`;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
    },
  };
};
