import { barToPsi } from './units';

/** Standard atmosphere: gauges read pressure above it. */
export const ATMOSPHERE_PSI = barToPsi(1.01325);
const ZERO_CELSIUS_K = 273.15;

/** Where the tire is pumped and where it is ridden, in °C. */
export interface Temperatures {
  pumpC: number;
  rideC: number;
}

/**
 * Gauge pressure at `toC` of a tire pumped to `psi` (gauge) at `fromC`. Ideal gas at constant
 * volume: absolute pressure scales with absolute temperature (the tire barely stretches).
 */
export function gaugeAtTemperature(psi: number, fromC: number, toC: number): number {
  return ((psi + ATMOSPHERE_PSI) * (toC + ZERO_CELSIUS_K)) / (fromC + ZERO_CELSIUS_K) - ATMOSPHERE_PSI;
}

/** What to pump to, so that the tire reads `ridePsi` at the ride temperature. */
export function pumpPsi(ridePsi: number, t: Temperatures): number {
  return gaugeAtTemperature(ridePsi, t.rideC, t.pumpC);
}

/** What a tire pumped to `pumpPsi` reads at the ride temperature. */
export function ridePsi(pumpPsi: number, t: Temperatures): number {
  return gaugeAtTemperature(pumpPsi, t.pumpC, t.rideC);
}

/** "20 °C", "−5 °C" (non-breaking space, typographic minus). */
export function formatCelsius(c: number): string {
  return `${c < 0 ? '\u2212' : ''}${Math.abs(c)}\u00a0°C`;
}
