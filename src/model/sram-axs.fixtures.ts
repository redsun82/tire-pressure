import type { PressureInput } from './pressure';

/**
 * Outputs of the SRAM AXS tire pressure calculator (https://axs.sram.com/guides/tire/pressure),
 * retrieved 2026-10-19 with: Standard casing, 700c, weights in kg, results in psi.
 *
 * SRAM's maths is proprietary; we use these numbers only to cross-check and calibrate our own
 * model (see CALIBRATION in coefficients.ts), never to reproduce SRAM's formula.
 *
 * Mapping to our inputs:
 * - SRAM "Road" → our smooth tarmac, SRAM "Gravel" → our hardpack gravel.
 * - SRAM takes one system weight; we split it with our own front share (bike profile, or 43%
 *   road / 42% gravel for the generic cases).
 * - All cases are compared as tubeless.
 */
export interface SramCase {
  name: string;
  input: PressureInput;
  sram: { front: number; rear: number };
  /** Allowed deviation of our front/rear mean from SRAM's mean (fraction). */
  tolerance: number;
}

const base = {
  wheelBsdMm: 622,
  gearKg: 0,
  tubeless: true,
  hookless: false,
  wet: false,
  trailerTongueKg: 0,
  rearBagsKg: 0,
} as const;

const ROAD = 0.07;
const GRAVEL = 0.1;

export const SRAM_AXS_CASES: readonly SramCase[] = [
  {
    name: 'Road bike (75 kg / 8.5 kg, 30/34 mm, hooked 22 mm, road dry)',
    input: { ...base, riderKg: 75, bikeKg: 8.5, frontShare: 0.43, frontWidthMm: 30, rearWidthMm: 34, innerRimMm: 22, surface: 'smooth' },
    sram: { front: 59.2, rear: 53.2 },
    tolerance: ROAD,
  },
  {
    name: 'Road bike wet (75 kg / 8.5 kg, 30/34 mm, hooked 22 mm, road wet)',
    input: { ...base, riderKg: 75, bikeKg: 8.5, frontShare: 0.43, frontWidthMm: 30, rearWidthMm: 34, innerRimMm: 22, surface: 'smooth', wet: true },
    sram: { front: 53.3, rear: 47.9 },
    tolerance: ROAD,
  },
  {
    name: 'Gravel bike (75 kg / 9.8 kg, 45/45 mm, hookless 24 mm, gravel dry)',
    input: { ...base, riderKg: 75, bikeKg: 9.8, frontShare: 0.42, frontWidthMm: 45, rearWidthMm: 45, innerRimMm: 24, hookless: true, surface: 'hardpack' },
    sram: { front: 28.6, rear: 30.4 },
    tolerance: GRAVEL,
  },
  {
    name: 'Gravel bike on road (75 kg / 9.8 kg, 45/45 mm, hookless 24 mm, road dry)',
    input: { ...base, riderKg: 75, bikeKg: 9.8, frontShare: 0.42, frontWidthMm: 45, rearWidthMm: 45, innerRimMm: 24, hookless: true, surface: 'smooth' },
    sram: { front: 31.8, rear: 33.8 },
    tolerance: ROAD,
  },
  {
    name: '28 mm reference (70 kg / 8 kg, 28/28 mm, hooked 21 mm, road dry)',
    input: { ...base, riderKg: 70, bikeKg: 8, frontShare: 0.43, frontWidthMm: 28, rearWidthMm: 28, innerRimMm: 21, surface: 'smooth' },
    sram: { front: 61.7, rear: 65.6 },
    tolerance: ROAD,
  },
  {
    name: 'Heavy rider (100 kg / 9 kg, 32/32 mm, hooked 21 mm, road dry)',
    input: { ...base, riderKg: 100, bikeKg: 9, frontShare: 0.43, frontWidthMm: 32, rearWidthMm: 32, innerRimMm: 21, surface: 'smooth' },
    sram: { front: 62.7, rear: 66.7 },
    tolerance: ROAD,
  },
];

/**
 * Not used for calibration: SRAM appears to floor its output around 30 psi whatever the load,
 * so a light rider gets nearly adult pressures. We test that our model goes clearly lower.
 */
export const SRAM_AXS_KID: SramCase = {
  name: 'Kid (35 kg / 10 kg, 40/40 mm, hooked 21 mm, gravel dry)',
  input: { ...base, riderKg: 35, bikeKg: 10, frontShare: 0.42, frontWidthMm: 40, rearWidthMm: 40, innerRimMm: 21, surface: 'hardpack' },
  sram: { front: 29.6, rear: 31.5 },
  tolerance: GRAVEL,
};

/**
 * The same inputs on a smaller wheel and on 700c, retrieved 2026-10-19 like the cases above
 * (Standard casing, kg, psi; Road, Gravel or MTB Cross Country, dry). SRAM only offers 559, 571,
 * 584 and 622 mm wheels, so there are no 24″ or 20″ references. Road/Gravel only offer 650b
 * besides 700c, MTB only 26″, so the 26″ cases use MTB Cross Country, whose numbers don't map
 * to our surfaces: only the ratio between the two wheel sizes is compared.
 */
export interface SramWheelSizeCase {
  name: string;
  /** On the smaller wheel; the 700c reference is the same input with `wheelBsdMm: 622`. */
  input: PressureInput;
  sram: { front: number; rear: number };
  sram700c: { front: number; rear: number };
}

const MTB_2_2_INCH = 56;

export const SRAM_AXS_WHEEL_SIZES: readonly SramWheelSizeCase[] = [
  {
    name: 'Gravel bike on 650b (75 kg / 9.8 kg, 45/45 mm, hookless 24 mm, gravel dry)',
    input: { ...base, wheelBsdMm: 584, riderKg: 75, bikeKg: 9.8, frontShare: 0.42, frontWidthMm: 45, rearWidthMm: 45, innerRimMm: 24, hookless: true, surface: 'hardpack' },
    sram: { front: 30.9, rear: 32.8 },
    sram700c: { front: 28.6, rear: 30.4 },
  },
  {
    name: '650b × 47 (75 kg / 9.8 kg, 47/47 mm, hooked 24 mm, gravel dry)',
    input: { ...base, wheelBsdMm: 584, riderKg: 75, bikeKg: 9.8, frontShare: 0.42, frontWidthMm: 47, rearWidthMm: 47, innerRimMm: 24, surface: 'hardpack' },
    sram: { front: 32.1, rear: 34.1 },
    sram700c: { front: 29.7, rear: 31.6 },
  },
  {
    name: 'Road bike on 650b (75 kg / 8.5 kg, 30/34 mm, hooked 22 mm, road dry)',
    input: { ...base, wheelBsdMm: 584, riderKg: 75, bikeKg: 8.5, frontShare: 0.43, frontWidthMm: 30, rearWidthMm: 34, innerRimMm: 22, surface: 'smooth' },
    sram: { front: 64.0, rear: 57.5 },
    sram700c: { front: 59.2, rear: 53.2 },
  },
  {
    name: 'Kid on 650b (35 kg / 10 kg, 40/40 mm, hooked 21 mm, gravel dry)',
    input: { ...base, wheelBsdMm: 584, riderKg: 35, bikeKg: 10, frontShare: 0.42, frontWidthMm: 40, rearWidthMm: 40, innerRimMm: 21, surface: 'hardpack' },
    sram: { front: 32.0, rear: 34.0 },
    sram700c: { front: 29.6, rear: 31.5 },
  },
  {
    name: '26″ MTB (75 kg / 11 kg, 2.2″ = 56 mm, hooked 25 mm, MTB Cross Country dry)',
    input: { ...base, wheelBsdMm: 559, riderKg: 75, bikeKg: 11, frontShare: 0.42, frontWidthMm: MTB_2_2_INCH, rearWidthMm: MTB_2_2_INCH, innerRimMm: 25, surface: 'hardpack' },
    sram: { front: 26.2, rear: 27.9 },
    sram700c: { front: 23.1, rear: 24.6 },
  },
  {
    name: 'Kid on 26″ MTB (35 kg / 11 kg, 2.2″ = 56 mm, hooked 25 mm, MTB Cross Country dry)',
    input: { ...base, wheelBsdMm: 559, riderKg: 35, bikeKg: 11, frontShare: 0.42, frontWidthMm: MTB_2_2_INCH, rearWidthMm: MTB_2_2_INCH, innerRimMm: 25, surface: 'hardpack' },
    sram: { front: 20.6, rear: 21.9 },
    sram700c: { front: 18.1, rear: 19.3 },
  },
];
