import type { SideObservation, WeaponsObservation } from '../sim/battle';
import type { ManoeuvreObservation } from '../sim/manoeuvre';
import type { FireMode, ManoeuvreGoal, Order } from '../sim/orders';
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

/**
 * What the weapons are doing, e.g. "Firing 1 of 1 · 500 MW", "Firing 2 of 2 · 412 slugs left" or
 * "Out of range · reach 165,000 km".
 */
const describeWeapons = (weapons: WeaponsObservation): string => {
  const { lasers, kineticGuns, launchers, ammunition, target, mode } = weapons;
  const all = [...lasers, ...kineticGuns];
  if (all.length + launchers.length === 0) return 'No weapons';
  if ([...all, ...launchers].every((w) => w.integrity === 0)) return 'All weapons lost';
  if (all.length === 0) return 'Missiles only · launch by order';
  if (mode === 'hold-fire') return target ? 'Holding fire · enemy targeted' : 'Holding fire';
  if (!target) return 'No target';
  const working = [
    ...lasers.filter((l) => l.integrity > 0),
    ...(ammunition.slugs > 0 ? kineticGuns.filter((g) => g.integrity > 0) : []),
  ];
  if (working.length === 0) return 'Out of slugs';
  const firing = all.filter((w) => w.firing);
  if (firing.length > 0) {
    const power = lasers.reduce((total, l) => total + l.beamPower, 0);
    const parts = [`Firing ${firing.length} of ${all.length}`];
    if (power > 0) parts.push(formatMW(power));
    if (kineticGuns.some((g) => g.firing)) {
      parts.push(`${ammunition.slugs.toLocaleString('en-GB')} slugs left`);
    }
    return parts.join(' · ');
  }
  const reach = Math.max(...working.map((w) => w.effectiveRange));
  return `Out of range · reach ${formatKm(reach)}`;
};

/**
 * What the launchers are doing, e.g. "Launching · 2 to go · 10 missiles left" or
 * "12 missiles ready · reach 52,960 km".
 */
const describeLaunch = (weapons: WeaponsObservation): string => {
  const { launchers, ammunition, salvo } = weapons;
  if (launchers.length === 0) return 'No launchers';
  if (launchers.every((l) => l.integrity === 0)) return 'Launchers lost';
  const left = `${ammunition.missiles.toLocaleString('en-GB')} missiles`;
  if (salvo) return `Launching · ${salvo.remaining.toLocaleString('en-GB')} to go · ${left} left`;
  if (ammunition.missiles === 0) return 'Out of missiles';
  const reach = Math.max(0, ...ammunition.missileDesigns.map((m) => m.reach));
  return `${left} ready · reach ${formatKm(reach)}`;
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
    // Relabel at once, so a second click before the next frame acts on the new order.
    priorities = next;
    labelPriorityRows();
  };
  const labelPriorityRows = () => {
    priorities.forEach((system, rank) => {
      const row = priorityRows[rank];
      if (!row) return;
      row.name.textContent = SYSTEM_TEXT[system];
      row.raise.setAttribute('aria-label', `Raise ${SYSTEM_TEXT[system]}`);
      row.lower.setAttribute('aria-label', `Lower ${SYSTEM_TEXT[system]}`);
    });
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

  const targetEnemy = button('Target enemy');
  const noTarget = button('No target');
  const fireFreely = button('Fire freely');
  const holdFire = button('Hold fire');
  const weaponsState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Weapons state' },
  });
  const salvoSize = numberInput('Missiles', 2, { min: '1', step: '1' });
  const launch = button('Launch');
  const callOff = button('Call off');
  const launchState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Launch state' },
  });
  // The latest weapons order and contact, so each button changes only its own part.
  let weapons: { target: string | null; mode: FireMode } = { target: null, mode: 'hold-fire' };
  let enemy: string | null = null;
  targetEnemy.addEventListener('click', () => {
    giveOrder({ type: 'weapons', target: enemy, mode: weapons.mode });
  });
  noTarget.addEventListener('click', () => {
    giveOrder({ type: 'weapons', target: null, mode: weapons.mode });
  });
  fireFreely.addEventListener('click', () => {
    giveOrder({ type: 'weapons', target: weapons.target ?? enemy, mode: 'fire-freely' });
  });
  holdFire.addEventListener('click', () => {
    giveOrder({ type: 'weapons', target: weapons.target, mode: 'hold-fire' });
  });
  launch.addEventListener('click', () => {
    const missiles = salvoSize.input.valueAsNumber;
    if (!enemy || !(Number.isInteger(missiles) && missiles > 0)) return;
    giveOrder({ type: 'launch', target: enemy, missiles });
  });
  callOff.addEventListener('click', () => {
    if (!enemy) return;
    giveOrder({ type: 'launch', target: enemy, missiles: 0 });
  });

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
    el('h3', { text: 'Weapons' }),
    el('div', { className: 'order-row' }, targetEnemy, noTarget),
    el('div', { className: 'order-row' }, fireFreely, holdFire),
    weaponsState,
    el('div', { className: 'order-row' }, salvoSize.element, launch, callOff),
    launchState,
  );

  return {
    element,
    update(observation: SideObservation) {
      const ship = observation.ownShip;
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
      labelPriorityRows();
      priorities.forEach((system, rank) => {
        const { demand, supplied } = ship.power.systems[system];
        const row = priorityRows[rank];
        if (row) row.share.textContent = `${formatMW(supplied)} of ${formatMW(demand)}`;
      });
      deployRadiators.classList.toggle('active', ship.heat.radiatorsDeployed);
      retractRadiators.classList.toggle('active', !ship.heat.radiatorsDeployed);

      weapons = { target: ship.weapons.target, mode: ship.weapons.mode };
      enemy = observation.contacts[0]?.sideId ?? null;
      targetEnemy.classList.toggle('active', weapons.target !== null);
      noTarget.classList.toggle('active', weapons.target === null);
      fireFreely.classList.toggle('active', weapons.mode === 'fire-freely');
      holdFire.classList.toggle('active', weapons.mode === 'hold-fire');
      weaponsState.textContent = describeWeapons(ship.weapons);
      const canLaunch = ship.weapons.launchers.some((l) => l.integrity > 0);
      launch.disabled = !canLaunch || ship.weapons.ammunition.missiles === 0;
      callOff.disabled = ship.weapons.salvo === null;
      launch.classList.toggle('active', ship.weapons.salvo !== null);
      launchState.textContent = describeLaunch(ship.weapons);
    },
  };
};
