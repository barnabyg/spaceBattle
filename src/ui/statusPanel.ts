import type { MunitionObservation, SideObservation } from '../sim/battle';
import { SECTION_KINDS, type MissileRole } from '../sim/design';
import type { BeamKind } from '../sim/events';
import { OVERHEAT_TEMPERATURE } from '../sim/heat';
import { POWER_SYSTEMS } from '../sim/power';
import { distance, length } from '../sim/vector';
import { BEAM_TEXT } from './damagePanel';
import { el } from './el';
import {
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

/** How many munitions of a kind are in flight, ours and the enemy's. */
const inFlight = (
  { munitions, ownShip }: SideObservation,
  kind: (munition: MunitionObservation) => boolean,
): string => {
  const flying = munitions.filter(kind);
  const ours = flying.filter((m) => m.attacker === ownShip.sideId).length;
  return `${ours} ours · ${flying.length - ours} incoming`;
};

/** Whether a munition is a missile in a role. */
const missileIn =
  (role: MissileRole) =>
  (munition: MunitionObservation): boolean =>
    munition.kind === 'missile' && munition.role === role;

/** Missiles of a role left and held when full, e.g. "10 of 12 missiles". */
const missilesHeld = (
  { ownShip: { weapons } }: SideObservation,
  role: MissileRole,
  name: string,
): readonly string[] => {
  const designs = weapons.ammunition.missileDesigns.filter((d) => d.role === role);
  const capacity = designs.reduce((n, d) => n + d.capacity, 0);
  const left = designs.reduce((n, d) => n + d.missiles, 0);
  return capacity > 0 ? [`${count(left)} of ${count(capacity)} ${name}`] : [];
};

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
  ['Shields', describeShields],
  ['Beam power', beamPower],
  [
    'Ammunition',
    (o) => {
      const { slugs, slugCapacity, rounds, roundCapacity } = o.ownShip.weapons.ammunition;
      const held = [
        ...(slugCapacity > 0 ? [`${count(slugs)} of ${count(slugCapacity)} slugs`] : []),
        ...(roundCapacity > 0 ? [`${count(rounds)} of ${count(roundCapacity)} rounds`] : []),
        ...missilesHeld(o, 'anti-ship', 'missiles'),
        ...missilesHeld(o, 'anti-missile', 'anti-missile missiles'),
      ];
      return held.length > 0 ? held.join(' · ') : '—';
    },
  ],
  ['Slugs in flight', (o) => inFlight(o, (m) => m.kind === 'slug')],
  ['Missiles in flight', (o) => inFlight(o, missileIn('anti-ship'))],
  ['Anti-missile missiles in flight', (o) => inFlight(o, missileIn('anti-missile'))],
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
