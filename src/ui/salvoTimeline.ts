import type { SalvoEntry } from '../game/salvos';
import type { WarheadType } from '../sim/design';
import { el } from './el';
import { formatDuration } from './format';

const WARHEAD: Readonly<Record<WarheadType, string>> = {
  kinetic: 'kinetic',
  nuclear: 'nuclear',
  fragmentation: 'fragmentation',
};

/** One salvo's line on the timeline, e.g. "2 of 4 nuclear missiles · impact in 2 min 10 s · …". */
export const describeSalvo = (salvo: SalvoEntry): string => {
  const kind = salvo.warhead ? `${WARHEAD[salvo.warhead]} ` : '';
  const shot = salvo.shotDown > 0 ? `${salvo.shotDown} shot down` : null;
  if (salvo.state === 'defeated') {
    return [
      `Salvo of ${salvo.missiles} ${kind}missile${salvo.missiles === 1 ? '' : 's'} defeated`,
      shot,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (salvo.state === 'struck') {
    return [`Salvo of ${salvo.missiles}: ${salvo.struck} struck us`, shot]
      .filter(Boolean)
      .join(' · ');
  }
  return [
    `${salvo.inFlight} of ${salvo.missiles} ${kind}missile${salvo.missiles === 1 ? '' : 's'}`,
    salvo.impactIn === null ? 'not closing' : `impact in ${formatDuration(salvo.impactIn)}`,
    salvo.pointDefenceIn === null
      ? null
      : salvo.pointDefenceIn === 0
        ? 'within point defence'
        : `point defence in ${formatDuration(salvo.pointDefenceIn)}`,
    salvo.antiMissiles > 0
      ? `${salvo.antiMissiles} anti-missile missile${salvo.antiMissiles === 1 ? '' : 's'} on the way`
      : null,
    shot,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * The threat timeline in the sidebar: one entry for each enemy salvo aimed at the ship, counting
 * down to impact, hidden while there is none. Hovering or focusing an entry picks out its missiles
 * through `highlight`.
 */
export const createSalvoTimeline = (highlight: (ids: readonly number[]) => void) => {
  const list = el('ol', { className: 'salvo-timeline__list' });
  const element = el(
    'section',
    { className: 'salvo-timeline', attrs: { 'aria-label': 'Incoming salvos' } },
    el('h2', { text: 'Incoming salvos' }),
    list,
  );
  element.hidden = true;
  let picked: number | null = null;
  let entries: readonly SalvoEntry[] = [];
  const pick = (launched: number | null) => {
    picked = launched;
    highlight(entries.find((e) => e.launched === launched)?.ids ?? []);
  };
  return {
    element,
    update(next: readonly SalvoEntry[]) {
      entries = next;
      element.hidden = next.length === 0;
      // Keep each entry's item, so hover and focus survive the countdown.
      const items = new Map(
        [...list.children].map((item) => [Number((item as HTMLElement).dataset.launched), item]),
      );
      for (const salvo of next) {
        let item = items.get(salvo.launched) as HTMLLIElement | undefined;
        if (!item) {
          item = el('li', { className: 'salvo-timeline__entry', attrs: { tabindex: '0' } });
          item.dataset.launched = String(salvo.launched);
          const launched = salvo.launched;
          item.addEventListener('mouseenter', () => {
            pick(launched);
          });
          item.addEventListener('focus', () => {
            pick(launched);
          });
          item.addEventListener('mouseleave', () => {
            pick(null);
          });
          item.addEventListener('blur', () => {
            pick(null);
          });
          list.append(item);
        }
        items.delete(salvo.launched);
        item.className = `salvo-timeline__entry salvo-timeline__entry--${salvo.state}`;
        const text = describeSalvo(salvo);
        if (item.textContent !== text) item.textContent = text;
      }
      for (const gone of items.values()) gone.remove();
      if (picked !== null) pick(picked);
    },
  };
};
