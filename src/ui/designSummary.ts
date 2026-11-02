import {
  designComponent,
  designComponentsOfType,
  type Design,
  type MissileDesign,
} from '../sim/design';
import { deltaVWith, massProperties } from '../sim/ship';
import { kineticGunRange } from '../sim/kinetic';
import { missileDeltaV, missileReach } from '../sim/missile';
import { pointDefenceRange } from '../sim/pointDefence';
import { effectiveRange, type BeamWeaponDesign } from '../sim/beams';
import { designFullDeflection } from '../sim/shields';
import { designMissiles } from '../sim/weapons';
import {
  formatGeV,
  formatKilotons,
  formatKm,
  formatKmPerS,
  formatMm,
  formatMW,
  formatTonnes,
} from './format';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A missile design's name, with its yield if its warhead is nuclear. */
const missileName = (missile: MissileDesign): string =>
  missile.warhead.type === 'nuclear'
    ? `${missile.name} (${formatKilotons(missile.warhead.yield)} nuclear)`
    : missile.name;

/** Beam weapons of one kind: how many, their beam power together and the longest reach. */
const describeBeams = (weapons: readonly BeamWeaponDesign[]): string =>
  weapons.length === 0
    ? 'None'
    : `${weapons.length} · ${formatMW(weapons.reduce((total, w) => total + w.beamPower, 0))} beam · reach ${formatKm(Math.max(...weapons.map(effectiveRange)))}`;

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
  const launchers = designComponentsOfType(design, 'launcher');
  const missiles = magazines.reduce((n, m) => n + m.missiles, 0);
  const missileDesigns = designMissiles(design);
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
    [
      'Missiles',
      launchers.length === 0
        ? 'None'
        : `${launchers.length} launchers · ${missiles.toLocaleString('en-GB')} ${missileDesigns.map(missileName).join(', ')} · ${formatKmPerS(Math.max(...missileDesigns.map((m) => missileDeltaV(m))))} · reach ${formatKm(Math.max(...missileDesigns.map(missileReach)))}`,
    ],
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
