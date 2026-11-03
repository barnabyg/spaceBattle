import type { ComponentDesign, MissileDesign } from '../sim/design';

/** A component model the shipyard offers, by name. */
export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly component: ComponentDesign;
}

const SPIKE: MissileDesign = {
  name: 'Spike',
  dryMass: 1500,
  propellantMass: 2500,
  thrust: 150e3,
  exhaustVelocity: 25e3,
  warhead: { type: 'kinetic' },
};

const EMBER: MissileDesign = {
  name: 'Ember',
  dryMass: 1500,
  propellantMass: 2500,
  thrust: 150e3,
  exhaustVelocity: 25e3,
  warhead: { type: 'nuclear', yield: 41.84e12, detonationDistance: 1000 },
};

const WASP: MissileDesign = {
  name: 'Wasp',
  dryMass: 150,
  propellantMass: 150,
  thrust: 60e3,
  exhaustVelocity: 20e3,
  warhead: {
    type: 'fragmentation',
    fragments: 8000,
    fragmentMass: 0.004,
    burstDistance: 100,
    spread: 0.25,
  },
};

/**
 * The component models the shipyard offers, roughly by type. The frigate-sized models are those
 * the hand-made designs carry; the larger ones scale them up for cruisers and battleships.
 */
export const COMPONENT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'drive-light',
    name: 'Light drive',
    component: {
      type: 'drive',
      mass: 80e3,
      thrust: 2e6,
      exhaustVelocity: 150e3,
      power: 1.5e9,
      wasteHeatFraction: 0.1,
    },
  },
  {
    id: 'drive-medium',
    name: 'Medium drive',
    component: {
      type: 'drive',
      mass: 300e3,
      thrust: 6e6,
      exhaustVelocity: 130e3,
      power: 4e9,
      wasteHeatFraction: 0.1,
    },
  },
  {
    id: 'drive-heavy',
    name: 'Heavy drive',
    component: {
      type: 'drive',
      mass: 900e3,
      thrust: 18e6,
      exhaustVelocity: 120e3,
      power: 11e9,
      wasteHeatFraction: 0.1,
    },
  },
  {
    id: 'thrusters-light',
    name: 'Light thrusters',
    component: { type: 'thrusters', mass: 20e3, torque: 8e6 },
  },
  {
    id: 'thrusters-medium',
    name: 'Medium thrusters',
    component: { type: 'thrusters', mass: 80e3, torque: 60e6 },
  },
  {
    id: 'thrusters-heavy',
    name: 'Heavy thrusters',
    component: { type: 'thrusters', mass: 250e3, torque: 400e6 },
  },
  {
    id: 'reactor-light',
    name: 'Light reactor',
    component: { type: 'reactor', mass: 40e3, output: 2e9, efficiency: 0.75 },
  },
  {
    id: 'reactor-medium',
    name: 'Medium reactor',
    component: { type: 'reactor', mass: 120e3, output: 5e9, efficiency: 0.75 },
  },
  {
    id: 'reactor-heavy',
    name: 'Heavy reactor',
    component: { type: 'reactor', mass: 330e3, output: 15e9, efficiency: 0.75 },
  },
  {
    id: 'capacitor-light',
    name: 'Light capacitor',
    component: {
      type: 'capacitor',
      mass: 10e3,
      capacity: 20e9,
      maxCharge: 0.5e9,
      maxDischarge: 5e9,
    },
  },
  {
    id: 'capacitor-heavy',
    name: 'Heavy capacitor',
    component: {
      type: 'capacitor',
      mass: 30e3,
      capacity: 60e9,
      maxCharge: 1.5e9,
      maxDischarge: 15e9,
    },
  },
  {
    id: 'radiator-light',
    name: 'Light radiator',
    component: {
      type: 'radiator',
      mass: 15e3,
      deployedArea: 12e3,
      retractedArea: 600,
      emissivity: 0.9,
    },
  },
  {
    id: 'radiator-heavy',
    name: 'Heavy radiator',
    component: {
      type: 'radiator',
      mass: 45e3,
      deployedArea: 22e3,
      retractedArea: 1600,
      emissivity: 0.9,
    },
  },
  {
    id: 'laser-400',
    name: 'Laser, 400 MW',
    component: {
      type: 'laser',
      mass: 25e3,
      beamPower: 400e6,
      efficiency: 0.4,
      aperture: 4,
      wavelength: 250e-9,
    },
  },
  {
    id: 'laser-500',
    name: 'Laser, 500 MW',
    component: {
      type: 'laser',
      mass: 30e3,
      beamPower: 500e6,
      efficiency: 0.4,
      aperture: 4,
      wavelength: 250e-9,
    },
  },
  {
    id: 'charged-particle-beam',
    name: 'Charged particle beam',
    component: {
      type: 'charged-particle-beam',
      mass: 40e3,
      beamPower: 800e6,
      efficiency: 0.5,
      aperture: 1,
      divergence: 1e-7,
      particleEnergy: 4e-9,
    },
  },
  {
    id: 'neutral-particle-beam',
    name: 'Neutral particle beam',
    component: {
      type: 'neutral-particle-beam',
      mass: 40e3,
      beamPower: 300e6,
      efficiency: 0.5,
      aperture: 1,
      divergence: 5e-8,
    },
  },
  {
    id: 'kinetic-gun',
    name: 'Kinetic gun',
    component: {
      type: 'kinetic-gun',
      mass: 25e3,
      slugMass: 5,
      muzzleVelocity: 30e3,
      efficiency: 0.5,
      rateOfFire: 0.1,
    },
  },
  {
    id: 'point-defence',
    name: 'Point defence',
    component: {
      type: 'point-defence',
      mass: 8e3,
      roundMass: 0.05,
      muzzleVelocity: 5e3,
      efficiency: 0.5,
      roundsPerBurst: 20,
      burstRate: 5,
      dispersion: 0.002,
    },
  },
  {
    id: 'launcher',
    name: 'Launcher',
    component: { type: 'launcher', mass: 8e3, reloadTime: 30 },
  },
  {
    id: 'launcher-fast',
    name: 'Fast launcher',
    component: { type: 'launcher', mass: 8e3, reloadTime: 20 },
  },
  {
    id: 'sensor-4',
    name: 'Sensor, 4 m',
    component: { type: 'sensor', mass: 4e3, aperture: 4, wavelength: 50e-9, trackingError: 3e-9 },
  },
  {
    id: 'sensor-6',
    name: 'Sensor, 6 m',
    component: { type: 'sensor', mass: 8e3, aperture: 6, wavelength: 50e-9, trackingError: 2e-9 },
  },
  {
    id: 'magazine-slugs',
    name: 'Magazine, 600 slugs',
    component: { type: 'magazine', mass: 12e3, slugs: 600, rounds: 0, missiles: 0, missile: null },
  },
  {
    id: 'magazine-rounds',
    name: 'Magazine, 40,000 rounds',
    component: {
      type: 'magazine',
      mass: 3e3,
      slugs: 0,
      rounds: 40_000,
      missiles: 0,
      missile: null,
    },
  },
  {
    id: 'magazine-spike-6',
    name: 'Magazine, 6 Spike missiles',
    component: { type: 'magazine', mass: 28e3, slugs: 0, rounds: 0, missiles: 6, missile: SPIKE },
  },
  {
    id: 'magazine-spike-12',
    name: 'Magazine, 12 Spike missiles',
    component: { type: 'magazine', mass: 56e3, slugs: 0, rounds: 0, missiles: 12, missile: SPIKE },
  },
  {
    id: 'magazine-ember-8',
    name: 'Magazine, 8 Ember nuclear missiles',
    component: { type: 'magazine', mass: 38e3, slugs: 0, rounds: 0, missiles: 8, missile: EMBER },
  },
  {
    id: 'magazine-wasp-16',
    name: 'Magazine, 16 Wasp anti-missile missiles',
    component: { type: 'magazine', mass: 6e3, slugs: 0, rounds: 0, missiles: 16, missile: WASP },
  },
  {
    id: 'magnetic-shield',
    name: 'Magnetic shield',
    component: { type: 'magnetic-shield', mass: 30e3, power: 200e6, maxParticleEnergy: 3e-9 },
  },
  {
    id: 'coolant-shield',
    name: 'Coolant shield',
    component: { type: 'coolant-shield', mass: 15e3, power: 30e6, capacity: 300e6 },
  },
  {
    id: 'long-range-scanner',
    name: 'Long-range scanner',
    component: { type: 'long-range-scanner', mass: 20e3 },
  },
  {
    id: 'signal-interceptor-basic',
    name: 'Signal interceptor, basic',
    component: { type: 'signal-interceptor', mass: 6e3, quality: 0.3 },
  },
  {
    id: 'signal-interceptor-advanced',
    name: 'Signal interceptor, advanced',
    component: { type: 'signal-interceptor', mass: 15e3, quality: 0.7 },
  },
];

/** A catalogue component by id. */
export const catalogueComponent = (id: string): ComponentDesign => {
  const entry = COMPONENT_CATALOGUE.find((e) => e.id === id);
  if (!entry) throw new Error(`No component "${id}" in the catalogue`);
  return entry.component;
};

/** A component's data as text with its keys in order, so equal components give equal text. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

const byData = new Map(COMPONENT_CATALOGUE.map((entry) => [canonical(entry.component), entry]));

/** The catalogue entry a component is, if it is one of the catalogue's models exactly. */
export const catalogueEntryOf = (component: ComponentDesign): CatalogueEntry | null =>
  byData.get(canonical(component)) ?? null;

/** Whether two components are the same model: equal in every number. */
export const sameComponent = (a: ComponentDesign, b: ComponentDesign): boolean =>
  canonical(a) === canonical(b);
