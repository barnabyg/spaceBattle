import { ADVANCE_DURATION, type AdvanceCondition } from '../game/advance';
import type { BattleRunner } from '../game/battleRunner';
import type { BattleEvent, SideId, SideSetup } from '../sim/battle';
import { involves } from '../sim/events';
import { COMPONENT_TEXT, SECTION_TEXT } from './damagePanel';
import { el } from './el';
import { formatBattleTime, formatKm } from './format';

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
    case 'launch':
      return typeof event.target === 'string'
        ? `missiles launched at ${name(event.target)}`
        : 'anti-missile missiles launched';
    case 'battle-ended':
      return 'Battle ended';
    default:
      return '';
  }
};

/** The conditions an advance can run until, as the captain chooses them. */
const ADVANCE_CHOICES = [
  ['own-reach', 'Enemy in our reach'],
  ['enemy-reach', 'Us in known enemy reach'],
  ['separation', 'Separation (km)'],
  ['launch', 'Next missile launch'],
  ['duration', '10 minutes'],
] as const;
type AdvanceChoice = (typeof ADVANCE_CHOICES)[number][0];

/** What the time controls say once an advance has reached its condition and paused. */
const reachedText = (condition: AdvanceCondition): string => {
  switch (condition.type) {
    case 'own-reach':
      return 'Paused: the enemy is within our reach';
    case 'enemy-reach':
      return 'Paused: we are within known enemy reach';
    case 'separation':
      return `Paused at ${formatKm(condition.distance)} separation`;
    case 'launch':
      return 'Paused: missile launched';
    case 'duration':
      return 'Paused after 10 minutes';
  }
};

/** What the time controls say while an advance runs. */
const advancingText = (condition: AdvanceCondition): string => {
  switch (condition.type) {
    case 'own-reach':
      return 'Advancing until the enemy is within our reach…';
    case 'enemy-reach':
      return 'Advancing until we are within known enemy reach…';
    case 'separation':
      return `Advancing to ${formatKm(condition.distance)} separation…`;
    case 'launch':
      return 'Advancing until a missile is launched…';
    case 'duration':
      return 'Advancing 10 minutes…';
  }
};

/**
 * "Advance until": a condition to run the battle until at the highest time compression, a
 * separation in km for that condition, and the button that starts it, for the viewing side.
 */
const createAdvanceControl = (runner: BattleRunner, viewer: SideId) => {
  const choice = el(
    'select',
    { className: 'advance-choice', attrs: { 'aria-label': 'Advance until' } },
    ...ADVANCE_CHOICES.map(([value, text]) => el('option', { text, attrs: { value } })),
  );
  const km = el('input', {
    className: 'advance-km',
    attrs: {
      type: 'number',
      min: '1',
      step: '1000',
      value: '100000',
      inputmode: 'numeric',
      'aria-label': 'Advance until separation km',
    },
  });
  const go = el('button', {
    className: 'time-button advance-go',
    text: 'Advance',
    attrs: { type: 'button', title: 'Run at the highest speed until this happens, then pause' },
  });
  const status = el('span', {
    className: 'advance-status',
    attrs: { role: 'status', 'aria-label': 'Advance' },
  });
  let refusal = '';
  const showKm = () => {
    km.hidden = choice.value !== 'separation';
  };
  const condition = (): AdvanceCondition | string => {
    switch (choice.value as AdvanceChoice) {
      case 'own-reach':
        return { type: 'own-reach' };
      case 'enemy-reach':
        return { type: 'enemy-reach' };
      case 'separation': {
        const value = km.value.trim() === '' ? NaN : Number(km.value);
        return value > 0 && Number.isFinite(value)
          ? { type: 'separation', distance: value * 1_000 }
          : 'Enter a separation above 0 km';
      }
      case 'launch':
        return { type: 'launch' };
      case 'duration':
        return { type: 'duration', seconds: ADVANCE_DURATION };
    }
  };
  const start = () => {
    const chosen = condition();
    refusal = typeof chosen === 'string' ? chosen : (runner.advanceUntil(viewer, chosen) ?? '');
  };
  choice.addEventListener('change', () => {
    refusal = '';
    showKm();
  });
  km.addEventListener('input', () => {
    refusal = '';
  });
  km.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') start();
  });
  go.addEventListener('click', start);
  showKm();

  return {
    element: el(
      'div',
      { className: 'advance', attrs: { role: 'group', 'aria-label': 'Advance until' } },
      choice,
      km,
      go,
    ),
    status,
    update() {
      const message = refusal
        ? `Cannot advance: ${refusal}`
        : runner.advancing
          ? advancingText(runner.advancing)
          : runner.advanceReached
            ? reachedText(runner.advanceReached)
            : '';
      if (status.textContent !== message) status.textContent = message;
      go.setAttribute('aria-pressed', String(runner.advancing !== null));
    },
  };
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
  const advance = createAdvanceControl(runner, viewer);
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
    advance.element,
    el(
      'div',
      { className: 'time-messages' },
      el('span', {
        className: 'time-hint',
        text: `Space pause · 1–${String(Math.min(speeds.length, NUMBERED))} or + / − time compression`,
      }),
      reason,
      advance.status,
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
      advance.update();
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
