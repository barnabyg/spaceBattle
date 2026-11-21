import {
  closestPass,
  followedContact,
  relativeMotion,
  returnPassDeltaV,
} from '../game/relativeMotion';
import type { MunitionObservation, SideObservation } from '../sim/battle';
import { SECTION_KINDS, type MissileRole } from '../sim/design';
import type { BeamKind } from '../sim/events';
import { OVERHEAT_TEMPERATURE } from '../sim/heat';
import { POWER_SYSTEMS } from '../sim/power';
import { distance, length } from '../sim/vector';
import { BEAM_TEXT } from './damagePanel';
import { el } from './el';
import type { OutgoingSlugs } from '../game/outgoingSlugs';
import { ammunitionStocks, type AmmunitionStock } from '../game/ammunition';
import { hasEquipment } from './equipment';
import {
  formatDuration,
  formatGeV,
  formatGJ,
  formatKelvin,
  formatKm,
  formatKmPerS,
  formatMW,
  formatPercent,
  formatTonnes,
} from './format';
const formatMN = (newtons: number) =>
  `${(newtons / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 2 })} MN`;

const count = (n: number) => n.toLocaleString('en-GB');

/** How many of the side's own munitions of a kind are in flight. */
const ours = (
  { munitions, ownShip }: SideObservation,
  kind: (munition: MunitionObservation) => boolean,
): number => munitions.filter((m) => kind(m) && m.attacker === ownShip.sideId).length;

/** Whether the ship carries missiles in a role, whether or not any are left. */
const carries = ({ ownShip }: SideObservation, role: MissileRole): boolean =>
  ownShip.weapons.ammunition.missileDesigns.some((d) => d.role === role);

/** Whether a munition is a missile in a role. */
const missileIn =
  (role: MissileRole) =>
  (munition: MunitionObservation): boolean =>
    munition.kind === 'missile' && munition.role === role;

/**
 * The power going out in the ship's beams now, by kind, for each kind of beam weapon it carries,
 * e.g. "Laser 500 MW · Neutral particle beam 0 MW".
 */
const beamPower = ({ ownShip: { weapons } }: SideObservation): string => {
  const beams: { readonly kind: BeamKind; readonly power: number }[] = [
    ...weapons.lasers.map((laser) => ({ kind: 'laser' as const, power: laser.beamPower })),
    ...weapons.particleBeams.map((beam) => ({ kind: beam.kind, power: beam.beamPower })),
  ];
  const kinds = [...new Set(beams.map((beam) => beam.kind))];
  if (kinds.length === 0) return '—';
  return kinds
    .map((kind) => {
      const power = beams.reduce((total, b) => (b.kind === kind ? total + b.power : total), 0);
      return `${BEAM_TEXT[kind]} ${formatMW(power)}`;
    })
    .join(' · ');
};

/**
 * What the ship's shields can do now, e.g. "Raised · 100% power · protons to 18.7 GeV" or
 * "Raised · 100% power · coolant 300 MW forward, 300 MW engine · carrying 250 MW".
 */
const describeShields = ({ ownShip: { shields, heat } }: SideObservation): string => {
  if (shields.shields.length === 0) return '—';
  if (!shields.raised) return 'Lowered';
  const coolant = SECTION_KINDS.flatMap((kind) =>
    shields.shields.some((s) => s.type === 'coolant-shield' && s.section === kind)
      ? [`${formatMW(shields.coolantCapacity[kind])} ${kind}`]
      : [],
  );
  return [
    'Raised',
    `${formatPercent(shields.powered)} power`,
    ...(shields.shields.some((s) => s.type === 'magnetic-shield')
      ? [`protons to ${formatGeV(shields.fullDeflection)}`]
      : []),
    ...(coolant.length > 0 ? [`coolant ${coolant.join(', ')}`] : []),
    ...(heat.absorbed > 0 ? [`carrying ${formatMW(heat.absorbed)}`] : []),
  ].join(' · ');
};

/** How the followed contact moves relative to the own ship, if there is one. */
const motionOf = (observation: SideObservation) => {
  const contact = followedContact(observation);
  return contact ? relativeMotion(observation.ownShip, contact) : undefined;
};

/** Closing speed to the nearest 0.01 km/s shown, e.g. "3.20 km/s" or "−0.40 km/s · opening". */
const describeClosing = (closingSpeed: number): string => {
  const shown = Math.round(closingSpeed / 10) * 10 + 0;
  return shown < 0 ? `${formatKmPerS(shown)} · opening` : formatKmPerS(shown);
};

/**
 * The pass with the followed contact: while closing, when and how near it comes if neither
 * burns; once past and drawing apart, the delta-v it takes to come back for another pass at the
 * same speed, against the delta-v left above the reserve.
 */
const describePass = (observation: SideObservation): string => {
  const contact = followedContact(observation);
  if (!contact) return '—';
  const { ownShip } = observation;
  const pass = closestPass(ownShip, contact);
  if (pass) return `Closest in ${formatDuration(pass.time)} · ${formatKm(pass.separation)}`;
  const motion = relativeMotion(ownShip, contact);
  if (motion.closingSpeed >= 0) return '—';
  const spare = Math.max(0, ownShip.deltaV - ownShip.reserve);
  return `Another: ${formatKmPerS(returnPassDeltaV(motion))} of ${formatKmPerS(spare)} above reserve`;
};

/** Each readout: its label and how to show it from the captain's observation. */
const READOUTS: readonly (readonly [string, (o: SideObservation) => string])[] = [
  [
    'Incoming missiles',
    (o) =>
      count(
        o.munitions.filter((m) => m.kind === 'missile' && m.target === o.ownShip.sideId).length,
      ),
  ],
  [
    'Separation',
    (o) => {
      const contact = followedContact(o);
      return contact ? formatKm(distance(o.ownShip.position, contact.position)) : '—';
    },
  ],
  ['Pass', describePass],
  ['Own speed', (o) => formatKmPerS(length(o.ownShip.velocity))],
  [
    'Contact speed',
    (o) => {
      const contact = followedContact(o);
      return contact ? formatKmPerS(length(contact.velocity)) : '—';
    },
  ],
  [
    'Closing speed',
    (o) => {
      const motion = motionOf(o);
      return motion ? describeClosing(motion.closingSpeed) : '—';
    },
  ],
  [
    'Relative speed',
    (o) => {
      const motion = motionOf(o);
      return motion ? formatKmPerS(motion.relativeSpeed) : '—';
    },
  ],
  [
    'Delta-v',
    ({ ownShip }) =>
      ownShip.withdrawing
        ? `${formatKmPerS(ownShip.deltaV)} · withdrawing`
        : ownShip.deltaV <= ownShip.reserve
          ? `${formatKmPerS(ownShip.deltaV)} · into reserve`
          : ownShip.reserveWarning
            ? `${formatKmPerS(ownShip.deltaV)} · near reserve`
            : formatKmPerS(ownShip.deltaV),
  ],
  ['Reserve', (o) => formatKmPerS(o.ownShip.reserve)],
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
  ['Shields', describeShields],
  ['Beam power', beamPower],
  [
    'Incoming slugs',
    ({ munitions, ownShip }) =>
      count(munitions.filter((m) => m.kind === 'slug' && m.target === ownShip.sideId).length),
  ],
  ['Our missiles in flight', (o) => count(ours(o, missileIn('anti-ship')))],
  ['Our anti-missile missiles in flight', (o) => count(ours(o, missileIn('anti-missile')))],
  [
    'Incoming anti-missile missiles',
    (o) =>
      count(
        o.munitions.filter((m) => missileIn('anti-missile')(m) && m.attacker !== o.ownShip.sideId)
          .length,
      ),
  ],
  [
    'Point defence',
    ({ ownShip: { weapons } }) => {
      const guns = weapons.pointDefence;
      if (guns.length === 0) return '—';
      const engaging = guns.filter((g) => g.engaging !== null).length;
      return `${count(engaging)} of ${count(guns.length)} firing · ${count(weapons.intercepts)} shot down`;
    },
  ],
  [
    'Radiators',
    ({ ownShip: { heat } }) =>
      `${heat.radiatorDeploymentRemaining > 0 ? `Deploying · ${heat.radiatorDeploymentRemaining.toFixed(1)} s` : heat.radiatorsDeployed ? 'Deployed' : 'Retracted'} · ${Math.round(heat.radiatorArea).toLocaleString('en-GB')} m²`,
  ],
];

/**
 * Our slugs: how many are in flight, when the first and last will arrive, and how many have hit
 * or missed, e.g. "96 in flight · first in 3 min 20 s, last in 16 min 40 s · 4 hit · 12 missed".
 */
export const describeOurSlugs = (slugs: OutgoingSlugs | null): string => {
  if (!slugs) return 'None fired';
  const tally = `${count(slugs.hits)} hit · ${count(slugs.misses)} missed`;
  if (slugs.inFlight === 0) return `None in flight · ${tally}`;
  const arrival =
    slugs.firstIn === null || slugs.lastIn === null
      ? 'not closing on the enemy'
      : slugs.inFlight === 1
        ? `arrives in ${formatDuration(slugs.firstIn)}`
        : `first in ${formatDuration(slugs.firstIn)}, last in ${formatDuration(slugs.lastIn)}`;
  return `${count(slugs.inFlight)} in flight · ${arrival} · ${tally}`;
};

/**
 * A gauge for each kind of ammunition the ship carries: a bar of what is left of a full load, in
 * a warning colour once low and empty, with the count beside it.
 */
const createAmmunitionGauges = () => {
  const element = el('div', {
    className: 'ammo-gauges',
    attrs: { role: 'group', 'aria-label': 'Ammunition' },
  });
  let names = '';
  let rows: { fill: HTMLElement; meter: HTMLElement; left: HTMLElement }[] = [];
  return {
    element,
    update(stocks: readonly AmmunitionStock[]) {
      element.hidden = stocks.length === 0;
      const next = stocks.map((stock) => stock.name).join('\n');
      if (next !== names) {
        names = next;
        rows = stocks.map((stock) => {
          const fill = el('div', { className: 'ammo-gauge__fill' });
          const meter = el(
            'div',
            {
              className: 'ammo-gauge__track',
              attrs: {
                role: 'meter',
                'aria-label': `${stock.name} left`,
                'aria-valuemin': '0',
                'aria-valuemax': String(stock.capacity),
              },
            },
            fill,
          );
          const left = el('span', { className: 'ammo-gauge__count' });
          return { fill, meter, left };
        });
        element.replaceChildren(
          ...stocks.flatMap((stock, i) => {
            const row = rows[i];
            return row
              ? [
                  el('span', { className: 'ammo-gauge__name', text: stock.name }),
                  row.meter,
                  row.left,
                ]
              : [];
          }),
        );
      }
      stocks.forEach((stock, i) => {
        const row = rows[i];
        if (!row) return;
        const text = `${count(stock.left)} of ${count(stock.capacity)} ${stock.noun}`;
        row.fill.style.width = `${(100 * stock.left) / Math.max(1, stock.capacity)}%`;
        row.meter.setAttribute('aria-valuenow', String(stock.left));
        row.meter.setAttribute('aria-valuetext', text);
        row.meter.dataset.level = stock.level;
        row.left.dataset.level = stock.level;
        row.left.textContent =
          stock.level === 'empty' ? 'Empty' : `${count(stock.left)} of ${count(stock.capacity)}`;
      });
    },
  };
};

/** Numbers about the captain's ship and its contact, in real units. */
export const createStatusPanel = () => {
  const values = READOUTS.map(([label]) => el('dd', { attrs: { 'aria-label': label } }));
  const labels = READOUTS.map(([label]) => el('dt', { text: label }));
  const summaryLabels = [
    'Separation',
    'Closing speed',
    'Pass',
    'Delta-v',
    'Temperature',
    'Incoming missiles',
  ];
  const powerLabels = [
    'Power generated',
    'Power demand',
    'Stored energy',
    'Heat generated',
    'Heat radiated',
    'Radiators',
  ];
  const weaponsLabels = [
    'Shields',
    'Beam power',
    'Incoming slugs',
    'Our missiles in flight',
    'Incoming anti-missile missiles',
    'Our anti-missile missiles in flight',
    'Point defence',
  ];
  const makeList = (included: (label: string) => boolean) =>
    el(
      'dl',
      { className: 'status-list' },
      ...READOUTS.flatMap(([label], i) =>
        included(label) ? [labels[i] ?? el('dt'), values[i] ?? el('dd')] : [],
      ),
    );
  const summaryElement = el(
    'section',
    { className: 'battle-summary', attrs: { 'aria-label': 'Essential status' } },
    makeList((label) => summaryLabels.includes(label)),
  );
  const powerElement = makeList((label) => powerLabels.includes(label));
  const weaponsList = makeList((label) => weaponsLabels.includes(label));
  const ourSlugsLabel = el('dt', { text: 'Our slugs' });
  const ourSlugs = el('dd', { attrs: { 'aria-label': 'Our slugs' } });
  weaponsList.prepend(ourSlugsLabel, ourSlugs);
  const gauges = createAmmunitionGauges();
  const weaponsElement = el('div', {}, gauges.element, weaponsList);
  const element = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': 'Ship status' } },
    el('h2', { text: 'Status' }),
    makeList((label) => ![...summaryLabels, ...powerLabels, ...weaponsLabels].includes(label)),
  );

  return {
    element,
    summaryElement,
    powerElement,
    weaponsElement,
    /** Shows the observation, and `slugs`, what came of our slugs, on a ship with kinetic guns. */
    update(observation: SideObservation, slugs: OutgoingSlugs | null = null) {
      const gunned = observation.ownShip.weapons.kineticGuns.length > 0;
      ourSlugsLabel.hidden = !gunned;
      ourSlugs.hidden = !gunned;
      ourSlugs.textContent = describeOurSlugs(slugs);
      gauges.update(ammunitionStocks(observation.ownShip));
      READOUTS.forEach(([label, show], i) => {
        const value = values[i];
        const ship = observation.ownShip;
        const absent =
          label === 'Shields'
            ? ship.shields.shields.length === 0
            : label === 'Radiators'
              ? !hasEquipment(ship, 'radiator')
              : label === 'Stored energy'
                ? !hasEquipment(ship, 'capacitor')
                : label === 'Beam power'
                  ? !hasEquipment(ship, 'laser', 'charged-particle-beam', 'neutral-particle-beam')
                  : label === 'Point defence'
                    ? ship.weapons.pointDefence.length === 0
                    : label === 'Our missiles in flight' ||
                        label === 'Incoming anti-missile missiles'
                      ? !carries(observation, 'anti-ship')
                      : label === 'Our anti-missile missiles in flight'
                        ? !carries(observation, 'anti-missile')
                        : false;
        const heading = labels[i];
        if (heading) heading.hidden = absent;
        if (value) {
          value.hidden = absent;
          value.textContent = show(observation);
        }
      });
    },
  };
};
