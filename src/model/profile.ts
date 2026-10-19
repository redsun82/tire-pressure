import { TRAILER, type Surface } from './coefficients';
import type { PressureInput } from './pressure';

export interface Profile {
  id: string;
  /** Bike name, e.g. "Grizl CF 9". */
  name: string;
  riderName: string;
  riderKg: number;
  bikeKg: number;
  frontWidthMm: number;
  rearWidthMm: number;
  innerRimMm: number;
  tubeless: boolean;
  hookless: boolean;
  /** Share of rider + bike + gear on the front wheel, in percent. */
  frontSharePct: number;
  tireMinPsi: number | null;
  tireMaxPsi: number | null;
  rimMaxPsi: number | null;
  /** Share of the trailer + child weight that the hitch puts on the rear axle, in percent. */
  trailerTonguePct: number;
}

/**
 * Things that change from ride to ride, remembered per bike. Load weights are
 * kept separately from their on/off switches, so turning the trailer or bags
 * off and on again restores the last weight.
 */
export interface RideSettings {
  surface: Surface;
  wet: boolean;
  /** Bottles, tools, saddle bag, computer... split like the rider's weight. */
  gearKg: number;
  trailer: boolean;
  /** Trailer + child. */
  trailerKg: number;
  bags: boolean;
  /** Rear bags: all of it on the rear wheel. */
  bagsKg: number;
}

export const RIDE_DEFAULTS = {
  gearKg: 1,
  trailerKg: 25,
  bagsKg: 5,
} as const;

/** Input ranges shared by the ride screen steppers and data validation. */
export const LOAD_LIMITS = {
  gearKg: { min: 0, max: 30 },
  trailerKg: { min: 1, max: 100 },
  bagsKg: { min: 0.5, max: 60 },
} as const;

export const SURFACES: readonly Surface[] = ['smooth', 'worn', 'rough', 'hardpack', 'loose'];

export const SEED_PROFILES: readonly Profile[] = [
  {
    id: 'seed-endurace',
    name: 'Endurace CF SLX 9 Di2',
    riderName: 'Me',
    riderKg: 75,
    bikeKg: 7.5,
    // Schwalbe Pro One TLE
    frontWidthMm: 30,
    rearWidthMm: 34,
    // DT Swiss ARC 1100 DICUT: 22 mm inner, hooked
    innerRimMm: 22,
    tubeless: true,
    hookless: false,
    frontSharePct: 43,
    tireMinPsi: null,
    tireMaxPsi: null,
    rimMaxPsi: null,
    trailerTonguePct: TRAILER.defaultTonguePct,
  },
  {
    id: 'seed-grizl',
    name: 'Grizl CF 9 ECLIPS',
    riderName: 'Me',
    riderKg: 75,
    bikeKg: 8.8,
    // Schwalbe G-One RX Pro
    frontWidthMm: 45,
    rearWidthMm: 45,
    // DT Swiss GRC 1400 SPLINE: 24 mm inner, hookless
    innerRimMm: 24,
    tubeless: true,
    hookless: true,
    // chainstay 440 mm, wheelbase ~1100 mm
    frontSharePct: 42,
    tireMinPsi: null,
    tireMaxPsi: null,
    rimMaxPsi: null,
    trailerTonguePct: TRAILER.defaultTonguePct,
  },
];

export function defaultRide(profile: Profile): RideSettings {
  return {
    surface: profile.tubeless && profile.frontWidthMm >= 38 ? 'hardpack' : 'smooth',
    wet: false,
    gearKg: RIDE_DEFAULTS.gearKg,
    trailer: false,
    trailerKg: RIDE_DEFAULTS.trailerKg,
    bags: false,
    bagsKg: RIDE_DEFAULTS.bagsKg,
  };
}

export function blankProfile(id: string): Profile {
  return {
    id,
    name: '',
    riderName: '',
    riderKg: 70,
    bikeKg: 9,
    frontWidthMm: 32,
    rearWidthMm: 32,
    innerRimMm: 21,
    tubeless: true,
    hookless: false,
    frontSharePct: 43,
    tireMinPsi: null,
    tireMaxPsi: null,
    rimMaxPsi: null,
    trailerTonguePct: TRAILER.defaultTonguePct,
  };
}

/** Load the trailer hitch puts on the rear wheel (0 when the trailer is off). */
export function trailerTongueKg(profile: Profile, ride: RideSettings): number {
  return ride.trailer ? (ride.trailerKg * profile.trailerTonguePct) / 100 : 0;
}

export function toPressureInput(profile: Profile, ride: RideSettings): PressureInput {
  return {
    riderKg: profile.riderKg,
    bikeKg: profile.bikeKg,
    gearKg: ride.gearKg,
    frontShare: profile.frontSharePct / 100,
    frontWidthMm: profile.frontWidthMm,
    rearWidthMm: profile.rearWidthMm,
    innerRimMm: profile.innerRimMm,
    tubeless: profile.tubeless,
    hookless: profile.hookless,
    surface: ride.surface,
    wet: ride.wet,
    trailerTongueKg: trailerTongueKg(profile, ride),
    rearBagsKg: ride.bags ? ride.bagsKg : 0,
    tireMinPsi: profile.tireMinPsi,
    tireMaxPsi: profile.tireMaxPsi,
    rimMaxPsi: profile.rimMaxPsi,
  };
}

// ---------------------------------------------------------------------------
// Validation of untrusted data (localStorage, imported JSON)

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(raw: Raw, key: string, min: number, max: number, fallback: number): number {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function optNum(raw: Raw, key: string, min: number, max: number): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function str(raw: Raw, key: string, fallback: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value.slice(0, 60) : fallback;
}

function bool(raw: Raw, key: string, fallback: boolean): boolean {
  const value = raw[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeProfile(value: unknown): Profile | null {
  if (!isObject(value) || typeof value.id !== 'string' || value.id === '') return null;
  const base = blankProfile(value.id);
  return {
    id: value.id,
    name: str(value, 'name', base.name),
    riderName: str(value, 'riderName', base.riderName),
    riderKg: num(value, 'riderKg', 10, 200, base.riderKg),
    bikeKg: num(value, 'bikeKg', 2, 60, base.bikeKg),
    frontWidthMm: num(value, 'frontWidthMm', 18, 80, base.frontWidthMm),
    rearWidthMm: num(value, 'rearWidthMm', 18, 80, base.rearWidthMm),
    innerRimMm: num(value, 'innerRimMm', 12, 45, base.innerRimMm),
    tubeless: bool(value, 'tubeless', base.tubeless),
    hookless: bool(value, 'hookless', base.hookless),
    frontSharePct: num(value, 'frontSharePct', 25, 60, base.frontSharePct),
    tireMinPsi: optNum(value, 'tireMinPsi', 5, 200),
    tireMaxPsi: optNum(value, 'tireMaxPsi', 5, 200),
    rimMaxPsi: optNum(value, 'rimMaxPsi', 5, 200),
    trailerTonguePct: num(value, 'trailerTonguePct', 0, 50, base.trailerTonguePct),
  };
}

export function normalizeRide(value: unknown, profile: Profile): RideSettings {
  const fallback = defaultRide(profile);
  if (!isObject(value)) return fallback;
  const surface = SURFACES.includes(value.surface as Surface) ? (value.surface as Surface) : fallback.surface;
  return {
    surface,
    wet: bool(value, 'wet', false),
    gearKg: num(value, 'gearKg', 0, LOAD_LIMITS.gearKg.max, fallback.gearKg),
    trailer: bool(value, 'trailer', false),
    trailerKg: num(value, 'trailerKg', LOAD_LIMITS.trailerKg.min, LOAD_LIMITS.trailerKg.max, fallback.trailerKg),
    bags: bool(value, 'bags', false),
    bagsKg: num(value, 'bagsKg', LOAD_LIMITS.bagsKg.min, LOAD_LIMITS.bagsKg.max, fallback.bagsKg),
  };
}
