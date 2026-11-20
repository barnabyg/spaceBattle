import { ARMOUR, armourMass } from './armour';
import { workingTotal } from './components';
import { designComponents, designComponentsOfType, type ArmourType, type Design } from './design';
import { HULLS } from './hull';

/** Simulated seconds to deploy radiators; cooling and exposure stay folded until ready. */
export const RADIATOR_DEPLOYMENT_TIME = 5;

/** σ, W/(m²·K⁴). */
export const STEFAN_BOLTZMANN = 5.670374419e-8;
/** Heat each kilogram of the dry ship stores per kelvin, J/(kg·K); the ship holds heat as a whole. */
export const SPECIFIC_HEAT = 500;
/**
 * Every ship starts a battle at this temperature, and its coolant loop never radiates below it,
 * K. The ship holds its heat, and radiates it, at a single temperature.
 */
export const BASE_TEMPERATURE = 300;
/** Above this temperature systems start to throttle back, K. */
export const OVERHEAT_TEMPERATURE = 1_000;
/** At this temperature systems are throttled right back to nothing, K. */
export const CUTOFF_TEMPERATURE = 1_200;
/**
 * Above this temperature components take damage, K. Systems are already throttled to nothing
 * by then, so only heat that keeps coming in, such as the reactor charging capacitors, gets here.
 */
export const DAMAGE_TEMPERATURE = 1_300;

/** A design's fixed thermal numbers. */
export interface ThermalProperties {
  /** J/K */
  readonly heatCapacity: number;
  /** Radiating area, m². */
  readonly area: { readonly deployed: number; readonly retracted: number };
  /** Emissivity times area summed over the radiators, m². */
  readonly emittance: { readonly deployed: number; readonly retracted: number };
}

const cache = new WeakMap<Design, ThermalProperties>();

export const thermalProperties = (design: Design): ThermalProperties => {
  const cached = cache.get(design);
  if (cached) return cached;
  const dryMass =
    HULLS[design.hullSize].structureMass +
    designComponents(design).reduce((total, { component }) => total + component.mass, 0) +
    design.sections.reduce((total, section) => total + armourMass(design, section), 0);
  const radiators = designComponentsOfType(design, 'radiator');
  const sum = (f: (r: (typeof radiators)[number]) => number) =>
    radiators.reduce((total, r) => total + f(r), 0);
  const result: ThermalProperties = {
    heatCapacity: SPECIFIC_HEAT * dryMass,
    area: { deployed: sum((r) => r.deployedArea), retracted: sum((r) => r.retractedArea) },
    emittance: {
      deployed: sum((r) => r.emissivity * r.deployedArea),
      retracted: sum((r) => r.emissivity * r.retractedArea),
    },
  };
  cache.set(design, result);
  return result;
};

/** Radiating area (m²) and emittance (εA, m²) the radiators have now, by their integrity. */
export const workingRadiators = (
  design: Design,
  integrity: readonly number[],
  deployed: boolean,
): { readonly area: number; readonly emittance: number } => {
  const area = (r: { deployedArea: number; retractedArea: number }) =>
    deployed ? r.deployedArea : r.retractedArea;
  return {
    area: workingTotal(design, integrity, 'radiator', area),
    emittance: workingTotal(design, integrity, 'radiator', (r) => r.emissivity * area(r)),
  };
};

/** Power radiated into space by a surface of emittance εA (m²) at temperature T: P = εσAT⁴, W. */
export const radiatedPower = (emittance: number, temperature: number): number =>
  emittance * STEFAN_BOLTZMANN * temperature ** 4;

/**
 * The fraction of their full power that systems may use at a temperature: all of it up to the
 * overheat temperature, falling linearly to none at the cutoff.
 */
export const thermalLimit = (temperature: number): number =>
  Math.min(
    1,
    Math.max(0, (CUTOFF_TEMPERATURE - temperature) / (CUTOFF_TEMPERATURE - OVERHEAT_TEMPERATURE)),
  );

/**
 * The beam intensity a kind of armour sheds by glowing at its `glowTemperature`, W/m²: what a
 * surface that hot radiates, εσT⁴. Below it the struck armour only glows; above it, only the
 * excess burns it away. About 0.38 MW/m² for heavy armour and 4.1 MW/m² for ablative.
 */
export const radiativeLimit = (type: ArmourType): number =>
  ARMOUR[type].emissivity * STEFAN_BOLTZMANN * ARMOUR[type].glowTemperature ** 4;

/**
 * The share of the beam energy armour sheds by glowing that soaks back into the ship's heat
 * through the hull behind the hot spot, for its radiators to shed; the rest the spot radiates
 * back out into space.
 */
export const GLOW_CONDUCTED_SHARE = 0.25;

/** A struck section's glowing surface cools back towards the ship's temperature over this, s. */
export const GLOW_COOLING_TIME = 20;

/**
 * The temperature a beam of `intensity` W/m² heats a surface of armour to while it sheds it, K:
 * where the surface radiates what lands, up to the armour's glow temperature, beyond which it
 * wears away instead of getting hotter.
 */
export const glowTemperature = (type: ArmourType, intensity: number): number =>
  Math.min(
    ARMOUR[type].glowTemperature,
    Math.max(BASE_TEMPERATURE, (intensity / (ARMOUR[type].emissivity * STEFAN_BOLTZMANN)) ** 0.25),
  );
