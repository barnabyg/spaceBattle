import type { ArmourType, Design, HullSize } from '../sim/design';
import { buildDesign, type ShipSpecification } from '../shipyard/shipyard';
import { catalogueComponent } from './components';

/** A hand-written opponent for the campaign: a specification the shipyard builds, for a tier. */
export interface Opponent {
  readonly tier: number;
  /** How it fights, in a few words, such as "missile boat" or "laser brawler". */
  readonly style: string;
  readonly specification: ShipSpecification;
  /** Its specification built by the shipyard. */
  readonly design: Design;
}

/** Light frigate machinery: drive, thrusters, reactor, capacitor and sensor. */
const FRIGATE = [
  'drive-light',
  'thrusters-light',
  'reactor-light',
  'capacitor-light',
  'sensor-4',
] as const;
/** Cruiser machinery: drive, thrusters, reactor, capacitor and sensor. */
const CRUISER = [
  'drive-medium',
  'thrusters-medium',
  'reactor-medium',
  'capacitor-heavy',
  'sensor-6',
] as const;

type Armour = readonly [ArmourType, number];

const specify = (
  name: string,
  hullSize: HullSize,
  components: readonly string[],
  [forward, middle, engine]: readonly [Armour, Armour, Armour],
  propellantMass: number,
): ShipSpecification => ({
  name,
  hullSize,
  components: components.map((id) => ({ component: catalogueComponent(id) })),
  armour: {
    forward: { type: forward[0], thickness: forward[1] },
    middle: { type: middle[0], thickness: middle[1] },
    engine: { type: engine[0], thickness: engine[1] },
  },
  propellantMass,
  reserve: 10e3,
});

const opponent = (tier: number, style: string, specification: ShipSpecification): Opponent => {
  const { design, errors } = buildDesign(specification);
  if (errors.length > 0) {
    throw new Error(`Opponent "${specification.name}": ${errors.join(' ')}`);
  }
  return { tier, style, specification, design };
};

/**
 * The campaign's opponents, a few for each tier. Each is built within its tier's budget (see
 * `BALANCE.tiers`); the higher tiers field better designs under more skilled captains.
 */
export const OPPONENTS: readonly Opponent[] = [
  opponent(
    1,
    'laser brawler',
    specify(
      'Corsair',
      'frigate',
      [...FRIGATE, 'radiator-light', 'radiator-light', 'laser-400'],
      [
        ['heavy', 0.012],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      400e3,
    ),
  ),
  opponent(
    1,
    'gunship',
    specify(
      'Jackal',
      'frigate',
      [
        ...FRIGATE,
        'radiator-light',
        'radiator-light',
        'kinetic-gun',
        'kinetic-gun',
        'magazine-slugs',
      ],
      [
        ['heavy', 0.012],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      400e3,
    ),
  ),
  opponent(
    1,
    'missile boat',
    specify(
      'Hornet',
      'frigate',
      [...FRIGATE, 'radiator-light', 'radiator-light', 'launcher', 'launcher', 'magazine-spike-12'],
      [
        ['heavy', 0.012],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      400e3,
    ),
  ),
  opponent(
    2,
    'particle beam brawler',
    specify(
      'Brand',
      'frigate',
      [...FRIGATE, 'radiator-light', 'radiator-light', 'charged-particle-beam'],
      [
        ['ablative', 0.08],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      400e3,
    ),
  ),
  opponent(
    2,
    'shielded laser brawler',
    specify(
      'Aegis',
      'frigate',
      [...FRIGATE, 'radiator-light', 'radiator-light', 'laser-500', 'magnetic-shield'],
      [
        ['ablative', 0.05],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      400e3,
    ),
  ),
  opponent(
    2,
    'laser picket with point defence',
    specify(
      'Picket',
      'frigate',
      [
        ...FRIGATE,
        'radiator-light',
        'radiator-light',
        'laser-500',
        'point-defence',
        'point-defence',
        'magazine-rounds',
      ],
      [
        ['ablative', 0.01],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      400e3,
    ),
  ),
  opponent(
    3,
    'laser cruiser',
    specify(
      'Paladin',
      'cruiser',
      [...CRUISER, 'radiator-heavy', 'radiator-heavy', 'laser-500', 'laser-500'],
      [
        ['heavy', 0.008],
        ['ablative', 0.015],
        ['ablative', 0.01],
      ],
      1_600e3,
    ),
  ),
  opponent(
    3,
    'missile and laser cruiser',
    specify(
      'Trident',
      'cruiser',
      [
        ...CRUISER,
        'radiator-heavy',
        'radiator-heavy',
        'launcher-fast',
        'launcher-fast',
        'magazine-spike-12',
        'laser-500',
        'laser-500',
      ],
      [
        ['heavy', 0.008],
        ['ablative', 0.02],
        ['ablative', 0.01],
      ],
      1_600e3,
    ),
  ),
];
