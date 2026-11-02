import type { OwnShipObservation } from '../sim/battle';
import type { ManoeuvreObservation } from '../sim/manoeuvre';
import type { ManoeuvreGoal, Order } from '../sim/orders';
import { DEFAULT_PRIORITIES, POWER_SYSTEMS, type PowerSystem } from '../sim/power';
import { length, vec3 } from '../sim/vector';
import { el } from './el';
import { formatDuration, formatKm, formatMetresPerS, formatMW } from './format';

const DEGREES = Math.PI / 180;

const numberInput = (label: string, value: number, attrs: Record<string, string>) => {
  const input = el('input', { attrs: { type: 'number', value: String(value), ...attrs } });
  return {
    input,
    element: el('label', { className: 'field' }, el('span', { text: label }), input),
  };
};

const button = (text: string) =>
  el('button', { className: 'order-button', text, attrs: { type: 'button' } });

const GOAL_TEXT: Readonly<Record<ManoeuvreGoal, string>> = {
  close: 'Closing to',
  hold: 'Holding',
  open: 'Opening to',
  'match-velocity': 'Matching velocity',
};

const SYSTEM_TEXT: Readonly<Record<PowerSystem, string>> = {
  drive: 'Drive',
  shields: 'Shields',
  weapons: 'Weapons',
  capacitors: 'Capacitor charging',
};

/** The active goal and how far off it the ship is, e.g. "Holding 100,000 km · error 1,200 km". */
const describeGoal = (m: ManoeuvreObservation): string => {
  const goal = m.range === null ? GOAL_TEXT[m.goal] : `${GOAL_TEXT[m.goal]} ${formatKm(m.range)}`;
  const error =
    m.rangeError === null
      ? `${formatMetresPerS(length(m.velocityError))} off`
      : `error ${formatKm(m.rangeError)}`;
  return `${goal} · ${error}`;
};

/** What the autopilot is doing now, and its next planned burn. */
const describePlan = (m: ManoeuvreObservation): string => {
  const next = m.plannedBurns[0];
  if (m.phase === 'burning') return `Burning · about ${formatDuration(next?.duration ?? 0)}`;
  if (m.phase === 'turning') return 'Turning to burn';
  if (!next) return 'Coasting · no burn planned';
  return `Coasting · next burn in ${formatDuration(next.start)} for ${formatDuration(next.duration)}`;
};

/** The captain's orders to their own ship. Orders can be given while running or paused. */
export const createOrdersPanel = (giveOrder: (order: Order) => void) => {
  const pointAtEnemy = button('Point at enemy');
  const pointAway = button('Point away');
  const azimuth = numberInput('Azimuth °', 0, { min: '-180', max: '180', step: '1' });
  const elevation = numberInput('Elevation °', 0, { min: '-90', max: '90', step: '1' });
  const pointCustom = button('Point along');
  const attitudeState = el('p', { className: 'order-state' });

  const throttle = numberInput('Throttle %', 100, { min: '0', max: '100', step: '1' });
  const duration = numberInput('Duration s', 60, { min: '0', step: '1' });
  const startBurn = button('Burn');
  const cutDrive = button('Cut drive');
  const burnState = el('p', { className: 'order-state' });

  const range = numberInput('Range km', 100_000, { min: '1', step: '1000' });
  const goalButtons = {
    close: button('Close'),
    hold: button('Hold'),
    open: button('Open'),
    'match-velocity': button('Match velocity'),
  } satisfies Record<ManoeuvreGoal, HTMLButtonElement>;
  const manual = button('Manual');
  const manoeuvreState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Manoeuvre state' },
  });
  const planState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Manoeuvre plan' },
  });

  // One row per rank; each update shows the system now at that rank.
  let priorities: readonly PowerSystem[] = DEFAULT_PRIORITIES;
  const swapRanks = (rank: number, other: number) => {
    const a = priorities[rank];
    const b = priorities[other];
    if (!a || !b) return;
    const next = [...priorities];
    next[rank] = b;
    next[other] = a;
    giveOrder({ type: 'power', priorities: next });
  };
  const priorityRows = POWER_SYSTEMS.map((_, rank) => {
    const name = el('span', { className: 'priority-name' });
    const share = el('span', { className: 'priority-share' });
    const raise = el('button', {
      className: 'order-button priority-button',
      text: '▲',
      attrs: { type: 'button' },
    });
    const lower = el('button', {
      className: 'order-button priority-button',
      text: '▼',
      attrs: { type: 'button' },
    });
    raise.addEventListener('click', () => {
      swapRanks(rank, rank - 1);
    });
    lower.addEventListener('click', () => {
      swapRanks(rank, rank + 1);
    });
    raise.disabled = rank === 0;
    lower.disabled = rank === POWER_SYSTEMS.length - 1;
    return {
      name,
      share,
      raise,
      lower,
      element: el(
        'li',
        {},
        el('span', { className: 'priority-rank', text: `${rank + 1}.` }),
        name,
        share,
        raise,
        lower,
      ),
    };
  });
  const priorityList = el(
    'ol',
    { className: 'priority-list', attrs: { 'aria-label': 'Power priorities' } },
    ...priorityRows.map((row) => row.element),
  );

  const deployRadiators = button('Deploy radiators');
  const retractRadiators = button('Retract radiators');

  deployRadiators.addEventListener('click', () => {
    giveOrder({ type: 'radiators', deployed: true });
  });
  retractRadiators.addEventListener('click', () => {
    giveOrder({ type: 'radiators', deployed: false });
  });
  pointAtEnemy.addEventListener('click', () => {
    giveOrder({ type: 'attitude', mode: 'enemy' });
  });
  pointAway.addEventListener('click', () => {
    giveOrder({ type: 'attitude', mode: 'away' });
  });
  pointCustom.addEventListener('click', () => {
    const az = azimuth.input.valueAsNumber * DEGREES;
    const up = elevation.input.valueAsNumber * DEGREES;
    if (!Number.isFinite(az) || !Number.isFinite(up)) return;
    giveOrder({
      type: 'attitude',
      mode: 'direction',
      direction: vec3(Math.cos(up) * Math.cos(az), Math.cos(up) * Math.sin(az), Math.sin(up)),
    });
  });
  startBurn.addEventListener('click', () => {
    const t = throttle.input.valueAsNumber / 100;
    const d = duration.input.valueAsNumber;
    if (!(t >= 0 && t <= 1 && d >= 0)) return;
    giveOrder({ type: 'burn', throttle: t, duration: d });
  });
  cutDrive.addEventListener('click', () => {
    giveOrder({ type: 'burn', throttle: 0, duration: 0 });
  });
  for (const goal of ['close', 'hold', 'open'] as const) {
    goalButtons[goal].addEventListener('click', () => {
      const km = range.input.valueAsNumber;
      if (!(km > 0)) return;
      giveOrder({ type: 'manoeuvre', goal, range: km * 1000 });
    });
  }
  goalButtons['match-velocity'].addEventListener('click', () => {
    giveOrder({ type: 'manoeuvre', goal: 'match-velocity' });
  });
  manual.addEventListener('click', () => {
    giveOrder({ type: 'manoeuvre', goal: 'none' });
  });

  const element = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': 'Orders' } },
    el('h2', { text: 'Orders' }),
    el('h3', { text: 'Attitude' }),
    el('div', { className: 'order-row' }, pointAtEnemy, pointAway),
    el('div', { className: 'order-row' }, azimuth.element, elevation.element, pointCustom),
    attitudeState,
    el('h3', { text: 'Burn' }),
    el('div', { className: 'order-row' }, throttle.element, duration.element),
    el('div', { className: 'order-row' }, startBurn, cutDrive),
    burnState,
    el('h3', { text: 'Manoeuvre' }),
    el('div', { className: 'order-row' }, range.element),
    el(
      'div',
      { className: 'order-row' },
      goalButtons.close,
      goalButtons.hold,
      goalButtons.open,
      goalButtons['match-velocity'],
      manual,
    ),
    manoeuvreState,
    planState,
    el('h3', { text: 'Power' }),
    priorityList,
    el('h3', { text: 'Radiators' }),
    el('div', { className: 'order-row' }, deployRadiators, retractRadiators),
  );

  return {
    element,
    update(ship: OwnShipObservation) {
      const { attitude, manoeuvre } = ship;
      attitudeState.textContent = manoeuvre
        ? 'Set by the manoeuvre'
        : !attitude
          ? 'Holding attitude'
          : attitude.mode === 'enemy'
            ? 'Pointing at enemy'
            : attitude.mode === 'away'
              ? 'Pointing away from enemy'
              : 'Pointing along set direction';
      pointAtEnemy.classList.toggle('active', attitude?.mode === 'enemy');
      pointAway.classList.toggle('active', attitude?.mode === 'away');
      pointCustom.classList.toggle('active', attitude?.mode === 'direction');
      burnState.textContent = ship.burn
        ? `Burning at ${Math.round(ship.burn.throttle * 100)}% · ${Math.ceil(ship.burn.remaining)} s left`
        : manoeuvre
          ? 'Set by the manoeuvre'
          : 'Drive off';
      for (const [goal, goalButton] of Object.entries(goalButtons)) {
        goalButton.classList.toggle('active', manoeuvre?.goal === goal);
      }
      manual.classList.toggle('active', !manoeuvre);
      manoeuvreState.textContent = manoeuvre ? describeGoal(manoeuvre) : 'Manual control';
      planState.textContent = manoeuvre ? describePlan(manoeuvre) : '';

      priorities = ship.power.priorities;
      priorities.forEach((system, rank) => {
        const row = priorityRows[rank];
        if (!row) return;
        const { demand, supplied } = ship.power.systems[system];
        row.name.textContent = SYSTEM_TEXT[system];
        row.share.textContent = `${formatMW(supplied)} of ${formatMW(demand)}`;
        row.raise.setAttribute('aria-label', `Raise ${SYSTEM_TEXT[system]}`);
        row.lower.setAttribute('aria-label', `Lower ${SYSTEM_TEXT[system]}`);
      });
      deployRadiators.classList.toggle('active', ship.heat.radiatorsDeployed);
      retractRadiators.classList.toggle('active', !ship.heat.radiatorsDeployed);
    },
  };
};
