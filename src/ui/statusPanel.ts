import type { SideObservation } from '../sim/battle';
import { distance, length } from '../sim/vector';
import { el } from './el';
import { formatKm, formatKmPerS } from './format';

const row = (label: string) => {
  const value = el('dd');
  return { value, nodes: [el('dt', { text: label }), value] };
};

/** Numbers about the captain's ship and its contact, in real units. */
export const createStatusPanel = () => {
  const separation = row('Separation');
  const ownSpeed = row('Own speed');
  const contactSpeed = row('Contact speed');
  const list = el(
    'dl',
    { className: 'status-list' },
    ...separation.nodes,
    ...ownSpeed.nodes,
    ...contactSpeed.nodes,
  );
  separation.value.setAttribute('aria-label', 'Separation');
  const element = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': 'Ship status' } },
    el('h2', { text: 'Status' }),
    list,
  );

  return {
    element,
    update(observation: SideObservation) {
      const contact = observation.contacts[0];
      separation.value.textContent = contact
        ? formatKm(distance(observation.ownShip.position, contact.position))
        : '—';
      ownSpeed.value.textContent = formatKmPerS(length(observation.ownShip.velocity));
      contactSpeed.value.textContent = contact ? formatKmPerS(length(contact.velocity)) : '—';
    },
  };
};
