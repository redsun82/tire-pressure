/**
 * Every tunable number of the pressure model lives in this module, so the
 * model can be reviewed (and re-fitted) in one place. See README.md for the
 * same explanation in prose.
 *
 * Units: loads in kg (per wheel), widths in mm, pressures in psi.
 */

import { PSI_PER_BAR } from './units';

/**
 * Base pressure: P = k · L^a / W^b
 *
 * - L: load on that wheel in kg
 * - W: effective (as-mounted) tire width in mm
 *
 * Target: the pressure at which the tire compresses ~15% of its height under
 * the wheel's load ("15% tire drop"), the rule of thumb from Frank Berto's
 * measurements published in Bicycle Quarterly and summarised by Rene Herse:
 * https://www.renehersecycles.com/finding-the-perfect-tire-pressure/
 *
 * Fit: Berto published his result as a chart, not a formula. A widely
 * circulated community curve fit of that chart is
 *
 *     P_psi = 153.6 · L_lb / W_mm^1.5785 − 7.1685
 *
 * We did not derive that fit ourselves and could not re-verify it against the
 * original chart, so treat it as an approximation of an approximation. We
 * anchored our power law on it at a wheel load of 45 kg (a typical rear
 * wheel), where it gives:
 *
 *     W = 28 mm → 72.0 psi    W = 35 mm → 48.5 psi    W = 45 mm → 30.3 psi
 *
 * Solving for b with the 28/35/45 mm anchors gives b ≈ 1.77–1.87; we use 1.82.
 * k is then set so that 35 mm at 45 kg is 48.5 psi:
 *
 *     k = 48.5 · 35^1.82 / 45^0.8 ≈ 1490
 *
 * Load exponent a: Berto's fit is close to linear in load with a negative
 * offset, which drives very low pressures for lightly loaded wide tires (e.g.
 * ~14 psi for a 45 mm front tire carrying 25 kg). We deliberately use a
 * sub-linear exponent of 0.8, which matches the anchors at 45 kg and stays
 * closer to how published calculators and riders treat front/rear and
 * light/heavy riders. At 30 kg / 35 mm the model is ~17% above the Berto fit,
 * at 60 kg / 35 mm ~9% below it.
 */
export const BASE = {
  k: 1490,
  a: 0.8,
  b: 1.82,
  /** The tire drop the base formula targets (fraction of tire height). */
  targetDrop: 0.15,
} as const;

/** The community fit of Berto's 15% drop chart used to anchor BASE. */
export function bertoCommunityFitPsi(loadKg: number, widthMm: number): number {
  const loadLb = loadKg / 0.45359237;
  return (153.6 * loadLb) / widthMm ** 1.5785 - 7.1685;
}

/**
 * As-mounted width: a tire measures wider on a wider rim. The usual rule of
 * thumb (from ETRTO-based measurements published by tire makers and
 * bicyclerollingresistance.com) is ~0.4 mm of tire width per mm of inner rim
 * width, relative to the rim the nominal width is specified on.
 */
export const RIM = {
  widthGainPerMm: 0.4,
  /**
   * Inner rim width at which the nominal width is assumed to be measured.
   * Approximates current ETRTO practice: road tires on 19 mm, wider road and
   * narrow gravel tires on 21 mm, wide gravel tires on 23 mm.
   */
  referenceInnerWidth(nominalWidthMm: number): number {
    if (nominalWidthMm <= 32) return 19;
    if (nominalWidthMm <= 42) return 21;
    return 23;
  },
} as const;

export type Surface = 'smooth' | 'worn' | 'rough' | 'hardpack' | 'loose';

/**
 * Surface "breakpoint" multipliers. On rough surfaces the extra pressure that
 * reduces casing losses starts to cost more in suspension losses (bouncing
 * the rider), so the fastest pressure drops as roughness increases. This is
 * the finding of the Silca, Rene Herse/Bicycle Quarterly and
 * bicyclerollingresistance.com roll-down tests; the exact values are our own
 * conservative choice, not copied from any calculator.
 */
export const SURFACE: Record<Surface, number> = {
  smooth: 1.0, // new, smooth tarmac
  worn: 0.94, // average, patched tarmac
  rough: 0.87, // chipseal, broken tarmac, cobbles
  hardpack: 0.9, // smooth, compacted gravel
  loose: 0.82, // loose or chunky gravel
};

export const CONDITIONS = {
  /** Wet roads: slightly lower pressure for a larger contact patch / grip. */
  wet: 0.95,
  /**
   * Inner tubes: tire drop is the same, but tubes can pinch-flat, so we add a
   * small margin. Tubeless is the baseline (1.0).
   */
  tube: 1.05,
} as const;

export const LIMITS = {
  /** ETRTO / ISO limit for hookless (tubeless straight side) rims: 5 bar (~72.5 psi). */
  hooklessMaxPsi: 5 * PSI_PER_BAR,
  /** Above this estimated drop the rim can bottom out on hits: warn. */
  maxDropWarning: 0.2,
  /** With tubes, warn earlier: pinch flats happen before rim damage. */
  maxDropWarningTube: 0.18,
  /** Very low absolute pressure: remind the user to check the tire minimum. */
  lowPsiWarning: 18,
  /** Front share outside this range is probably a typo. */
  frontShareMin: 0.3,
  frontShareMax: 0.55,
} as const;

/** Default share of the trailer + child weight carried by the hitch. */
export const TRAILER = {
  defaultTonguePct: 10,
} as const;
