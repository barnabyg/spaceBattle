import type { BattleEvent, SideSetup } from '../sim/battle';
import {
  BEAM_TEXT,
  COMPONENT_TEXT,
  describeShielding,
  IMPACT_TEXT,
  SECTION_TEXT,
} from './damagePanel';
import { el } from './el';
import {
  formatBattleTime,
  formatGJ,
  formatKilotons,
  formatKm,
  formatKmPerS,
  formatMW,
} from './format';
import { outcomeDetails, outcomeHeadline } from './resultScreen';

/** How many events the test log keeps on screen, newest first. */
const TEST_LOG_LENGTH = 500;

/** A number to a few significant figures, grouped. */
const grouped = (value: number): string =>
  value.toLocaleString('en-GB', { maximumSignificantDigits: 3 });

/** A section, or one of its mounts, in words. */
const partText = (section: keyof typeof SECTION_TEXT, mount: number | null): string =>
  mount === null
    ? `${SECTION_TEXT[section].toLowerCase()} section`
    : `${SECTION_TEXT[section].toLowerCase()} mount ${mount + 1}`;

/** One line of the test log: any event in full, naming the sides rather than us and them. */
export const describeTestEvent = (event: BattleEvent, sides: readonly SideSetup[]): string => {
  const nameOf = (id: string) => sides.find((s) => s.id === id)?.name ?? id;
  const time = formatBattleTime(event.time);
  switch (event.type) {
    case 'hit': {
      const intensity = (event.intensity / 1e6).toLocaleString('en-GB', {
        maximumFractionDigits: 2,
      });
      const spot = event.spotRadius.toLocaleString('en-GB', { maximumFractionDigits: 1 });
      return `${time} ${nameOf(event.attacker)} ${BEAM_TEXT[event.attack].toLowerCase()} hit ${nameOf(event.target)} ${partText(event.section, event.mount)} · ${formatMW(event.power)}${describeShielding(event)} · ${intensity} MW/m² · spot ${spot} m · range ${formatKm(event.range)}`;
    }
    case 'impact':
      return `${time} ${nameOf(event.attacker)} ${IMPACT_TEXT[event.munition].toLowerCase()} hit ${nameOf(event.target)} ${partText(event.section, event.mount)} · ${formatGJ(event.energy)} · ${formatKmPerS(event.speed)}`;
    case 'launch':
      return `${time} ${nameOf(event.attacker)} launched missile ${event.munition} at ${nameOf(event.target)} from ${partText(event.section, event.mount)}`;
    case 'intercept': {
      const chance = Math.round(event.chance * 100);
      return `${time} ${nameOf(event.side)} point defence (${partText(event.section, event.mount)}) shot down ${nameOf(event.attacker)} ${event.warhead} missile ${event.munition} · ${formatKm(event.distance, 2)} out · ${chance}% chance`;
    }
    case 'detonation': {
      const burst = event.contact
        ? 'on contact'
        : `${formatKm(event.distance, 2)} from ${nameOf(event.target)}`;
      const exposed = event.exposures
        .map(
          (e) =>
            `${nameOf(e.side)} ${partText(e.section, e.mount)} ${formatKm(e.distance, 2)} ${grouped(e.fluence / 1e4)} J/cm² ${formatGJ(e.energy)}`,
        )
        .join('; ');
      return `${time} ${nameOf(event.attacker)} missile ${event.munition} detonated ${formatKilotons(event.yield)} ${burst} · ${exposed || 'nothing exposed'}`;
    }
    case 'magazine-explosion':
      return `${time} ${nameOf(event.side)} ${SECTION_TEXT[event.section].toLowerCase()} magazine ${event.index + 1} exploded · ${event.warheads} ${event.warheads === 1 ? 'warhead' : 'warheads'} · ${formatGJ(event.energy)}`;
    case 'armour-breached':
      return `${time} ${nameOf(event.side)} ${SECTION_TEXT[event.section].toLowerCase()} armour breached`;
    case 'component-lost': {
      const where = event.mounted
        ? `${SECTION_TEXT[event.section].toLowerCase()} mount ${event.index + 1}`
        : `${SECTION_TEXT[event.section].toLowerCase()} section`;
      return `${time} ${nameOf(event.side)} ${COMPONENT_TEXT[event.component].toLowerCase()} lost (${where})`;
    }
    case 'structural-failure':
      return `${time} ${nameOf(event.side)} ${SECTION_TEXT[event.section].toLowerCase()} section structural failure`;
    case 'battle-ended':
      return `${time} Battle over: ${outcomeHeadline(event.outcome, sides)} · ${outcomeDetails(event.outcome, sides).join(' · ')}`;
  }
};

/** Test mode's log of every event in the battle, for both sides, newest first. */
export const createTestLog = (sides: readonly SideSetup[]) => {
  const list = el('ol', { className: 'battle-log test-log' });
  const count = el('span', { className: 'test-log__count', text: '0 events' });
  const element = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': 'Test log' } },
    el('h2', { text: 'Test log' }),
    count,
    list,
  );
  let total = 0;

  return {
    element,
    /** Adds events, oldest first, to the top of the log. */
    add(events: readonly BattleEvent[]) {
      if (events.length === 0) return;
      total += events.length;
      count.textContent = `${total.toLocaleString('en-GB')} ${total === 1 ? 'event' : 'events'}`;
      list.prepend(
        ...events
          .slice(-TEST_LOG_LENGTH)
          .reverse()
          .map((event) => el('li', { text: describeTestEvent(event, sides) })),
      );
      while (list.children.length > TEST_LOG_LENGTH) list.lastElementChild?.remove();
    },
  };
};
