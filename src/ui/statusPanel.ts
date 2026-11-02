import type { SideObservation } from '../sim/battle';
import { OVERHEAT_TEMPERATURE } from '../sim/heat';
import { POWER_SYSTEMS } from '../sim/power';
import { distance, length } from '../sim/vector';
import { el } from './el';
import { formatGJ, formatKelvin, formatKm, formatKmPerS, formatMW, formatPercent } from './format';

const formatTonnes = (kg: number) =>
  `${(kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} t`;
const formatMN = (newtons: number) =>
  `${(newtons / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 2 })} MN`;

/** Each readout: its label and how to show it from the captain's observation. */
const READOUTS: readonly (readonly [string, (o: SideObservation) => string])[] = [
  [
    'Separation',
    (o) => (o.contacts[0] ? formatKm(distance(o.ownShip.position, o.contacts[0].position)) : '—'),
  ],
  ['Own speed', (o) => formatKmPerS(length(o.ownShip.velocity))],
  ['Contact speed', (o) => (o.contacts[0] ? formatKmPerS(length(o.contacts[0].velocity)) : '—')],
  ['Delta-v', (o) => formatKmPerS(o.ownShip.deltaV)],
  ['Propellant', (o) => formatTonnes(o.ownShip.propellantMass)],
  ['Mass', (o) => formatTonnes(o.ownShip.mass)],
  ['Drive thrust', (o) => formatMN(o.ownShip.thrust)],
  ['Drive limit', (o) => formatPercent(o.ownShip.power.driveLimit)],
  [
    'Power generated',
    ({ ownShip: { power } }) =>
      `${formatMW(power.reactorOutput)} of ${formatMW(power.reactorCapacity)}`,
  ],
  [
    'Power demand',
    ({ ownShip: { power } }) =>
      formatMW(POWER_SYSTEMS.reduce((total, s) => total + power.systems[s].demand, 0)),
  ],
  [
    'Stored energy',
    ({ ownShip: { power } }) => `${formatGJ(power.stored)} of ${formatGJ(power.storageCapacity)}`,
  ],
  [
    'Temperature',
    ({ ownShip: { heat } }) =>
      heat.temperature > OVERHEAT_TEMPERATURE
        ? `${formatKelvin(heat.temperature)} · overheating`
        : formatKelvin(heat.temperature),
  ],
  ['Heat', (o) => formatGJ(o.ownShip.heat.heat)],
  ['Heat generated', (o) => formatMW(o.ownShip.heat.generated)],
  ['Heat radiated', (o) => formatMW(o.ownShip.heat.radiated)],
  [
    'Radiators',
    ({ ownShip: { heat } }) =>
      `${heat.radiatorsDeployed ? 'Deployed' : 'Retracted'} · ${Math.round(heat.radiatorArea).toLocaleString('en-GB')} m²`,
  ],
];

/** Numbers about the captain's ship and its contact, in real units. */
export const createStatusPanel = () => {
  const values = READOUTS.map(([label]) => el('dd', { attrs: { 'aria-label': label } }));
  const list = el(
    'dl',
    { className: 'status-list' },
    ...READOUTS.flatMap(([label], i) => [el('dt', { text: label }), values[i] ?? el('dd')]),
  );
  const element = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': 'Ship status' } },
    el('h2', { text: 'Status' }),
    list,
  );

  return {
    element,
    update(observation: SideObservation) {
      READOUTS.forEach(([, show], i) => {
        const value = values[i];
        if (value) value.textContent = show(observation);
      });
    },
  };
};
