export const PSI_PER_BAR = 14.503773773;

export function psiToBar(psi: number): number {
  return psi / PSI_PER_BAR;
}

export function barToPsi(bar: number): number {
  return bar * PSI_PER_BAR;
}

/** Pressure limits that a displayed value must stay within (psi; null: no limit). */
export interface PsiLimits {
  minPsi: number | null;
  maxPsi: number | null;
}

/**
 * Rounds to the nearest step, unless that would cross a limit: a 72.52 psi hookless cap shows
 * "72", not "73", and a 49.88 psi result under a 49.9 psi tire maximum shows "49". The maximum
 * wins if the limits conflict.
 */
function roundWithin(value: number, decimals: number, min: number | null, max: number | null): number {
  const f = 10 ** decimals;
  // The epsilon keeps exact limits (e.g. 72 psi) from flipping due to float noise.
  const eps = 1e-9;
  let rounded = Math.round(value * f) / f;
  if (min !== null && rounded < min - eps) rounded = Math.ceil(min * f - eps) / f;
  if (max !== null && rounded > max + eps) rounded = Math.floor(max * f + eps) / f;
  return rounded;
}

const NO_LIMITS: PsiLimits = { minPsi: null, maxPsi: null };

/** Pumps and gauges are read to about 1 psi. */
export function formatPsi(psi: number, limits: PsiLimits = NO_LIMITS): string {
  return String(roundWithin(psi, 0, limits.minPsi, limits.maxPsi));
}

/** Two decimals by default: gauges in bar are usually read to 0.05 bar. */
export function formatBar(bar: number, limits: PsiLimits = NO_LIMITS, decimals = 2): string {
  const toBar = (psi: number | null) => (psi === null ? null : psiToBar(psi));
  return roundWithin(bar, decimals, toBar(limits.minPsi), toBar(limits.maxPsi)).toFixed(decimals);
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
