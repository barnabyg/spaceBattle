import type { BattleRunner } from '../game/battleRunner';
import type { BattleEvent, SideId, SideSetup } from '../sim/battle';
import { involves } from '../sim/events';
import { COMPONENT_TEXT, SECTION_TEXT } from './damagePanel';
import { el } from './el';
import { formatBattleTime } from './format';

/** How many time compressions have a number key: 1 to 5. */
const NUMBERED = 5;

/** The cause of an automatic slowdown, naming the affected ship and part where relevant. */
const slowdownReason = (
  event: BattleEvent,
  sides: readonly SideSetup[],
  viewer: SideId,
): string => {
  // Damage to enemy internals is absent from this captain's observation.
  if (!involves(event, viewer)) return 'Enemy combat damage (details unavailable)';
  const name = (id: string) => sides.find((side) => side.id === id)?.name ?? id;
  switch (event.type) {
    case 'detonation':
      return `Nuclear detonation near ${name(event.target)}`;
    case 'magazine-explosion':
      return `${name(event.side)}: ${SECTION_TEXT[event.section].toLowerCase()} magazine exploded`;
    case 'armour-breached':
      return `${name(event.side)}: ${SECTION_TEXT[event.section].toLowerCase()} armour breached`;
    case 'component-lost':
      return `${name(event.side)}: ${COMPONENT_TEXT[event.component].toLowerCase()} lost (${SECTION_TEXT[event.section].toLowerCase()})`;
    case 'structural-failure':
      return `${name(event.side)}: ${SECTION_TEXT[event.section].toLowerCase()} section lost`;
    case 'withdrawal':
      return `${name(event.side)} withdrawing`;
    case 'battle-ended':
      return 'Battle ended';
    default:
      return '';
  }
};

/**
 * Pause and time compression, as buttons and keyboard shortcuts: one button per time
 * compression the runner offers, the current one pressed, and kept pressed while paused.
 */
export const createTimeControls = (runner: BattleRunner, viewer: SideId) => {
  const clock = el('output', { className: 'battle-clock', attrs: { 'aria-label': 'Battle time' } });
  const pause = el('button', { className: 'time-button', attrs: { type: 'button' } });
  const reason = el('span', {
    className: 'time-slowdown',
    attrs: { role: 'status', 'aria-label': 'Time compression change' },
  });
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
    el(
      'div',
      { className: 'time-messages' },
      el('span', {
        className: 'time-hint',
        text: `Space pause · 1–${String(Math.min(speeds.length, NUMBERED))} or + / − time compression`,
      }),
      reason,
    ),
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
      default: {
        // Number keys 1 to NUMBERED choose a time compression directly.
        const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : NUMBERED;
        const compression = index < NUMBERED ? runner.compressions[index] : undefined;
        if (compression === undefined) return;
        runner.setTimeCompression(compression);
      }
    }
    event.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  return {
    element,
    update() {
      const message = runner.slowdownEvent
        ? `Slowed to 1×: ${slowdownReason(runner.slowdownEvent, runner.battle.sides, viewer)}`
        : '';
      if (reason.textContent !== message) reason.textContent = message;
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
