import { TRAILER, WHEEL } from './coefficients';
import type { Profile } from './profile';
import type { Store } from './store';

/**
 * Generic example bikes for the tests and the README screenshots. The app itself starts with
 * no bikes; these are never part of the app bundle.
 */
export const ROAD_BIKE: Profile = {
  id: 'example-road',
  name: 'Road bike',
  riderName: 'Alex',
  riderKg: 80,
  bikeKg: 8.5,
  rearHubMotorKg: 0,
  wheelBsdMm: WHEEL.referenceBsdMm,
  frontWidthMm: 30,
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

export const GRAVEL_BIKE: Profile = {
  id: 'example-gravel',
  name: 'Gravel bike',
  riderName: 'Alex',
  riderKg: 80,
  bikeKg: 9.5,
  rearHubMotorKg: 0,
  wheelBsdMm: WHEEL.referenceBsdMm,
  frontWidthMm: 45,
  rearWidthMm: 45,
  innerRimMm: 25,
  tubeless: true,
  hookless: true,
  frontSharePct: 42,
  tireMinPsi: null,
  tireMaxPsi: null,
  rimMaxPsi: null,
  canTowTrailer: true,
  canCarryBags: true,
  trailerTonguePct: TRAILER.defaultTonguePct,
  correctionPct: 0,
};

export const EXAMPLE_BIKES: readonly Profile[] = [ROAD_BIKE, GRAVEL_BIKE];

/** A store holding fresh copies of the example bikes, with no rides yet. */
export function exampleStore(): Store {
  return { profiles: EXAMPLE_BIKES.map((p) => structuredClone(p)), rides: {} };
}
