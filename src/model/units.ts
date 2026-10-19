export const PSI_PER_BAR = 14.503773773;

export function psiToBar(psi: number): number {
  return psi / PSI_PER_BAR;
}

export function barToPsi(bar: number): number {
  return bar * PSI_PER_BAR;
}

/**
 * Rounding direction for displayed values. A value clamped to a maximum must never be shown
 * above it (72.5 psi hookless cap -> "72", not "73"), and one raised to a minimum never below it.
 */
export type Rounding = 'nearest' | 'down' | 'up';

const ROUND: Record<Rounding, (x: number) => number> = { nearest: Math.round, down: Math.floor, up: Math.ceil };

function roundTo(value: number, decimals: number, mode: Rounding): number {
  const f = 10 ** decimals;
  // The epsilon keeps exact values (e.g. 72 psi) from flipping due to float noise.
  const eps = mode === 'down' ? 1e-9 : mode === 'up' ? -1e-9 : 0;
  return ROUND[mode](value * f + eps) / f;
}

/** Pumps and gauges are read to about 1 psi. */
export function formatPsi(psi: number, mode: Rounding = 'nearest'): string {
  return String(roundTo(psi, 0, mode));
}

/** Two decimals: gauges in bar are usually read to 0.05 bar. */
export function formatBar(bar: number, mode: Rounding = 'nearest'): string {
  return roundTo(bar, 2, mode).toFixed(2);
}

/** Rounding that keeps a clamped value on the safe side of its limit. */
export function roundingFor(clamped: 'min' | 'max' | null): Rounding {
  return clamped === 'max' ? 'down' : clamped === 'min' ? 'up' : 'nearest';
}

export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Accepts both "7.5" and "7,5". Returns NaN for anything else. */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}
