import type {
  ContactObservation,
  MissileDesignObservation,
  MissileObservation,
  SideObservation,
  WeaponsObservation,
} from '../sim/battle';
import type { MissileRole } from '../sim/design';
import type { ManoeuvreObservation } from '../sim/manoeuvre';
import { targetsMissile } from '../sim/missile';
import type { AimPoint, FireMode, ManoeuvreGoal, Order, PointDefencePriority } from '../sim/orders';
import { DEFAULT_PRIORITIES, POWER_SYSTEMS, type PowerSystem } from '../sim/power';
import { distance, length, vec3 } from '../sim/vector';
import { COMPONENT_TEXT, SECTION_TEXT } from './damagePanel';
import { el } from './el';
import { formatDuration, formatKm, formatKmPerS, formatMetresPerS, formatMW } from './format';

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

/** Shows whether a toggle order is in effect, to sight and to assistive tech alike. */
const setPressed = (orderButton: HTMLButtonElement, pressed: boolean) => {
  orderButton.classList.toggle('active', pressed);
  orderButton.setAttribute('aria-pressed', String(pressed));
};

/** An aim point as the value of an option: "whole", "middle" or "forward/0". */
const aimValue = (aim: AimPoint | null): string =>
  aim === null ? 'whole' : aim.mount === null ? aim.section : `${aim.section}/${String(aim.mount)}`;

/** What the weapons can aim at on a contact: the whole ship, and each part the sensors make out. */
export const aimOptions = (
  contact: ContactObservation | undefined,
): readonly { readonly aim: AimPoint | null; readonly text: string }[] => [
  { aim: null, text: 'Whole ship' },
  ...(contact?.sections ?? []).flatMap((section) => [
    { aim: { section: section.kind, mount: null }, text: `${SECTION_TEXT[section.kind]} section` },
    ...(contact?.mounts ?? [])
      .filter((mount) => mount.section === section.kind)
      .map((mount) => ({
        aim: { section: mount.section, mount: mount.mount },
        text: `${SECTION_TEXT[mount.section]} mount ${String(mount.mount + 1)} · ${COMPONENT_TEXT[mount.component.type]}`,
      })),
  ]),
];

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
  const { lasers, particleBeams, kineticGuns, launchers, ammunition, target, mode } = weapons;
  const beams = [...lasers, ...particleBeams];
  const all = [...beams, ...kineticGuns];
  if (all.length + launchers.length === 0) return 'No weapons';
  if ([...all, ...launchers].every((w) => w.integrity === 0)) return 'All weapons lost';
  if (all.length === 0) return 'Missiles only · launch by order';
  if (mode === 'hold-fire') return target ? 'Holding fire · enemy targeted' : 'Holding fire';
  if (!target) return 'No target';
  const working = [
    ...beams.filter((b) => b.integrity > 0),
    ...(ammunition.slugs > 0 ? kineticGuns.filter((g) => g.integrity > 0) : []),
  ];
  if (working.length === 0) return 'Out of slugs';
  const firing = all.filter((w) => w.firing);
  if (firing.length > 0) {
    const power = beams.reduce((total, b) => total + b.beamPower, 0);
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

/** The missile designs the ship carries in a role, and how many of them are left. */
const missilesIn = (weapons: WeaponsObservation, role: MissileRole) => {
  const designs: readonly MissileDesignObservation[] = weapons.ammunition.missileDesigns.filter(
    (d) => d.role === role,
  );
  return { designs, left: designs.reduce((n, d) => n + d.missiles, 0) };
};

/**
 * What the launchers are doing with anti-ship missiles, e.g. "Launching · 2 to go · 10 missiles
 * left" or "12 missiles ready · reach 52,960 km".
 */
const describeLaunch = (weapons: WeaponsObservation): string => {
  const { launchers, salvo } = weapons;
  if (launchers.length === 0) return 'No launchers';
  if (launchers.every((l) => l.integrity === 0)) return 'Launchers lost';
  const { designs, left } = missilesIn(weapons, 'anti-ship');
  if (designs.length === 0) return 'No anti-ship missiles';
  const missiles = `${left.toLocaleString('en-GB')} missiles`;
  if (salvo && !targetsMissile(salvo.target)) {
    return `Launching · ${salvo.remaining.toLocaleString('en-GB')} to go · ${missiles} left`;
  }
  if (left === 0) return 'Out of missiles';
  const reach = Math.max(0, ...designs.map((m) => m.reach));
  return `${missiles} ready · reach ${formatKm(reach)}`;
};

/**
 * What the anti-missile missiles are doing, e.g. "Automatic · 2 in flight · 14 left" or
 * "By order only · launching at missile 7 · 16 left".
 */
const describeAntiMissile = (weapons: WeaponsObservation): string => {
  const { launchers, salvo, antiMissile } = weapons;
  const { designs, left } = missilesIn(weapons, 'anti-missile');
  if (designs.length === 0) return 'No anti-missile missiles';
  if (launchers.every((l) => l.integrity === 0)) return 'Launchers lost';
  const parts = [antiMissile.automatic ? 'Automatic' : 'By order only'];
  if (salvo && typeof salvo.target !== 'string') {
    parts.push(`launching at missile ${salvo.target.munition}`);
  }
  if (antiMissile.engagements.length > 0) parts.push(`${antiMissile.engagements.length} in flight`);
  parts.push(left === 0 ? 'none left' : `${left.toLocaleString('en-GB')} left`);
  return parts.join(' · ');
};

/**
 * The enemy missile aimed at the ship that is nearest to it and none of its anti-missile missiles
 * is after yet, if any.
 */
const nearestIncoming = (observation: SideObservation): MissileObservation | null => {
  const ship = observation.ownShip;
  const engaged = new Set(ship.weapons.antiMissile.engagements.map((e) => e.target));
  let nearest: MissileObservation | null = null;
  for (const munition of observation.munitions) {
    if (munition.kind !== 'missile' || munition.target !== ship.sideId) continue;
    if (engaged.has(munition.id)) continue;
    if (
      !nearest ||
      distance(munition.position, ship.position) < distance(nearest.position, ship.position)
    ) {
      nearest = munition;
    }
  }
  return nearest;
};

/**
 * What the point defence is doing, e.g. "Firing on 2 missiles · 3,960 rounds left",
 * "Firing on enemy ship · 3,960 rounds left" or "Ready · reach 25 km · 3 shot down".
 */
const describePointDefence = (weapons: WeaponsObservation): string => {
  const { pointDefence, ammunition, intercepts } = weapons;
  if (pointDefence.length === 0) return 'No point defence';
  if (pointDefence.every((g) => g.integrity === 0)) return 'Point defence lost';
  if (ammunition.rounds === 0) return 'Out of rounds';
  const left = `${ammunition.rounds.toLocaleString('en-GB')} rounds left`;
  const missiles = new Set(
    pointDefence.flatMap((g) => (g.engaging?.kind === 'missile' ? [g.engaging.munition] : [])),
  ).size;
  if (missiles > 0)
    return `Firing on ${missiles} ${missiles === 1 ? 'missile' : 'missiles'} · ${left}`;
  if (pointDefence.some((g) => g.engaging?.kind === 'ship'))
    return `Firing on enemy ship · ${left}`;
  const reach = Math.max(
    ...pointDefence.filter((g) => g.integrity > 0).map((g) => g.effectiveRange),
  );
  return `Ready · reach ${formatKm(reach)} · ${intercepts.toLocaleString('en-GB')} shot down`;
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

  // Withdrawal cannot be taken back, so it takes a second click to confirm.
  const withdraw = button('Withdraw');
  let withdrawArmed = false;
  const disarmWithdraw = () => {
    withdrawArmed = false;
    withdraw.textContent = 'Withdraw';
  };
  withdraw.addEventListener('click', () => {
    if (!withdrawArmed) {
      withdrawArmed = true;
      withdraw.textContent = 'Confirm withdrawal';
      return;
    }
    disarmWithdraw();
    giveOrder({ type: 'withdraw' });
  });
  withdraw.addEventListener('blur', disarmWithdraw);
  const withdrawState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Withdrawal state' },
  });
  const refusal = el('p', {
    className: 'order-state order-refusal',
    attrs: { 'aria-label': 'Order refused', role: 'status' },
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

  const raiseShields = button('Shields up');
  const lowerShields = button('Shields down');
  raiseShields.addEventListener('click', () => {
    giveOrder({ type: 'shields', raised: true });
  });
  lowerShields.addEventListener('click', () => {
    giveOrder({ type: 'shields', raised: false });
  });
  const shieldsState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Shields state' },
  });

  const targetEnemy = button('Target enemy');
  const noTarget = button('No target');
  const fireFreely = button('Fire freely');
  const holdFire = button('Hold fire');
  const weaponsState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Weapons state' },
  });
  const aimSelect = el('select', { attrs: { 'aria-label': 'Aim at' } });
  const aimField = el('label', { className: 'field' }, el('span', { text: 'Aim at' }), aimSelect);
  /** The parts on offer to aim at, by option value, as last shown. */
  let aims = new Map<string, AimPoint | null>();
  const salvoSize = numberInput('Missiles', 2, { min: '1', step: '1' });
  const launch = button('Launch');
  const callOff = button('Call off');
  const launchState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Launch state' },
  });
  const automaticDefence = button('Automatic');
  const byOrderOnly = button('By order only');
  const launchAtNearest = button('Launch at nearest missile');
  const antiMissileState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Anti-missile state' },
  });
  automaticDefence.addEventListener('click', () => {
    giveOrder({ type: 'anti-missile', automatic: true });
  });
  byOrderOnly.addEventListener('click', () => {
    giveOrder({ type: 'anti-missile', automatic: false });
  });
  // The incoming missile the button launches at, as of the latest update.
  let nearest: number | null = null;
  launchAtNearest.addEventListener('click', () => {
    if (nearest === null) return;
    giveOrder({ type: 'launch', target: { munition: nearest }, missiles: 1 });
  });
  const pointDefenceButtons = {
    missiles: button('Missiles only'),
    'missiles-then-ship': button('Missiles, then ship'),
  } satisfies Record<PointDefencePriority, HTMLButtonElement>;
  for (const [priority, priorityButton] of Object.entries(pointDefenceButtons)) {
    priorityButton.addEventListener('click', () => {
      giveOrder({ type: 'point-defence', priority: priority as PointDefencePriority });
    });
  }
  const pointDefenceState = el('p', {
    className: 'order-state',
    attrs: { 'aria-label': 'Point defence state' },
  });
  // The latest weapons order and contact, so each button changes only its own part.
  let weapons: { target: string | null; mode: FireMode; aim: AimPoint | null } = {
    target: null,
    mode: 'hold-fire',
    aim: null,
  };
  let enemy: string | null = null;
  /** A weapons order, keeping the aim ordered while the sensors still make that part out. */
  const giveWeapons = (target: string | null, mode: FireMode, aim = weapons.aim) => {
    const kept = target !== null && aim !== null && aims.has(aimValue(aim)) ? { aim } : {};
    giveOrder({ type: 'weapons', target, mode, ...kept });
  };
  targetEnemy.addEventListener('click', () => {
    giveWeapons(enemy, weapons.mode);
  });
  noTarget.addEventListener('click', () => {
    giveWeapons(null, weapons.mode);
  });
  fireFreely.addEventListener('click', () => {
    giveWeapons(weapons.target ?? enemy, 'fire-freely');
  });
  holdFire.addEventListener('click', () => {
    giveWeapons(weapons.target, 'hold-fire');
  });
  aimSelect.addEventListener('change', () => {
    giveWeapons(weapons.target ?? enemy, weapons.mode, aims.get(aimSelect.value) ?? null);
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
    el('h3', { text: 'Withdrawal' }),
    el('div', { className: 'order-row' }, withdraw),
    withdrawState,
    refusal,
    el('h3', { text: 'Power' }),
    priorityList,
    el('h3', { text: 'Radiators' }),
    el('div', { className: 'order-row' }, deployRadiators, retractRadiators),
    el('h3', { text: 'Shields' }),
    el('div', { className: 'order-row' }, raiseShields, lowerShields),
    shieldsState,
    el('h3', { text: 'Weapons' }),
    el('div', { className: 'order-row' }, targetEnemy, noTarget),
    el('div', { className: 'order-row' }, fireFreely, holdFire),
    el('div', { className: 'order-row' }, aimField),
    weaponsState,
    el('div', { className: 'order-row' }, salvoSize.element, launch, callOff),
    launchState,
    el('h3', { text: 'Anti-missile missiles' }),
    el('div', { className: 'order-row' }, automaticDefence, byOrderOnly, launchAtNearest),
    antiMissileState,
    el('h3', { text: 'Point defence' }),
    el(
      'div',
      { className: 'order-row' },
      pointDefenceButtons.missiles,
      pointDefenceButtons['missiles-then-ship'],
    ),
    pointDefenceState,
  );

  return {
    element,
    /** Shows why the battle refused the latest order. */
    refused(reason: string) {
      refusal.textContent = reason;
    },
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
      setPressed(pointAtEnemy, attitude?.mode === 'enemy');
      setPressed(pointAway, attitude?.mode === 'away');
      setPressed(pointCustom, attitude?.mode === 'direction');
      burnState.textContent = ship.burn
        ? `Burning at ${Math.round(ship.burn.throttle * 100)}% · ${Math.ceil(ship.burn.remaining)} s left`
        : manoeuvre
          ? 'Set by the manoeuvre'
          : 'Drive off';
      for (const [goal, goalButton] of Object.entries(goalButtons)) {
        setPressed(goalButton, manoeuvre?.goal === goal);
      }
      setPressed(manual, !manoeuvre);
      manoeuvreState.textContent = manoeuvre ? describeGoal(manoeuvre) : 'Manual control';
      planState.textContent = manoeuvre
        ? `${describePlan(manoeuvre)}${ship.reserveWarning ? ' · Δv near reserve' : ''}`
        : '';
      // Pressed once the withdrawal is ordered, not while a first click waits for confirmation;
      // it cannot be taken back, so the button is then disabled.
      withdraw.disabled = ship.withdrawing;
      setPressed(withdraw, ship.withdrawing);
      const enemyWithdrawing = observation.contacts.some((c) => c.withdrawing);
      withdrawState.textContent = ship.withdrawing
        ? 'Withdrawing: burning away from the enemy'
        : enemyWithdrawing
          ? 'Enemy withdrawing: fire on it, but no pursuit'
          : ship.reserveWarning
            ? `Δv near the ${formatKmPerS(ship.reserve)} reserve`
            : `Reserve ${formatKmPerS(ship.reserve)}`;

      priorities = ship.power.priorities;
      labelPriorityRows();
      priorities.forEach((system, rank) => {
        const { demand, supplied } = ship.power.systems[system];
        const row = priorityRows[rank];
        if (row) row.share.textContent = `${formatMW(supplied)} of ${formatMW(demand)}`;
      });
      setPressed(deployRadiators, ship.heat.radiatorsDeployed);
      setPressed(retractRadiators, !ship.heat.radiatorsDeployed);
      const shielded = ship.shields.shields.length > 0;
      raiseShields.disabled = !shielded;
      lowerShields.disabled = !shielded;
      shieldsState.hidden = !shielded;
      shieldsState.textContent = shielded
        ? ship.shields.raised
          ? 'Shields raised'
          : 'Shields lowered'
        : '';
      setPressed(raiseShields, shielded && ship.shields.raised);
      setPressed(lowerShields, shielded && !ship.shields.raised);

      weapons = { target: ship.weapons.target, mode: ship.weapons.mode, aim: ship.weapons.aim };
      enemy = observation.contacts[0]?.sideId ?? null;
      // Offer the parts the sensors make out, rebuilding the list only when it changes.
      const offered = aimOptions(observation.contacts[0]);
      const values = offered.map(({ aim }) => aimValue(aim));
      if (values.join() !== [...aims.keys()].join()) {
        aims = new Map(offered.map(({ aim }) => [aimValue(aim), aim]));
        aimSelect.replaceChildren(
          ...offered.map(({ aim, text }) =>
            el('option', { text, attrs: { value: aimValue(aim) } }),
          ),
        );
      }
      // An aim not made out any more shows as the whole ship, which the weapons fall back on.
      const shown = aimValue(weapons.aim);
      aimSelect.value = aims.has(shown) ? shown : 'whole';
      setPressed(targetEnemy, weapons.target !== null);
      setPressed(noTarget, weapons.target === null);
      setPressed(fireFreely, weapons.mode === 'fire-freely');
      setPressed(holdFire, weapons.mode === 'hold-fire');
      weaponsState.textContent = describeWeapons(ship.weapons);
      const canLaunch = ship.weapons.launchers.some((l) => l.integrity > 0);
      const { salvo } = ship.weapons;
      launch.disabled = !canLaunch || missilesIn(ship.weapons, 'anti-ship').left === 0;
      callOff.disabled = salvo === null;
      // Launch buttons are actions, not toggles: they only light up while their salvo flies.
      launch.classList.toggle('active', salvo !== null && !targetsMissile(salvo.target));
      launchState.textContent = describeLaunch(ship.weapons);
      const antiMissiles = missilesIn(ship.weapons, 'anti-missile');
      const defending = antiMissiles.designs.length > 0;
      automaticDefence.disabled = !defending;
      byOrderOnly.disabled = !defending;
      setPressed(automaticDefence, defending && ship.weapons.antiMissile.automatic);
      setPressed(byOrderOnly, defending && !ship.weapons.antiMissile.automatic);
      nearest = nearestIncoming(observation)?.id ?? null;
      launchAtNearest.disabled = !canLaunch || antiMissiles.left === 0 || nearest === null;
      launchAtNearest.classList.toggle(
        'active',
        salvo !== null && typeof salvo.target !== 'string',
      );
      antiMissileState.textContent = describeAntiMissile(ship.weapons);
      const defended = ship.weapons.pointDefence.length > 0;
      for (const [priority, priorityButton] of Object.entries(pointDefenceButtons)) {
        priorityButton.disabled = !defended;
        setPressed(priorityButton, defended && ship.weapons.pointDefencePriority === priority);
      }
      pointDefenceState.textContent = describePointDefence(ship.weapons);
    },
  };
};
