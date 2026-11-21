import type { BattleEvent, SectionObservation, SideId, SideObservation } from '../sim/battle';
import type { ComponentType, SectionKind } from '../sim/design';
import type { BeamKind, HitEvent, ImpactKind, InterceptWeapon } from '../sim/events';
import { targetsMissile } from '../sim/missile';
import type { ComponentAddress } from '../sim/orders';
import { REPAIR_CAP } from '../sim/repair';
import { withdrawalReasonText } from '../game/withdrawal';
import type { WithdrawalReason } from '../sim/orders';
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
  'magnetic-shield': 'Magnetic shield',
  'coolant-shield': 'Coolant shield',
  'long-range-scanner': 'Long-range scanner',
  'signal-interceptor': 'Signal interceptor',
  radiator: 'Radiator',
  laser: 'Laser',
  'charged-particle-beam': 'Charged particle beam',
  'neutral-particle-beam': 'Neutral particle beam',
  'kinetic-gun': 'Kinetic gun',
  'point-defence': 'Point defence',
  launcher: 'Launcher',
  sensor: 'Sensor',
};

/** Each kind of beam, as a weapon's name. */
export const BEAM_TEXT: Readonly<Record<BeamKind, string>> = {
  laser: 'Laser',
  'charged-particle': 'Charged particle beam',
  'neutral-particle': 'Neutral particle beam',
};

/** What struck a ship directly, as a name. */
export const IMPACT_TEXT: Readonly<Record<ImpactKind, string>> = {
  slug: 'Slug',
  missile: 'Missile',
  'point-defence': 'Point defence',
};

/** What shot a missile down, as a name. */
export const INTERCEPT_TEXT: Readonly<Record<InterceptWeapon, string>> = {
  'point-defence': 'Point defence',
  'anti-missile-missile': 'Anti-missile missile',
};

/** How many of the latest events the log shows. */
/** Why a ship withdraws, as a clause to follow the log line; empty for a plain order. */
const reasonOf = (reason: WithdrawalReason, own: boolean): string => {
  const text = withdrawalReasonText(reason, own);
  return text ? ` · ${text}` : '';
};

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

/**
 * What the target's shields did to a beam hit, e.g. " · 400 MW deflected" or
 * " · 300 MW taken by coolant"; nothing when they did nothing.
 */
export const describeShielding = ({ deflected, absorbed }: HitEvent): string =>
  [
    ...(deflected > 0 ? [`${formatMW(deflected)} deflected`] : []),
    ...(absorbed > 0 ? [`${formatMW(absorbed)} taken by coolant`] : []),
  ]
    .map((text) => ` · ${text}`)
    .join('');

/** One line of the battle log, from the viewing side's point of view. */
const describeEvent = (event: BattleEvent, viewer: SideId): string => {
  const time = formatBattleTime(event.time);
  switch (event.type) {
    case 'hit': {
      const part = `${SECTION_TEXT[event.section].toLowerCase()} ${event.mount === null ? 'section' : 'mount'}`;
      const landed = `${formatMW(event.power)}${describeShielding(event)}`;
      return event.attacker === viewer
        ? `${time} ${BEAM_TEXT[event.attack]} hit enemy ${part} · ${landed}`
        : `${time} ${BEAM_TEXT[event.attack]} hit on our ${part} · ${landed}`;
    }
    case 'impact': {
      const part = `${SECTION_TEXT[event.section].toLowerCase()} ${event.mount === null ? 'section' : 'mount'}`;
      const munition = IMPACT_TEXT[event.munition];
      return event.attacker === viewer
        ? `${time} ${munition} hit enemy ${part} · ${formatGJ(event.energy)}`
        : `${time} ${munition} hit on our ${part} · ${formatGJ(event.energy)}`;
    }
    case 'launch':
      if (targetsMissile(event.target)) {
        return event.attacker === viewer
          ? `${time} Anti-missile missile launched`
          : `${time} Enemy anti-missile missile launched`;
      }
      return event.attacker === viewer
        ? `${time} Missile launched`
        : `${time} Enemy missile launched at us`;
    case 'intercept': {
      const weapon = INTERCEPT_TEXT[event.weapon];
      return event.side === viewer
        ? `${time} ${weapon} shot down enemy missile · ${formatKm(event.distance, 1)}`
        : `${time} Our missile shot down by ${weapon.toLowerCase()}`;
    }
    case 'miss':
      return event.side === viewer
        ? `${time} Anti-missile missile missed`
        : `${time} Enemy anti-missile missile missed our missile`;
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
    case 'disarmed':
      return event.side === viewer
        ? `${time} Nothing left to fight with`
        : `${time} Enemy has nothing left to fight with`;
    case 'withdrawal':
      return event.side === viewer
        ? `${time} Withdrawing from the battle${reasonOf(event.reason, true)}`
        : `${time} Enemy withdrawing: no pursuit${reasonOf(event.reason, false)}`;
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
  /**
   * Sets the crew to repair a component, or stops them (null); when given, each component a
   * field repair can help has a Repair button (see `RepairOrder`).
   */
  readonly onRepair?: (target: ComponentAddress | null) => void;
}

/**
 * Armour, structure and component integrity of a side's ship, and its recent events: by default
 * the captain's own ship. Test mode shows the enemy ship this way too.
 */
export const createDamagePanel = (
  viewer: SideId,
  { title = 'Damage', intro, log: showLog = true, onRepair }: DamagePanelOptions = {},
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
        readonly parts: readonly {
          readonly value: HTMLElement;
          readonly item: HTMLElement;
          readonly repair: HTMLButtonElement | null;
          readonly address: ComponentAddress;
        }[];
      }[]
    | undefined;

  const build = (sections: readonly SectionObservation[]) =>
    sections.map((section) => {
      const summary = el('span', {
        className: 'damage-summary',
        attrs: { 'aria-label': `${SECTION_TEXT[section.kind]} section` },
      });
      const parts = [
        ...section.components.map((c, index) => ({ type: c.type, mounted: false, index })),
        ...section.mounts.map((c, index) => ({ type: c.type, mounted: true, index })),
      ].map(({ type, mounted, index }) => {
        const value = el('span', { className: 'damage-integrity' });
        const address: ComponentAddress = { section: section.kind, mounted, index };
        const repair = onRepair
          ? el('button', {
              className: 'damage-repair',
              text: 'Repair',
              attrs: {
                type: 'button',
                'aria-label': `Repair ${COMPONENT_TEXT[type]}${mounted ? ' (mount)' : ''}, ${SECTION_TEXT[section.kind]}`,
              },
            })
          : null;
        repair?.addEventListener('click', () => {
          onRepair?.(repair.getAttribute('aria-pressed') === 'true' ? null : address);
        });
        const item = el(
          'li',
          {},
          el('span', { text: `${COMPONENT_TEXT[type]}${mounted ? ' (mount)' : ''}` }),
          value,
          ...(repair ? [repair] : []),
        );
        return { value, item, repair, address };
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
          const { repair } = observation.ownShip;
          const repairing =
            repair !== null &&
            repair.section === part.address.section &&
            repair.mounted === part.address.mounted &&
            repair.index === part.address.index;
          part.value.textContent = repairing
            ? `${formatIntegrity(component.integrity)} · ${repair.state === 'working' ? 'repairing' : 'repair paused under fire'}`
            : formatIntegrity(component.integrity);
          if (part.repair) {
            part.repair.hidden =
              !repairing && !(component.integrity > 0 && component.integrity < REPAIR_CAP);
            part.repair.textContent = repairing ? 'Stop' : 'Repair';
            part.repair.setAttribute('aria-pressed', String(repairing));
          }
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
