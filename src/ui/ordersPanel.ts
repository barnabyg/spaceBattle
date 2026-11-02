import type { OwnShipObservation } from '../sim/battle';
import type { Order } from '../sim/orders';
import { vec3 } from '../sim/vector';
import { el } from './el';

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
  );

  return {
    element,
    update(ship: OwnShipObservation) {
      const attitude = ship.attitude;
      attitudeState.textContent = !attitude
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
        : 'Drive off';
    },
  };
};
