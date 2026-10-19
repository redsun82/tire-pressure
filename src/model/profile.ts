import { TRAILER, type Surface } from './coefficients';
import type { PressureInput } from './pressure';

export interface Profile {
  id: string;
  /** Bike name, e.g. "Grizl CF 9". */
  name: string;
  riderName: string;
  riderKg: number;
  bikeKg: number;
  /** Usual gear: bottles, tools, saddle bag, computer... */
  gearKg: number;
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
  /** null: no trailer for this bike. */
  trailer: { totalKg: number; tonguePct: number } | null;
  /** null: no rear bags for this bike. */
  bags: { kg: number } | null;
}

/** Things that change from ride to ride. */
export interface RideSettings {
  surface: Surface;
  wet: boolean;
  gearOffsetKg: number;
  trailer: boolean;
  bags: boolean;
}

export const SURFACES: readonly Surface[] = ['smooth', 'worn', 'rough', 'hardpack', 'loose'];

export const SEED_PROFILES: readonly Profile[] = [
  {
    id: 'seed-endurace',
    name: 'Endurace CF SLX 9 Di2',
    riderName: 'Me',
    riderKg: 75,
    bikeKg: 7.5,
    gearKg: 1,
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
    trailer: null,
    bags: null,
  },
  {
    id: 'seed-grizl',
    name: 'Grizl CF 9 ECLIPS',
    riderName: 'Me',
    riderKg: 75,
    bikeKg: 8.8,
    gearKg: 1,
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
    trailer: { totalKg: 25, tonguePct: TRAILER.defaultTonguePct },
    bags: { kg: 6 },
  },
];

export function defaultRide(profile: Profile): RideSettings {
  return {
    surface: profile.tubeless && profile.frontWidthMm >= 38 ? 'hardpack' : 'smooth',
    wet: false,
    gearOffsetKg: 0,
    trailer: false,
    bags: false,
  };
}

export function blankProfile(id: string): Profile {
  return {
    id,
    name: '',
    riderName: '',
    riderKg: 70,
    bikeKg: 9,
    gearKg: 1,
    frontWidthMm: 32,
    rearWidthMm: 32,
    innerRimMm: 21,
    tubeless: true,
    hookless: false,
    frontSharePct: 43,
    tireMinPsi: null,
    tireMaxPsi: null,
    rimMaxPsi: null,
    trailer: null,
    bags: null,
  };
}

export function trailerTongueKg(profile: Profile): number {
  return profile.trailer ? (profile.trailer.totalKg * profile.trailer.tonguePct) / 100 : 0;
}

export function toPressureInput(profile: Profile, ride: RideSettings): PressureInput {
  return {
    riderKg: profile.riderKg,
    bikeKg: profile.bikeKg,
    gearKg: Math.max(0, profile.gearKg + ride.gearOffsetKg),
    frontShare: profile.frontSharePct / 100,
    frontWidthMm: profile.frontWidthMm,
    rearWidthMm: profile.rearWidthMm,
    innerRimMm: profile.innerRimMm,
    tubeless: profile.tubeless,
    hookless: profile.hookless,
    surface: ride.surface,
    wet: ride.wet,
    trailerTongueKg: ride.trailer ? trailerTongueKg(profile) : 0,
    rearBagsKg: ride.bags && profile.bags ? profile.bags.kg : 0,
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
  const trailer = isObject(value.trailer)
    ? {
        totalKg: num(value.trailer, 'totalKg', 1, 100, 25),
        tonguePct: num(value.trailer, 'tonguePct', 0, 50, TRAILER.defaultTonguePct),
      }
    : null;
  const bags = isObject(value.bags) ? { kg: num(value.bags, 'kg', 0.5, 60, 6) } : null;
  return {
    id: value.id,
    name: str(value, 'name', base.name),
    riderName: str(value, 'riderName', base.riderName),
    riderKg: num(value, 'riderKg', 10, 200, base.riderKg),
    bikeKg: num(value, 'bikeKg', 2, 60, base.bikeKg),
    gearKg: num(value, 'gearKg', 0, 50, base.gearKg),
    frontWidthMm: num(value, 'frontWidthMm', 18, 80, base.frontWidthMm),
    rearWidthMm: num(value, 'rearWidthMm', 18, 80, base.rearWidthMm),
    innerRimMm: num(value, 'innerRimMm', 12, 45, base.innerRimMm),
    tubeless: bool(value, 'tubeless', base.tubeless),
    hookless: bool(value, 'hookless', base.hookless),
    frontSharePct: num(value, 'frontSharePct', 25, 60, base.frontSharePct),
    tireMinPsi: optNum(value, 'tireMinPsi', 5, 200),
    tireMaxPsi: optNum(value, 'tireMaxPsi', 5, 200),
    rimMaxPsi: optNum(value, 'rimMaxPsi', 5, 200),
    trailer,
    bags,
  };
}

export function normalizeRide(value: unknown, profile: Profile): RideSettings {
  const fallback = defaultRide(profile);
  if (!isObject(value)) return fallback;
  const surface = SURFACES.includes(value.surface as Surface) ? (value.surface as Surface) : fallback.surface;
  return {
    surface,
    wet: bool(value, 'wet', false),
    gearOffsetKg: num(value, 'gearOffsetKg', -50, 50, 0),
    trailer: profile.trailer !== null && bool(value, 'trailer', false),
    bags: profile.bags !== null && bool(value, 'bags', false),
  };
}
