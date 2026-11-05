import type { BattleEvent, SideObservation } from '../sim/battle';
import { SECTION_KINDS, type SectionKind } from '../sim/design';
import { SECTION_TEXT } from './damagePanel';
import { el } from './el';

/** A readable pulse in wall-clock seconds, even when a whole shot falls between frames. */
const HIT_DURATION = 1.5;

/** Own-ship hit locations, independent of telescope detail and time compression. */
export const createHitIndicator = () => {
  const sections = SECTION_KINDS.map((kind) => {
    const state = el('span', { className: 'hit-indicator__state', text: '—' });
    const element = el(
      'div',
      {
        className: `hit-indicator__section hit-indicator__section--${kind}`,
        attrs: { 'data-section': kind },
      },
      el('span', { text: SECTION_TEXT[kind] }),
      state,
    );
    return { kind, element, state, until: -Infinity };
  });
  const element = el(
    'section',
    { className: 'hit-indicator', attrs: { 'aria-label': 'Own ship hit indicator' } },
    el('h2', { text: 'Incoming hits' }),
    el('div', { className: 'hit-indicator__ship' }, ...sections.map((s) => s.element)),
  );

  return {
    element,
    update(observation: SideObservation, events: readonly BattleEvent[], realTime: number) {
      const side = observation.ownShip.sideId;
      const hit = new Set<SectionKind>();
      for (const event of events) {
        if ((event.type === 'hit' || event.type === 'impact') && event.target === side)
          hit.add(event.section);
        if (event.type === 'detonation')
          for (const exposure of event.exposures)
            if (exposure.side === side && exposure.energy > 0) hit.add(exposure.section);
      }
      for (const section of sections) {
        if (hit.has(section.kind)) section.until = realTime + HIT_DURATION;
        const active = realTime < section.until;
        section.element.classList.toggle('is-hit', active);
        section.state.textContent = active ? 'Hit' : '—';
        section.element.setAttribute(
          'aria-label',
          `${SECTION_TEXT[section.kind]}: ${active ? 'hit' : 'no recent hit'}`,
        );
      }
    },
  };
};
