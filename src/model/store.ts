import { SEED_PROFILES, inferLoadCapabilities, normalizeProfile, normalizeRide, type Profile, type RideSettings } from './profile';
import { limitConflict } from './pressure';

export const STORAGE_KEY = 'tire-pressure:v1';

export interface Store {
  profiles: Profile[];
  rides: Record<string, RideSettings>;
}

export interface ExportFile {
  app: 'tire-pressure';
  version: 1;
  exportedAt: string;
  profiles: Profile[];
  rides: Record<string, RideSettings>;
}

export function seedStore(): Store {
  return {
    profiles: SEED_PROFILES.map((p) => structuredClone(p)),
    rides: {},
  };
}

/** The saved ride for a bike: own keys only, so ids like "constructor" don't hit Object.prototype. */
export function savedRide<T>(rides: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(rides, id) ? rides[id] : undefined;
}

/** `fallbackRides`: rides to infer missing load capabilities from when `value` has none for a bike. */
function parseStore(value: unknown, fallbackRides: Record<string, RideSettings> = {}): Store | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.profiles)) return null;
  const rawRides = typeof raw.rides === 'object' && raw.rides !== null ? (raw.rides as Record<string, unknown>) : {};
  const profiles: Profile[] = [];
  for (const candidate of raw.profiles) {
    const profile = normalizeProfile(candidate);
    if (!profile || profiles.some((p) => p.id === profile.id)) continue;
    const rawRide = Object.hasOwn(rawRides, profile.id) ? rawRides[profile.id] : savedRide(fallbackRides, profile.id);
    profiles.push(inferLoadCapabilities(profile, candidate, rawRide));
  }
  const rides: Record<string, RideSettings> = {};
  for (const profile of profiles) {
    if (Object.hasOwn(rawRides, profile.id)) rides[profile.id] = normalizeRide(rawRides[profile.id], profile);
  }
  return { profiles, rides };
}

export function loadStore(storage: Pick<Storage, 'getItem'>): Store {
  const text = storage.getItem(STORAGE_KEY);
  if (text === null) return seedStore();
  try {
    return parseStore(JSON.parse(text)) ?? seedStore();
  } catch {
    return seedStore();
  }
}

export function saveStore(storage: Pick<Storage, 'setItem'>, store: Store): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function exportStore(store: Store, now = new Date()): ExportFile {
  return {
    app: 'tire-pressure',
    version: 1,
    exportedAt: now.toISOString(),
    profiles: store.profiles,
    rides: store.rides,
  };
}

/**
 * Merges an exported file into the store: profiles with the same id are
 * replaced, new ones are added. Throws on files that are not exports, and on
 * bikes whose limits conflict (tire minimum above the applicable maximum).
 */
export function importInto(store: Store, text: string): { store: Store; added: number; updated: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null || (data as Record<string, unknown>).app !== 'tire-pressure') {
    throw new Error('This file is not a tire pressure export.');
  }
  const imported = parseStore(data, store.rides);
  if (!imported || imported.profiles.length === 0) throw new Error('The file contains no bikes.');
  const conflicting = imported.profiles.filter((p) => limitConflict(p) !== null);
  if (conflicting.length) {
    const names = conflicting.map((p) => `“${p.name}”`).join(', ');
    throw new Error(`Not imported: ${names} ${conflicting.length > 1 ? 'have' : 'has'} a tire minimum above its maximum pressure.`);
  }

  const profiles = [...store.profiles];
  const rides = { ...store.rides };
  let added = 0;
  let updated = 0;
  for (const profile of imported.profiles) {
    const index = profiles.findIndex((p) => p.id === profile.id);
    if (index >= 0) {
      profiles[index] = profile;
      updated++;
    } else {
      profiles.push(profile);
      added++;
    }
    const ride = savedRide(imported.rides, profile.id);
    const existing = savedRide(rides, profile.id);
    if (ride) rides[profile.id] = ride;
    else if (index >= 0 && existing) rides[profile.id] = normalizeRide(existing, profile);
  }
  return { store: { ...store, profiles, rides }, added, updated };
}
