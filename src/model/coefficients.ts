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
 * Basis: the pressure at which the tire compresses ~15% of its height under
 * the wheel's load ("15% tire drop"), the rule of thumb from Frank Berto's
 * measurements published in Bicycle Quarterly and summarised by Rene Herse:
 * https://www.renehersecycles.com/finding-the-perfect-tire-pressure/
 *
 * Shape: Berto published a chart, not a formula. A widely circulated community
 * curve fit of that chart is
 *
 *     P_psi = 153.6 · L_lb / W_mm^1.5785 − 7.1685
 *
 * (an approximation we could not re-verify against the original chart). We
 * keep its steep width dependence but use a sub-linear load exponent a = 0.8
 * instead of its linear-with-offset form, which drives lightly loaded wide
 * tires to implausibly low pressures (~14 psi for a 45 mm front at 25 kg).
 *
 * Calibration: k and b are fitted to six outputs of the
 * SRAM AXS calculator (src/model/sram-axs.fixtures.ts, retrieved 2026-10-19),
 * minimising the worst deviation of our front/rear mean from SRAM's, with
 * a = 0.8, our own front/rear split and surface multipliers held fixed.
 * Result: k = 870, b = 1.65, every case within 4% of SRAM's mean (allowed:
 * 7% road, 10% gravel). b = 1.65 is close to the community fit's 1.58.
 * The previous Berto-only anchoring (k = 1490, b = 1.82) ran 2–14% low,
 * most on wide tires.
 */
export const BASE = {
  k: 870,
  a: 0.8,
  b: 1.65,
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

/**
 * Wheel size: BASE is calibrated on 700c wheels (bead seat diameter 622 mm).
 * At the same tire drop, a smaller wheel has a shorter contact patch, so it
 * needs more pressure to carry the same load.
 *
 * Basis: the tire touches the ground in a patch that is roughly an ellipse.
 * For a drop d, its length is about 2·√(D·d) for an outer wheel diameter D,
 * and its width about 2·√(H·d) for a tire height H, so its area is about
 * π·d·√(D·H). The air pressure carries the load over that area, so at the
 * same relative drop the pressure scales with 1/√D. (The same reasoning gives
 * pressure ∝ 1/H^1.5 for the width, close to the fitted BASE.b = 1.65.)
 *
 * Factor, relative to a 700c wheel with the same tire, so it is exactly 1 at 622:
 *
 *     √((622 + 2·H) / (BSD + 2·H)),   H ≈ effective width
 *
 * About +3% (1 psi at gravel pressures) for 650b, +20% for 20 × 1.75″ and +35%
 * for 16 × 1.75″. The SRAM AXS calculator raises pressure more for smaller wheels
 * (about +8% for 650b, +13% for 26″), see src/model/sram-axs.fixtures.ts.
 */
export const WHEEL = {
  /** The bead seat diameter (ETRTO) BASE is calibrated on: 700c / 29″. */
  referenceBsdMm: 622,
  /** Tire height as a fraction of its effective width: modern tires are about as tall as wide. */
  heightPerWidth: 1,
  /** Pressure ∝ (outer diameter)^−exponent at the same relative tire drop. */
  exponent: 0.5,
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
