import { describe, expect, it } from 'vitest';
import { SEED_PROFILES } from './profile';
import { STORAGE_KEY, exportStore, importInto, loadStore, saveStore, seedStore } from './store';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('store', () => {
  it('seeds the two bikes on first start', () => {
    const store = loadStore(memoryStorage());
    expect(store.profiles.map((p) => p.id)).toEqual(SEED_PROFILES.map((p) => p.id));
    expect(store.lastProfileId).toBe('seed-endurace');
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const store = seedStore();
    store.profiles[0]!.riderKg = 68;
    store.rides['seed-grizl'] = { surface: 'loose', wet: true, gearOffsetKg: 2, trailer: true, bags: false };
    store.lastProfileId = 'seed-grizl';
    saveStore(storage, store);
    expect(loadStore(storage)).toEqual(store);
  });

  it('falls back to seeds on corrupt data', () => {
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: '{nope' })).profiles).toHaveLength(2);
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: '"x"' })).profiles).toHaveLength(2);
  });

  it('sanitizes out-of-range values and drops invalid profiles', () => {
    const raw = {
      profiles: [{ id: 'a', name: 'Kid', riderKg: -5, frontWidthMm: 40, tubeless: 'yes' }, { name: 'no id' }],
      rides: { a: { surface: 'lava', trailer: true } },
      lastProfileId: 'missing',
    };
    const store = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }));
    expect(store.profiles).toHaveLength(1);
    const [kid] = store.profiles;
    expect(kid?.riderKg).toBe(70);
    expect(kid?.frontWidthMm).toBe(40);
    expect(kid?.tubeless).toBe(true);
    expect(store.rides.a?.surface).toBe('hardpack');
    expect(store.rides.a?.trailer).toBe(false); // no trailer configured
    expect(store.lastProfileId).toBeNull();
  });

  it('imports an export: replaces same ids, adds new ones', () => {
    const source = seedStore();
    source.profiles[0]!.riderKg = 80;
    source.profiles.push({ ...structuredClone(source.profiles[1]!), id: 'kid', name: 'Kid bike', riderKg: 30 });
    const file = JSON.stringify(exportStore(source));

    const { store, added, updated } = importInto(seedStore(), file);
    expect(added).toBe(1);
    expect(updated).toBe(2);
    expect(store.profiles.find((p) => p.id === 'seed-endurace')?.riderKg).toBe(80);
    expect(store.profiles.find((p) => p.id === 'kid')?.name).toBe('Kid bike');
  });

  it('rejects files that are not exports', () => {
    expect(() => importInto(seedStore(), 'garbage')).toThrow(/not valid JSON/);
    expect(() => importInto(seedStore(), '{"profiles": []}')).toThrow(/not a tire pressure export/);
    expect(() => importInto(seedStore(), '{"app": "tire-pressure", "profiles": []}')).toThrow(/no bikes/);
  });
});
