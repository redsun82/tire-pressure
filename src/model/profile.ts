import { TRAILER, WHEEL, type Surface } from './coefficients';
import type { PressureInput } from './pressure';

export interface Profile {
  id: string;
  /** Bike name, e.g. "Grizl CF 9". */
  name: string;
  riderName: string;
  riderKg: number;
  bikeKg: number;
  /** Wheel size as the ETRTO bead seat diameter, one of {@link WHEEL_SIZES}. */
  wheelBsdMm: number;
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
  /** Whether the ride screen offers the kid trailer and rear bags for this bike. */
  canTowTrailer: boolean;
  canCarryBags: boolean;
  /** Share of the trailer + child weight that the hitch puts on the rear axle, in percent. */
  trailerTonguePct: number;
  /** Raises or lowers both wheels by this percentage, for the tire casing or ride feel. 0: as modelled. */
  correctionPct: number;
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
  /** Pumped at a different temperature than ridden at; the temperatures are kept while off. */
  temperature: boolean;
  pumpC: number;
  rideC: number;
}

export const RIDE_DEFAULTS = {
  gearKg: 1,
  trailerKg: 25,
  bagsKg: 5,
  /** Room temperature for both: switching the correction on changes nothing until one is set. */
  pumpC: 20,
  rideC: 20,
} as const;

/** Bike profile ranges, shared by the editor and data validation so both always agree. */
export const PROFILE_LIMITS = {
  riderKg: { min: 10, max: 200 },
  bikeKg: { min: 2, max: 60 },
  frontWidthMm: { min: 18, max: 80 },
  rearWidthMm: { min: 18, max: 80 },
  innerRimMm: { min: 12, max: 45 },
  frontSharePct: { min: 25, max: 60 },
  trailerTonguePct: { min: 0, max: 50 },
  correctionPct: { min: -15, max: 15 },
  /** Tire and rim pressure limits. */
  psi: { min: 5, max: 200 },
} as const;

/** Ride screen input ranges (kg, °C), shared by its steppers and data validation. */
export const LOAD_LIMITS = {
  gearKg: { min: 0, max: 30 },
  trailerKg: { min: 1, max: 100 },
  bagsKg: { min: 0.5, max: 60 },
  pumpC: { min: -20, max: 45 },
  rideC: { min: -20, max: 45 },
} as const;

/**
 * The wheel sizes a bike can have: ETRTO bead seat diameter (printed on the tire as e.g. 47-622),
 * its common name, and other names it goes by.
 */
export const WHEEL_SIZES = [
  { bsdMm: 622, name: '700c', alias: '29″' },
  { bsdMm: 584, name: '650b', alias: '27.5″' },
  { bsdMm: 559, name: '26″', alias: null },
  { bsdMm: 507, name: '24″', alias: null },
  { bsdMm: 406, name: '20″', alias: null },
  { bsdMm: 355, name: '18″', alias: null },
  { bsdMm: 305, name: '16″', alias: null },
  { bsdMm: 203, name: '12″', alias: null },
] as const;

/** "700c", "650b", "20″"... */
export function wheelSizeName(bsdMm: number): string {
  return WHEEL_SIZES.find((w) => w.bsdMm === bsdMm)?.name ?? `${bsdMm} mm`;
}

/** "+5%", "−5%": a bike's pressure correction, for display. Empty at 0, where there is none to show. */
export function formatCorrection(pct: number): string {
  return pct === 0 ? '' : `${pct > 0 ? '+' : '\u2212'}${Math.abs(pct)}%`;
}

export const SURFACES: readonly Surface[] = ['smooth', 'worn', 'rough', 'hardpack', 'loose', 'rocky'];

export const SEED_PROFILES: readonly Profile[] = [
  {
    id: 'seed-endurace',
    name: 'Endurace CF SLX 9 Di2',
    riderName: 'Me',
    riderKg: 75,
    bikeKg: 7.5,
    wheelBsdMm: WHEEL.referenceBsdMm,
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
    canTowTrailer: false,
    canCarryBags: false,
    trailerTonguePct: TRAILER.defaultTonguePct,
    correctionPct: 0,
  },
  {
    id: 'seed-grizl',
    name: 'Grizl CF 9 ECLIPS',
    riderName: 'Me',
    riderKg: 75,
    bikeKg: 8.8,
    wheelBsdMm: WHEEL.referenceBsdMm,
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
    canTowTrailer: true,
    canCarryBags: true,
    trailerTonguePct: TRAILER.defaultTonguePct,
    correctionPct: 0,
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
    temperature: false,
    pumpC: RIDE_DEFAULTS.pumpC,
    rideC: RIDE_DEFAULTS.rideC,
  };
}

export function blankProfile(id: string): Profile {
  return {
    id,
    name: '',
    riderName: '',
    riderKg: 70,
    bikeKg: 9,
    wheelBsdMm: WHEEL.referenceBsdMm,
    frontWidthMm: 32,
    rearWidthMm: 32,
    innerRimMm: 21,
    tubeless: true,
    hookless: false,
    frontSharePct: 43,
    tireMinPsi: null,
    tireMaxPsi: null,
    rimMaxPsi: null,
    canTowTrailer: false,
    canCarryBags: false,
    trailerTonguePct: TRAILER.defaultTonguePct,
    correctionPct: 0,
  };
}

/**
 * The loads that count for this ride: switched on, on a bike that can take them. The switches
 * are kept even when the bike can't, so re-enabling a capability restores the last ride.
 */
export function activeLoads(profile: Profile, ride: RideSettings): { trailer: boolean; bags: boolean } {
  return { trailer: profile.canTowTrailer && ride.trailer, bags: profile.canCarryBags && ride.bags };
}

/** Load the trailer hitch puts on the rear wheel at the ride's trailer weight. */
export function hitchKg(profile: Profile, ride: RideSettings): number {
  return (ride.trailerKg * profile.trailerTonguePct) / 100;
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
    wheelBsdMm: profile.wheelBsdMm,
    tubeless: profile.tubeless,
    hookless: profile.hookless,
    surface: ride.surface,
    wet: ride.wet,
    trailerTongueKg: activeLoads(profile, ride).trailer ? hitchKg(profile, ride) : 0,
    rearBagsKg: activeLoads(profile, ride).bags ? ride.bagsKg : 0,
    tireMinPsi: profile.tireMinPsi,
    tireMaxPsi: profile.tireMaxPsi,
    rimMaxPsi: profile.rimMaxPsi,
    temperature: ride.temperature ? { pumpC: ride.pumpC, rideC: ride.rideC } : null,
    correctionPct: profile.correctionPct,
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

/** Like {@link num}, but a finite value out of range is clamped rather than replaced. */
function clampedNum(raw: Raw, key: string, min: number, max: number, fallback: number): number {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function optNum(raw: Raw, key: string, min: number, max: number): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** One of the listed values, or the fallback. */
function oneOf(raw: Raw, key: string, values: readonly number[], fallback: number): number {
  const value = raw[key];
  return typeof value === 'number' && values.includes(value) ? value : fallback;
}

function str(raw: Raw, key: string, fallback: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value.slice(0, 60) : fallback;
}

function bool(raw: Raw, key: string, fallback: boolean): boolean {
  const value = raw[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Bikes saved before the load capabilities existed: a load that was switched on in the bike's ride
 * means the bike can take it. Without this, `activeLoads` would silently drop it from the rear wheel.
 */
export function inferLoadCapabilities(profile: Profile, rawProfile: unknown, rawRide: unknown): Profile {
  const result = { ...profile };
  const pairs = [
    ['canTowTrailer', 'trailer'],
    ['canCarryBags', 'bags'],
  ] as const;
  for (const [capability, toggle] of pairs) {
    const missing = !isObject(rawProfile) || typeof rawProfile[capability] !== 'boolean';
    if (missing && isObject(rawRide) && rawRide[toggle] === true) result[capability] = true;
  }
  return result;
}

export function normalizeProfile(value: unknown): Profile | null {
  // `__proto__` can't be an own key of the plain objects that hold per-bike rides.
  if (!isObject(value) || typeof value.id !== 'string' || value.id === '' || value.id === '__proto__') return null;
  // Seeds saved before a field existed get the seed's value; other bikes get the blank default.
  const base = SEED_PROFILES.find((p) => p.id === value.id) ?? blankProfile(value.id);
  return {
    id: value.id,
    name: str(value, 'name', base.name),
    riderName: str(value, 'riderName', base.riderName),
    riderKg: num(value, 'riderKg', PROFILE_LIMITS.riderKg.min, PROFILE_LIMITS.riderKg.max, base.riderKg),
    bikeKg: num(value, 'bikeKg', PROFILE_LIMITS.bikeKg.min, PROFILE_LIMITS.bikeKg.max, base.bikeKg),
    // Bikes saved before wheel sizes existed were all computed as 700c.
    wheelBsdMm: oneOf(value, 'wheelBsdMm', WHEEL_SIZES.map((w) => w.bsdMm), base.wheelBsdMm),
    frontWidthMm: num(value, 'frontWidthMm', PROFILE_LIMITS.frontWidthMm.min, PROFILE_LIMITS.frontWidthMm.max, base.frontWidthMm),
    rearWidthMm: num(value, 'rearWidthMm', PROFILE_LIMITS.rearWidthMm.min, PROFILE_LIMITS.rearWidthMm.max, base.rearWidthMm),
    innerRimMm: num(value, 'innerRimMm', PROFILE_LIMITS.innerRimMm.min, PROFILE_LIMITS.innerRimMm.max, base.innerRimMm),
    tubeless: bool(value, 'tubeless', base.tubeless),
    hookless: bool(value, 'hookless', base.hookless),
    frontSharePct: num(value, 'frontSharePct', PROFILE_LIMITS.frontSharePct.min, PROFILE_LIMITS.frontSharePct.max, base.frontSharePct),
    tireMinPsi: optNum(value, 'tireMinPsi', PROFILE_LIMITS.psi.min, PROFILE_LIMITS.psi.max),
    tireMaxPsi: optNum(value, 'tireMaxPsi', PROFILE_LIMITS.psi.min, PROFILE_LIMITS.psi.max),
    rimMaxPsi: optNum(value, 'rimMaxPsi', PROFILE_LIMITS.psi.min, PROFILE_LIMITS.psi.max),
    canTowTrailer: bool(value, 'canTowTrailer', base.canTowTrailer),
    canCarryBags: bool(value, 'canCarryBags', base.canCarryBags),
    trailerTonguePct: num(value, 'trailerTonguePct', PROFILE_LIMITS.trailerTonguePct.min, PROFILE_LIMITS.trailerTonguePct.max, base.trailerTonguePct),
    // Bikes saved before the correction existed have none. Clamped, so a correction isn't silently lost.
    correctionPct: Math.round(clampedNum(value, 'correctionPct', PROFILE_LIMITS.correctionPct.min, PROFILE_LIMITS.correctionPct.max, base.correctionPct)) || 0,
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
    temperature: bool(value, 'temperature', false),
    pumpC: clampedNum(value, 'pumpC', LOAD_LIMITS.pumpC.min, LOAD_LIMITS.pumpC.max, fallback.pumpC),
    rideC: clampedNum(value, 'rideC', LOAD_LIMITS.rideC.min, LOAD_LIMITS.rideC.max, fallback.rideC),
  };
}
