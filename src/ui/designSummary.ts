import { designComponent, designComponentsOfType, type Design } from '../sim/design';
import { massProperties } from '../sim/ship';
import { effectiveRange } from '../sim/weapons';
import { formatKm, formatKmPerS, formatMm, formatMW, formatTonnes } from './format';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A design's key numbers at the start of a battle, as label and value, for choosing between designs. */
export const designSummary = (design: Design): readonly (readonly [string, string])[] => {
  const { mass, dryMass } = massProperties(design, design.propellantMass);
  const drive = designComponent(design, 'drive');
  const lasers = designComponentsOfType(design, 'laser');
  const reach = Math.max(0, ...lasers.map(effectiveRange));
  const beamPower = lasers.reduce((total, l) => total + l.beamPower, 0);
  return [
    ['Hull size', capitalise(design.hullSize)],
    ['Mass', formatTonnes(mass)],
    // Tsiolkovsky: Δv = vₑ · ln(m₀ / m_dry).
    ['Delta-v', formatKmPerS(drive.exhaustVelocity * Math.log(mass / dryMass))],
    [
      'Acceleration',
      `${(drive.thrust / mass).toLocaleString('en-GB', { maximumFractionDigits: 2 })} m/s²`,
    ],
    ['Reactor', formatMW(designComponent(design, 'reactor').output)],
    [
      'Lasers',
      lasers.length === 0
        ? 'None'
        : `${lasers.length} · ${formatMW(beamPower)} beam · reach ${formatKm(reach)}`,
    ],
    ...design.sections.map((s): readonly [string, string] => [
      `${capitalise(s.kind)} armour`,
      `${formatMm(s.armour.thickness)} ${s.armour.type}`,
    ]),
  ];
};
