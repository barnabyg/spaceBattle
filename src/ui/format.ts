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
