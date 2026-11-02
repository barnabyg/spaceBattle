import { KILOTON } from '../sim/design';

const grouped = (value: number, fractionDigits: number): string =>
  value.toLocaleString('en-GB', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

/** A distance given in metres, shown in km. */
export const formatKm = (metres: number, fractionDigits = 0): string =>
  `${grouped(metres / 1000, fractionDigits)} km`;

/** A speed given in m/s, shown in km/s. */
export const formatKmPerS = (metresPerSecond: number): string =>
  `${grouped(metresPerSecond / 1000, 2)} km/s`;

/** Elapsed battle time as T+hh:mm:ss. */
export const formatBattleTime = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `T+${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
};

/** A speed given in m/s, shown in m/s; for small differences such as a velocity error. */
export const formatMetresPerS = (metresPerSecond: number): string =>
  `${grouped(metresPerSecond, 1)} m/s`;

/** A length of time given in seconds, shown in its two largest units. */
export const formatDuration = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} s`;
  if (whole < 3600) return `${Math.floor(whole / 60)} min ${whole % 60} s`;
  return `${Math.floor(whole / 3600)} h ${Math.floor(whole / 60) % 60} min`;
};

/** A mass given in kg, shown in tonnes. */
export const formatTonnes = (kg: number): string =>
  `${(kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} t`;

/** A power given in W, shown in MW. */
export const formatMW = (watts: number): string => `${grouped(watts / 1e6, 0)} MW`;

/** An energy given in J, shown in GJ. */
export const formatGJ = (joules: number): string => `${grouped(joules / 1e9, 1)} GJ`;

/** An energy given in J, shown in kilotons of TNT, as nuclear yields are. */
export const formatKilotons = (joules: number): string =>
  `${(joules / KILOTON).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kt`;

/** A temperature in kelvin. */
export const formatKelvin = (kelvin: number): string => `${grouped(kelvin, 0)} K`;

/** A thickness given in metres, shown in mm. */
export const formatMm = (metres: number): string => `${grouped(metres * 1000, 0)} mm`;

/** A fraction from 0 to 1 as a whole percentage. */
export const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}%`;
