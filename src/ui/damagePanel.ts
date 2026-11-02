import type { BattleEvent, SectionObservation, SideId, SideObservation } from '../sim/battle';
import type { ComponentType, SectionKind } from '../sim/design';
import type { BeamKind } from '../sim/events';
import { el } from './el';
import { formatBattleTime, formatGJ, formatKilotons, formatKm, formatMm, formatMW } from './format';

export const SECTION_TEXT: Readonly<Record<SectionKind, string>> = {
  forward: 'Forward',
  middle: 'Middle',
  engine: 'Engine',
};

export const COMPONENT_TEXT: Readonly<Record<ComponentType, string>> = {
  drive: 'Drive',
  thrusters: 'Thrusters',
  reactor: 'Reactor',
  capacitor: 'Capacitor',
  magazine: 'Magazine',
  radiator: 'Radiator',
  laser: 'Laser',
  'charged-particle-beam': 'Charged particle beam',
  'neutral-particle-beam': 'Neutral particle beam',
  'kinetic-gun': 'Kinetic gun',
  launcher: 'Launcher',
};

/** Each kind of beam, as a weapon's name. */
export const BEAM_TEXT: Readonly<Record<BeamKind, string>> = {
  laser: 'Laser',
  'charged-particle': 'Charged particle beam',
  'neutral-particle': 'Neutral particle beam',
};

const MUNITION_TEXT = { slug: 'Slug', missile: 'Missile' } as const;

/** How many of the latest events the log shows. */
const LOG_LENGTH = 6;

/** Integrity as a percentage that only reads 100% when undamaged and 0% when lost. */
const formatIntegrity = (integrity: number): string =>
  `${integrity >= 1 ? 100 : integrity <= 0 ? 0 : Math.max(1, Math.floor(integrity * 100))}%`;

const describeSection = (section: SectionObservation): string => {
  const { armour } = section;
  const armourText =
    armour.thickness > 0
      ? `${armour.type} armour ${formatMm(armour.remaining)} of ${formatMm(armour.thickness)}`
      : 'no armour';
  const structure =
    section.structure > 0
      ? `structure ${formatIntegrity(section.structure)}`
      : 'structural failure';
  return `${armourText} · ${structure}`;
};

/** One line of the battle log, from the viewing side's point of view. */
const describeEvent = (event: BattleEvent, viewer: SideId): string => {
  const time = formatBattleTime(event.time);
  switch (event.type) {
    case 'hit': {
      const part = `${SECTION_TEXT[event.section].toLowerCase()} ${event.mount === null ? 'section' : 'mount'}`;
      return event.attacker === viewer
        ? `${time} ${BEAM_TEXT[event.attack]} hit enemy ${part} · ${formatMW(event.power)}`
        : `${time} ${BEAM_TEXT[event.attack]} hit on our ${part} · ${formatMW(event.power)}`;
    }
    case 'impact': {
      const part = `${SECTION_TEXT[event.section].toLowerCase()} ${event.mount === null ? 'section' : 'mount'}`;
      const munition = MUNITION_TEXT[event.munition];
      return event.attacker === viewer
        ? `${time} ${munition} hit enemy ${part} · ${formatGJ(event.energy)}`
        : `${time} ${munition} hit on our ${part} · ${formatGJ(event.energy)}`;
    }
    case 'launch':
      return event.attacker === viewer
        ? `${time} Missile launched`
        : `${time} Enemy missile launched at us`;
    case 'detonation': {
      const burst = `${formatKilotons(event.yield)} ${event.contact ? 'on contact' : `at ${formatKm(event.distance, 1)}`}`;
      return event.attacker === viewer
        ? `${time} Nuclear warhead hit enemy · ${burst}`
        : `${time} Nuclear warhead hit us · ${burst}`;
    }
    case 'magazine-explosion':
      return `${time} ${SECTION_TEXT[event.section]} magazine exploded · ${formatGJ(event.energy)}`;
    case 'armour-breached':
      return `${time} ${SECTION_TEXT[event.section]} armour breached`;
    case 'component-lost':
      return `${time} ${COMPONENT_TEXT[event.component]} lost (${SECTION_TEXT[event.section].toLowerCase()})`;
    case 'structural-failure':
      return `${time} ${SECTION_TEXT[event.section]} section structural failure`;
    case 'battle-ended':
      return `${time} Battle over`;
  }
};

export interface DamagePanelOptions {
  /** The panel's heading, which also names it; 'Damage' by default. */
  readonly title?: string;
  /** Shown under the heading. */
  readonly intro?: HTMLElement;
  /** Whether to show the side's latest events; true by default. */
  readonly log?: boolean;
}

/**
 * Armour, structure and component integrity of a side's ship, and its recent events: by default
 * the captain's own ship. Test mode shows the enemy ship this way too.
 */
export const createDamagePanel = (
  viewer: SideId,
  { title = 'Damage', intro, log: showLog = true }: DamagePanelOptions = {},
) => {
  const body = el('div', { className: 'damage-sections' });
  const log = el('ol', { className: 'battle-log', attrs: { 'aria-label': 'Battle log' } });
  const element = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': title } },
    el('h2', { text: title }),
    ...(intro ? [intro] : []),
    body,
    ...(showLog ? [log] : []),
  );

  // Built on the first update, once the ship's sections and components are known.
  let rows:
    | {
        readonly summary: HTMLElement;
        readonly parts: readonly { readonly value: HTMLElement; readonly item: HTMLElement }[];
      }[]
    | undefined;

  const build = (sections: readonly SectionObservation[]) =>
    sections.map((section) => {
      const summary = el('span', {
        className: 'damage-summary',
        attrs: { 'aria-label': `${SECTION_TEXT[section.kind]} section` },
      });
      const parts = [
        ...section.components.map((c) => ({ type: c.type, mounted: false })),
        ...section.mounts.map((c) => ({ type: c.type, mounted: true })),
      ].map(({ type, mounted }) => {
        const value = el('span', { className: 'damage-integrity' });
        const item = el(
          'li',
          {},
          el('span', { text: `${COMPONENT_TEXT[type]}${mounted ? ' (mount)' : ''}` }),
          value,
        );
        return { value, item };
      });
      body.append(
        el(
          'div',
          { className: 'damage-section' },
          el('h3', { text: SECTION_TEXT[section.kind] }),
          summary,
          el('ul', { className: 'damage-parts' }, ...parts.map((p) => p.item)),
        ),
      );
      return { summary, parts };
    });

  return {
    element,
    update(observation: SideObservation) {
      const { sections } = observation.ownShip;
      rows ??= build(sections);
      sections.forEach((section, i) => {
        const row = rows?.[i];
        if (!row) return;
        row.summary.textContent = describeSection(section);
        [...section.components, ...section.mounts].forEach((component, j) => {
          const part = row.parts[j];
          if (!part) return;
          part.value.textContent = formatIntegrity(component.integrity);
          part.item.classList.toggle('damaged', component.integrity < 1);
          part.item.classList.toggle('lost', component.integrity <= 0);
        });
      });
      if (!showLog) return;
      const latest = observation.events.slice(-LOG_LENGTH).reverse();
      const lines = latest.map((event) => describeEvent(event, viewer));
      if (lines.join('\n') !== [...log.children].map((li) => li.textContent).join('\n')) {
        log.replaceChildren(...lines.map((text) => el('li', { text })));
      }
    },
  };
};
