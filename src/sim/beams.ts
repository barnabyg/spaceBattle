import type { LaserDesign, ParticleBeamDesign } from './design';
import type { BeamKind } from './events';

/** A weapon that fires a beam: a laser, or a charged or neutral particle beam. */
export type BeamWeaponDesign = LaserDesign | ParticleBeamDesign;

/** m/s */
export const SPEED_OF_LIGHT = 299_792_458;
/** At rated input, a laser stores one second of electrical energy before a one-second burst. */
export const LASER_CHARGE_TIME = 1;
export const LASER_BURST_TIME = 1;
/** Charging continues during discharge: twice rated output for half the cycle preserves average power. */
export const LASER_BURST_POWER = 2;
/**
 * Beam weapons hold fire beyond the range where their beam's intensity falls below this, W/m²:
 * about a thousand suns, which takes most of an hour to burn through a few centimetres of armour.
 */
export const USEFUL_INTENSITY = 1e6;
/**
 * The share of a neutral particle beam's accelerated ions that come out of the stripping cell as
 * neutral atoms. Stripping the extra electron off a negative hydrogen ion leaves at best about
 * half of them neutral; the rest are stripped bare or keep their charge, and are swept into a
 * beam dump as heat.
 */
export const NEUTRAL_FRACTION = 0.5;

/** C */
const ELEMENTARY_CHARGE = 1.602_176_634e-19;
/** F/m */
const VACUUM_PERMITTIVITY = 8.854_187_8188e-12;
/** A proton's rest energy, mc², J. */
export const PROTON_REST_ENERGY = 1.503_277_618e-10;
/**
 * The current scale of a beam of protons, 4πε₀mc³/e, about 31 MA: a beam's own charge pushes it
 * apart in proportion to its current as a fraction of this.
 */
const PROTON_CHARACTERISTIC_CURRENT =
  (4 * Math.PI * VACUUM_PERMITTIVITY * SPEED_OF_LIGHT * PROTON_REST_ENERGY) / ELEMENTARY_CHARGE;
/** Newton's method stops once the spot radius changes by less than this fraction. */
const SPOT_TOLERANCE = 1e-12;
const SPOT_ITERATIONS = 100;

/** What kind of attack a beam weapon makes. */
export const beamKindOf = (weapon: BeamWeaponDesign): BeamKind => {
  switch (weapon.type) {
    case 'laser':
      return 'laser';
    case 'charged-particle-beam':
      return 'charged-particle';
    case 'neutral-particle-beam':
      return 'neutral-particle';
  }
};

/** The fraction of the electrical power a beam weapon draws that leaves in its beam (0–1). */
export const beamEfficiency = (weapon: BeamWeaponDesign): number =>
  weapon.type === 'neutral-particle-beam'
    ? weapon.efficiency * NEUTRAL_FRACTION
    : weapon.efficiency;

/** Rated electrical input at full integrity, W; lasers draw this while charging and bursting. */
export const beamWeaponPower = (weapon: BeamWeaponDesign): number =>
  weapon.beamPower / beamEfficiency(weapon);

/**
 * The generalised perveance of a charged particle beam, K = (2I/I₀)/(βγ)³: how hard its own
 * charge pushes it apart. Its current I is its power over each proton's energy per unit charge.
 * Faster protons push apart less, as the beam's own magnetic field nearly cancels their repulsion
 * and their greater momentum resists it.
 */
const perveance = (beam: Extract<ParticleBeamDesign, { type: 'charged-particle-beam' }>) => {
  const current = (beam.beamPower * ELEMENTARY_CHARGE) / beam.particleEnergy;
  const gamma = 1 + beam.particleEnergy / PROTON_REST_ENERGY;
  const betaGamma = Math.sqrt(gamma * gamma - 1);
  return (2 * current) / (PROTON_CHARACTERISTIC_CURRENT * betaGamma ** 3);
};

/**
 * The charged beam's angle of spread once it has widened from radius r₀ to r, rad. Its envelope
 * obeys r″ = K/r, so r′² = θ² + 2K·ln(r/r₀): the spread keeps growing as the beam widens.
 */
const bloomedSpread = (divergence: number, k: number, r0: number, r: number): number =>
  Math.sqrt(divergence ** 2 + 2 * k * Math.log(r / r0));

/**
 * Radius of a charged beam's spot at a range, m: the r for which r − r₀ = R·r′(r), r′ its spread
 * there (see `bloomedSpread`). This takes the beam as spreading at its final angle all the way,
 * a little wider than it is close in, and fair once it has grown several times its first width.
 * Solved by Newton's method from above, where the gap closes steadily.
 */
const chargedSpotRadius = (
  beam: Extract<ParticleBeamDesign, { type: 'charged-particle-beam' }>,
  range: number,
): number => {
  const r0 = beam.aperture / 2;
  if (!(range > 0)) return r0;
  const k = perveance(beam);
  const gap = (r: number) => r - r0 - range * bloomedSpread(beam.divergence, k, r0, r);
  // Start above the answer: double out from the cone without blooming until the gap opens.
  let r = r0 + range * beam.divergence;
  while (gap(r) < 0) r *= 2;
  for (let i = 0; i < SPOT_ITERATIONS; i++) {
    const slope = 1 - (range * k) / (r * bloomedSpread(beam.divergence, k, r0, r));
    const next = r - gap(r) / slope;
    if (!(next < r)) break;
    const settled = r - next < SPOT_TOLERANCE * r;
    r = next;
    if (settled) break;
  }
  return r;
};

/**
 * Radius of a beam's spot at a range, m. A laser's is set by diffraction: the Airy disc's first
 * dark ring, 1.22·λ·R/D, and never narrower than the mirror up close. A neutral particle beam
 * spreads in a straight-sided cone from its emitter, r₀ + θ·R. A charged particle beam also
 * blooms under its own charge, so it spreads faster the further it goes.
 */
export const spotRadius = (weapon: BeamWeaponDesign, range: number): number => {
  switch (weapon.type) {
    case 'laser':
      return Math.max(weapon.aperture / 2, (1.22 * weapon.wavelength * range) / weapon.aperture);
    case 'neutral-particle-beam':
      return weapon.aperture / 2 + weapon.divergence * range;
    case 'charged-particle-beam':
      return chargedSpotRadius(weapon, range);
  }
};

/** Effective range at rated power (a laser's sustained average), m; bursts do not extend it. */
export const effectiveRange = (weapon: BeamWeaponDesign): number => {
  const radius = Math.sqrt(weapon.beamPower / (Math.PI * USEFUL_INTENSITY));
  const r0 = weapon.aperture / 2;
  if (radius < r0) return 0;
  switch (weapon.type) {
    case 'laser':
      return (radius * weapon.aperture) / (1.22 * weapon.wavelength);
    case 'neutral-particle-beam':
      return (radius - r0) / weapon.divergence;
    case 'charged-particle-beam':
      return (radius - r0) / bloomedSpread(weapon.divergence, perveance(weapon), r0, radius);
  }
};
