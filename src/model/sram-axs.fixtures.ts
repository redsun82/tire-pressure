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
    name: 'Endurace (75 kg / 8.5 kg, 30/34 mm, hooked 22 mm, road dry)',
    input: { ...base, riderKg: 75, bikeKg: 8.5, frontShare: 0.43, frontWidthMm: 30, rearWidthMm: 34, innerRimMm: 22, surface: 'smooth' },
    sram: { front: 59.2, rear: 53.2 },
    tolerance: ROAD,
  },
  {
    name: 'Endurace wet (75 kg / 8.5 kg, 30/34 mm, hooked 22 mm, road wet)',
    input: { ...base, riderKg: 75, bikeKg: 8.5, frontShare: 0.43, frontWidthMm: 30, rearWidthMm: 34, innerRimMm: 22, surface: 'smooth', wet: true },
    sram: { front: 53.3, rear: 47.9 },
    tolerance: ROAD,
  },
  {
    name: 'Grizl (75 kg / 9.8 kg, 45/45 mm, hookless 24 mm, gravel dry)',
    input: { ...base, riderKg: 75, bikeKg: 9.8, frontShare: 0.42, frontWidthMm: 45, rearWidthMm: 45, innerRimMm: 24, hookless: true, surface: 'hardpack' },
    sram: { front: 28.6, rear: 30.4 },
    tolerance: GRAVEL,
  },
  {
    name: 'Grizl on road (75 kg / 9.8 kg, 45/45 mm, hookless 24 mm, road dry)',
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
