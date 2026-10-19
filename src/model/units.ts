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

// Keeps exact limits (e.g. 72 psi) from flipping due to float noise.
const EPS = 1e-9;
/** How many extra decimals to try when no display step fits between the limits. */
const EXTRA_DECIMALS = 3;

function roundOnce(value: number, decimals: number, min: number | null, max: number | null): number {
  const f = 10 ** decimals;
  let rounded = Math.round(value * f) / f;
  if (min !== null && rounded < min - EPS) rounded = Math.ceil(min * f - EPS) / f;
  if (max !== null && rounded > max + EPS) rounded = Math.floor(max * f + EPS) / f;
  return rounded;
}

/**
 * Rounds to the nearest step, unless that would cross a limit: a 72.52 psi hookless cap shows
 * "72", not "73", and a 49.88 psi result under a 49.9 psi tire maximum shows "49". When no step
 * fits between the limits (min 30.2, max 30.4), it adds decimals ("30.3"). If the limits
 * conflict, the maximum wins.
 */
function roundWithin(value: number, decimals: number, min: number | null, max: number | null): { value: number; decimals: number } {
  const within = (v: number) => (min === null || v >= min - EPS) && (max === null || v <= max + EPS);
  if (min === null || max === null || min <= max + EPS) {
    for (let d = decimals; d <= decimals + EXTRA_DECIMALS; d++) {
      const rounded = roundOnce(value, d, min, max);
      if (within(rounded)) return { value: rounded, decimals: d };
    }
  }
  return { value: roundOnce(value, decimals, min, max), decimals };
}

const NO_LIMITS: PsiLimits = { minPsi: null, maxPsi: null };

/** Pumps and gauges are read to about 1 psi. */
export function formatPsi(psi: number, limits: PsiLimits = NO_LIMITS): string {
  return String(roundWithin(psi, 0, limits.minPsi, limits.maxPsi).value);
}

/** Two decimals by default: gauges in bar are usually read to 0.05 bar. */
export function formatBar(bar: number, limits: PsiLimits = NO_LIMITS, decimals = 2): string {
  const toBar = (psi: number | null) => (psi === null ? null : psiToBar(psi));
  const rounded = roundWithin(bar, decimals, toBar(limits.minPsi), toBar(limits.maxPsi));
  return rounded.value.toFixed(rounded.decimals);
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
