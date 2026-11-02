import { designComponent, designComponentsOfType, type Design } from '../sim/design';
import { deltaVWith, massProperties } from '../sim/ship';
import { kineticGunRange } from '../sim/kinetic';
import { effectiveRange } from '../sim/weapons';
import { formatKm, formatKmPerS, formatMm, formatMW, formatTonnes } from './format';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A design's key numbers at the start of a battle, as label and value, for choosing between designs. */
export const designSummary = (design: Design): readonly (readonly [string, string])[] => {
  const { mass } = massProperties(design, design.propellantMass);
  const drive = designComponent(design, 'drive');
  const lasers = designComponentsOfType(design, 'laser');
  const beamPower = lasers.reduce((total, l) => total + l.beamPower, 0);
  const guns = designComponentsOfType(design, 'kinetic-gun');
  const slugs = designComponentsOfType(design, 'magazine').reduce((n, m) => n + m.slugs, 0);
  return [
    ['Hull size', capitalise(design.hullSize)],
    ['Mass', formatTonnes(mass)],
    ['Delta-v', formatKmPerS(deltaVWith(design))],
    [
      'Acceleration',
      `${(drive.thrust / mass).toLocaleString('en-GB', { maximumFractionDigits: 2 })} m/s²`,
    ],
    ['Reactor', formatMW(designComponent(design, 'reactor').output)],
    [
      'Lasers',
      lasers.length === 0
        ? 'None'
        : `${lasers.length} · ${formatMW(beamPower)} beam · reach ${formatKm(Math.max(...lasers.map(effectiveRange)))}`,
    ],
    [
      'Kinetic guns',
      guns.length === 0
        ? 'None'
        : `${guns.length} · ${formatKmPerS(Math.max(...guns.map((g) => g.muzzleVelocity)))} · ${slugs.toLocaleString('en-GB')} slugs · reach ${formatKm(Math.max(...guns.map(kineticGunRange)))}`,
    ],
    ...design.sections.map((s): readonly [string, string] => [
      `${capitalise(s.kind)} armour`,
      `${formatMm(s.armour.thickness)} ${s.armour.type}`,
    ]),
  ];
};
