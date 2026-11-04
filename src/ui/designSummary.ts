import {
  designComponent,
  designComponentsOfType,
  missileRole,
  type Design,
  type MissileDesign,
  type MissileRole,
} from '../sim/design';
import { deltaVWith, massProperties } from '../sim/ship';
import { kineticGunRange } from '../sim/kinetic';
import { missileDeltaV, missileReach } from '../sim/missile';
import { pointDefenceRange } from '../sim/pointDefence';
import { effectiveRange, LASER_BURST_POWER, type BeamWeaponDesign } from '../sim/beams';
import { designFullDeflection } from '../sim/shields';
import { designMissiles } from '../sim/weapons';
import {
  capitalise,
  formatGeV,
  formatKilotons,
  formatKm,
  formatKmPerS,
  formatMm,
  formatMW,
  formatTonnes,
} from './format';

/** A missile design's name, with its yield if its warhead is nuclear. */
const missileName = (missile: MissileDesign): string =>
  missile.warhead.type === 'nuclear'
    ? `${missile.name} (${formatKilotons(missile.warhead.yield)} nuclear)`
    : missile.name;

/** How many missiles of a design the magazines hold, by name. */
const missilesOf = (design: Design, missile: MissileDesign): number =>
  designComponentsOfType(design, 'magazine').reduce(
    (n, m) => (m.missile?.name === missile.name ? n + m.missiles : n),
    0,
  );

/** A design's missiles in a role, one per design. */
const missilesIn = (design: Design, role: MissileRole): readonly MissileDesign[] =>
  designMissiles(design).filter(
    (missile, i, all) =>
      missileRole(missile) === role && all.findIndex((m) => m.name === missile.name) === i,
  );

/** A design's anti-ship missiles: its launchers, how many of each, their delta-v and reach. */
const describeMissiles = (design: Design): string => {
  const launchers = designComponentsOfType(design, 'launcher').length;
  if (launchers === 0) return 'None';
  const missiles = missilesIn(design, 'anti-ship');
  if (missiles.length === 0) return `${launchers} launchers · anti-missile only`;
  const held = missiles.map(
    (m) => `${missilesOf(design, m).toLocaleString('en-GB')} ${missileName(m)}`,
  );
  return `${launchers} launchers · ${held.join(', ')} · ${formatKmPerS(Math.max(...missiles.map((m) => missileDeltaV(m))))} · reach ${formatKm(Math.max(...missiles.map(missileReach)))}`;
};

/**
 * A design's anti-missile missiles: how many of each, their delta-v, and their warheads'
 * fragments and burst distance.
 */
const describeAntiMissiles = (design: Design): string => {
  const missiles =
    designComponentsOfType(design, 'launcher').length > 0 ? missilesIn(design, 'anti-missile') : [];
  if (missiles.length === 0) return 'None';
  return missiles
    .map((m) => {
      const { warhead } = m;
      const burst =
        warhead.type === 'fragmentation'
          ? ` · ${warhead.fragments.toLocaleString('en-GB')} fragments at ${warhead.burstDistance.toLocaleString('en-GB')} m`
          : '';
      return `${missilesOf(design, m).toLocaleString('en-GB')} ${m.name} · ${formatKmPerS(missileDeltaV(m))}${burst}`;
    })
    .join(' · ');
};

/** Beam weapons of one kind: how many, their beam power together and the longest reach. */
const describeBeams = (weapons: readonly BeamWeaponDesign[]): string =>
  weapons.length === 0
    ? 'None'
    : `${weapons.length} · ${formatMW(weapons.reduce((total, w) => total + w.beamPower, 0))} ${weapons[0]?.type === 'laser' ? `average · ${LASER_BURST_POWER}× burst` : 'beam'} · reach ${formatKm(Math.max(...weapons.map(effectiveRange)))}`;

/**
 * A design's shields: the hardest protons its magnetic shields turn away entirely, the laser power
 * its coolant shields carry away in each section, and the power they draw together.
 */
const describeShields = (design: Design): string => {
  const magnetic = designComponentsOfType(design, 'magnetic-shield');
  const coolant = design.sections.flatMap((section) => {
    const capacity = section.components.reduce(
      (total, c) => (c.type === 'coolant-shield' ? total + c.capacity : total),
      0,
    );
    return capacity > 0 ? [`${formatMW(capacity)} ${section.kind}`] : [];
  });
  const power = [...magnetic, ...designComponentsOfType(design, 'coolant-shield')].reduce(
    (total, shield) => total + shield.power,
    0,
  );
  if (power === 0) return 'None';
  return [
    ...(magnetic.length > 0
      ? [`Magnetic, protons to ${formatGeV(designFullDeflection(design))}`]
      : []),
    ...(coolant.length > 0 ? [`Coolant, ${coolant.join(', ')}`] : []),
    `draws ${formatMW(power)}`,
  ].join(' · ');
};

/** A design's key numbers at the start of a battle, as label and value, for choosing between designs. */
export const designSummary = (design: Design): readonly (readonly [string, string])[] => {
  const { mass } = massProperties(design, design.propellantMass);
  const drive = designComponent(design, 'drive');
  const guns = designComponentsOfType(design, 'kinetic-gun');
  const magazines = designComponentsOfType(design, 'magazine');
  const slugs = magazines.reduce((n, m) => n + m.slugs, 0);
  const pointDefence = designComponentsOfType(design, 'point-defence');
  const rounds = magazines.reduce((n, m) => n + m.rounds, 0);
  return [
    ['Hull size', capitalise(design.hullSize)],
    ['Mass', formatTonnes(mass)],
    ['Delta-v', formatKmPerS(deltaVWith(design))],
    [
      'Acceleration',
      `${(drive.thrust / mass).toLocaleString('en-GB', { maximumFractionDigits: 2 })} m/s²`,
    ],
    ['Reactor', formatMW(designComponent(design, 'reactor').output)],
    ['Lasers', describeBeams(designComponentsOfType(design, 'laser'))],
    [
      'Charged particle beams',
      describeBeams(designComponentsOfType(design, 'charged-particle-beam')),
    ],
    [
      'Neutral particle beams',
      describeBeams(designComponentsOfType(design, 'neutral-particle-beam')),
    ],
    [
      'Kinetic guns',
      guns.length === 0
        ? 'None'
        : `${guns.length} · ${formatKmPerS(Math.max(...guns.map((g) => g.muzzleVelocity)))} · ${slugs.toLocaleString('en-GB')} slugs · reach ${formatKm(Math.max(...guns.map(kineticGunRange)))}`,
    ],
    ['Missiles', describeMissiles(design)],
    ['Anti-missile missiles', describeAntiMissiles(design)],
    [
      'Point defence',
      pointDefence.length === 0
        ? 'None'
        : `${pointDefence.length} · ${formatKmPerS(Math.max(...pointDefence.map((g) => g.muzzleVelocity)))} · ${rounds.toLocaleString('en-GB')} rounds · reach ${formatKm(Math.max(...pointDefence.map(pointDefenceRange)))}`,
    ],
    ['Shields', describeShields(design)],
    ...design.sections.map((s): readonly [string, string] => [
      `${capitalise(s.kind)} armour`,
      `${formatMm(s.armour.thickness)} ${s.armour.type}`,
    ]),
  ];
};
