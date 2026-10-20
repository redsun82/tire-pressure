import { describe, expect, it } from 'vitest';
import { RIDE_DEFAULTS, SEED_PROFILES, defaultRide, normalizeRide, toPressureInput } from './profile';
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
  });

  it('loads data saved with the last opened bike, and no longer saves it', () => {
    const raw = { profiles: [SEED_PROFILES[1]], rides: {}, lastProfileId: 'seed-grizl' };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) });
    const store = loadStore(storage);
    expect(store).toEqual({ profiles: [SEED_PROFILES[1]], rides: {} });
    saveStore(storage, store);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).not.toHaveProperty('lastProfileId');
    const imported = importInto(seedStore(), JSON.stringify({ app: 'tire-pressure', ...raw }));
    expect(imported.store).not.toHaveProperty('lastProfileId');
    expect(imported.updated).toBe(1);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const store = seedStore();
    store.profiles[0]!.riderKg = 68;
    store.rides['seed-grizl'] = {
      surface: 'loose',
      wet: true,
      gearKg: 2.5,
      trailer: true,
      trailerKg: 31,
      bags: false,
      bagsKg: 7.5,
      temperature: true,
      pumpC: 21,
      rideC: -3,
    };
    saveStore(storage, store);
    expect(loadStore(storage)).toEqual(store);
  });

  it('prefills gear 1 kg, trailer 25 kg and bags 5 kg, all off', () => {
    const ride = defaultRide(SEED_PROFILES[1]!);
    expect(ride).toMatchObject({ gearKg: 1, trailer: false, trailerKg: 25, bags: false, bagsKg: 5 });
  });

  it('keeps load weights while their switch is off', () => {
    const storage = memoryStorage();
    const grizl = SEED_PROFILES[1]!;
    const store = seedStore();
    const set = (changes: object) => {
      store.rides[grizl.id] = { ...(store.rides[grizl.id] ?? defaultRide(grizl)), ...changes };
      saveStore(storage, store);
    };
    set({ trailer: true, trailerKg: 30, bags: true, bagsKg: 8 });
    set({ trailer: false, bags: false });

    const off = loadStore(storage).rides[grizl.id]!;
    expect(off).toMatchObject({ trailer: false, trailerKg: 30, bags: false, bagsKg: 8 });
    const offInput = toPressureInput(grizl, off);
    expect(offInput.trailerTongueKg).toBe(0);
    expect(offInput.rearBagsKg).toBe(0);

    set({ trailer: true, bags: true });
    const on = loadStore(storage).rides[grizl.id]!;
    expect(on).toMatchObject({ trailer: true, trailerKg: 30, bags: true, bagsKg: 8 });
    const onInput = toPressureInput(grizl, on);
    expect(onInput.trailerTongueKg).toBeCloseTo(3);
    expect(onInput.rearBagsKg).toBe(8);
  });

  it('ignores loads the bike cannot carry', () => {
    const endurace = SEED_PROFILES[0]!;
    expect(endurace).toMatchObject({ canTowTrailer: false, canCarryBags: false });
    expect(SEED_PROFILES[1]).toMatchObject({ canTowTrailer: true, canCarryBags: true });
    const ride = { ...defaultRide(endurace), trailer: true, bags: true };
    const input = toPressureInput(endurace, ride);
    expect(input.trailerTongueKg).toBe(0);
    expect(input.rearBagsKg).toBe(0);
    const capable = toPressureInput({ ...endurace, canTowTrailer: true, canCarryBags: true }, ride);
    expect(capable.trailerTongueKg).toBeGreaterThan(0);
    expect(capable.rearBagsKg).toBe(RIDE_DEFAULTS.bagsKg);
  });

  it('keeps seed capabilities for seeds saved before they existed, and defaults others to off', () => {
    const strip = ({ canTowTrailer: _t, canCarryBags: _b, ...rest }: (typeof SEED_PROFILES)[number]) => rest;
    const raw = { profiles: [...SEED_PROFILES.map(strip), { ...strip(SEED_PROFILES[1]!), id: 'other' }], rides: {} };
    const store = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }));
    expect(store.profiles.map((p) => [p.canTowTrailer, p.canCarryBags])).toEqual([
      [false, false],
      [true, true],
      [false, false],
    ]);
  });

  it('keeps loads that were on for bikes saved before load capabilities existed', () => {
    const strip = ({ canTowTrailer: _t, canCarryBags: _b, ...rest }: (typeof SEED_PROFILES)[number]) => rest;
    const custom = { ...strip(SEED_PROFILES[0]!), id: 'custom', name: 'Old touring bike' };
    const onlyBags = { ...strip(SEED_PROFILES[0]!), id: 'bags-only' };
    const rides = {
      custom: { ...defaultRide(SEED_PROFILES[0]!), trailer: true, trailerKg: 30, bags: true, bagsKg: 6 },
      'bags-only': { ...defaultRide(SEED_PROFILES[0]!), bags: true },
      'seed-endurace': { ...defaultRide(SEED_PROFILES[0]!), trailer: true },
    };
    const old = { profiles: [custom, onlyBags, strip(SEED_PROFILES[0]!)], rides };

    const check = (store: ReturnType<typeof loadStore>) => {
      const byId = (id: string) => store.profiles.find((p) => p.id === id)!;
      expect(byId('custom')).toMatchObject({ canTowTrailer: true, canCarryBags: true });
      expect(byId('bags-only')).toMatchObject({ canTowTrailer: false, canCarryBags: true });
      expect(byId('seed-endurace')).toMatchObject({ canTowTrailer: true, canCarryBags: false });
      const input = toPressureInput(byId('custom'), store.rides.custom!);
      expect(input.trailerTongueKg).toBeCloseTo(3);
      expect(input.rearBagsKg).toBe(6);
    };
    check(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(old) })));
    check(importInto(seedStore(), JSON.stringify({ app: 'tire-pressure', ...old })).store);

    // An old export without rides: the rides already on this device count.
    const local = seedStore();
    local.rides = structuredClone(rides);
    check(importInto(local, JSON.stringify({ app: 'tire-pressure', profiles: old.profiles })).store);

    // An explicit "off" is respected.
    const explicit = { profiles: [{ ...custom, canTowTrailer: false, canCarryBags: false }], rides };
    const store = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(explicit) }));
    expect(store.profiles[0]).toMatchObject({ canTowTrailer: false, canCarryBags: false });
  });

  it('keeps the temperatures while the correction is off, and passes them on only when on', () => {
    const storage = memoryStorage();
    const grizl = SEED_PROFILES[1]!;
    const store = seedStore();
    expect(defaultRide(grizl)).toMatchObject({ temperature: false, pumpC: 20, rideC: 20 });
    store.rides[grizl.id] = { ...defaultRide(grizl), temperature: true, pumpC: 22, rideC: 4 };
    saveStore(storage, store);
    expect(toPressureInput(grizl, loadStore(storage).rides[grizl.id]!).temperature).toEqual({ pumpC: 22, rideC: 4 });

    store.rides[grizl.id] = { ...store.rides[grizl.id]!, temperature: false };
    saveStore(storage, store);
    const off = loadStore(storage).rides[grizl.id]!;
    expect(off).toMatchObject({ temperature: false, pumpC: 22, rideC: 4 });
    expect(toPressureInput(grizl, off).temperature).toBeNull();
  });

  it('upgrades rides saved before temperatures existed, and sanitizes them', () => {
    const grizl = SEED_PROFILES[1]!;
    const old = { surface: 'loose', wet: true, gearKg: 2, trailer: true, trailerKg: 30, bags: false, bagsKg: 5 };
    expect(normalizeRide(old, grizl)).toEqual({ ...old, temperature: false, pumpC: 20, rideC: 20 });
    const raw = { profiles: [grizl], rides: { [grizl.id]: old } };
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) })).rides[grizl.id]).toMatchObject({
      temperature: false,
      pumpC: 20,
      rideC: 20,
    });
    const bad = normalizeRide({ ...old, temperature: 'yes', pumpC: 80, rideC: '5' }, grizl);
    // Out-of-range numbers are clamped, so an active correction isn't silently lost.
    expect(bad).toMatchObject({ temperature: false, pumpC: 45, rideC: 20 });
    expect(normalizeRide({ ...old, temperature: true, pumpC: 46, rideC: -30 }, grizl)).toMatchObject({
      temperature: true,
      pumpC: 45,
      rideC: -20,
    });
    expect(normalizeRide({ ...old, pumpC: Number.NaN, rideC: null }, grizl)).toMatchObject({ pumpC: 20, rideC: 20 });
    expect(normalizeRide({ ...old, temperature: true, pumpC: -20, rideC: 45 }, grizl)).toMatchObject({
      temperature: true,
      pumpC: -20,
      rideC: 45,
    });
  });

  it('puts bikes saved before wheel sizes existed on 700c, and keeps known sizes only', () => {
    const { wheelBsdMm: _w, ...old } = SEED_PROFILES[1]!;
    const raw = { profiles: [old, { ...old, id: 'kid', wheelBsdMm: 406 }, { ...old, id: 'odd', wheelBsdMm: 600 }], rides: {} };
    const sizes = (store: ReturnType<typeof loadStore>) => store.profiles.map((p) => p.wheelBsdMm);
    expect(sizes(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) })))).toEqual([622, 406, 622]);
    const imported = importInto(seedStore(), JSON.stringify({ app: 'tire-pressure', ...raw })).store;
    expect(imported.profiles.find((p) => p.id === 'kid')?.wheelBsdMm).toBe(406);
    expect(imported.profiles.find((p) => p.id === old.id)?.wheelBsdMm).toBe(622);
  });

  it('gives bikes saved or exported before the correction existed none, and sanitizes it', () => {
    const { correctionPct: _c, ...old } = SEED_PROFILES[1]!;
    const raw = {
      profiles: [
        old,
        { ...old, id: 'other' },
        { ...old, id: 'up', correctionPct: 7 },
        { ...old, id: 'down', correctionPct: -15 },
        { ...old, id: 'high', correctionPct: 40 },
        { ...old, id: 'low', correctionPct: -99 },
        { ...old, id: 'odd', correctionPct: 2.6 },
        { ...old, id: 'tiny', correctionPct: -0.2 },
        { ...old, id: 'text', correctionPct: '5' },
        { ...old, id: 'nan', correctionPct: null },
      ],
      rides: {},
    };
    const expected = [0, 0, 7, -15, 15, -15, 3, 0, 0, 0];
    const corrections = (store: ReturnType<typeof loadStore>) => store.profiles.map((p) => p.correctionPct);
    expect(corrections(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) })))).toEqual(expected);
    const imported = importInto({ profiles: [], rides: {} }, JSON.stringify({ app: 'tire-pressure', ...raw })).store;
    expect(corrections(imported)).toEqual(expected);
    expect(Object.is(imported.profiles.find((p) => p.id === 'tiny')!.correctionPct, 0)).toBe(true);
  });

  it('keeps the correction through storage and export, and passes it on', () => {
    const storage = memoryStorage();
    const store = seedStore();
    store.profiles[1]!.correctionPct = -6;
    saveStore(storage, store);
    const loaded = loadStore(storage);
    expect(loaded.profiles[1]!.correctionPct).toBe(-6);
    const { store: imported } = importInto(seedStore(), JSON.stringify(exportStore(loaded)));
    expect(imported.profiles[1]!.correctionPct).toBe(-6);
    expect(toPressureInput(imported.profiles[1]!, defaultRide(imported.profiles[1]!)).correctionPct).toBe(-6);
  });

  it('upgrades rides saved before load weights existed', () => {
    const ride = normalizeRide({ surface: 'smooth', wet: false, gearOffsetKg: 2, trailer: false, bags: false }, SEED_PROFILES[0]!);
    expect(ride).toEqual(defaultRide(SEED_PROFILES[0]!));
  });

  it('falls back to seeds on corrupt data', () => {
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: '{nope' })).profiles).toHaveLength(2);
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: '"x"' })).profiles).toHaveLength(2);
  });

  it('sanitizes out-of-range values and drops invalid profiles', () => {
    const raw = {
      profiles: [{ id: 'a', name: 'Kid', riderKg: -5, frontWidthMm: 40, tubeless: 'yes' }, { name: 'no id' }],
      rides: { a: { surface: 'lava', trailer: true, trailerKg: 500, gearKg: 'x' } },
    };
    const store = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }));
    expect(store.profiles).toHaveLength(1);
    const [kid] = store.profiles;
    expect(kid?.riderKg).toBe(70);
    expect(kid?.frontWidthMm).toBe(40);
    expect(kid?.tubeless).toBe(true);
    expect(store.rides.a?.surface).toBe('hardpack');
    expect(store.rides.a?.trailer).toBe(true);
    expect(store.rides.a?.trailerKg).toBe(RIDE_DEFAULTS.trailerKg);
    expect(store.rides.a?.gearKg).toBe(RIDE_DEFAULTS.gearKg);
    expect(store.rides.a?.bagsKg).toBe(RIDE_DEFAULTS.bagsKg);
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

  it('rejects bikes whose tire minimum is above the maximum', () => {
    const source = seedStore();
    source.profiles[1]!.tireMinPsi = 80; // the Grizl is hookless: 5 bar max
    const file = JSON.stringify(exportStore(source));
    expect(() => importInto(seedStore(), file)).toThrow(/“Grizl CF 9 ECLIPS” has a tire minimum above/);
    source.profiles[1]!.tireMinPsi = 40;
    expect(() => importInto(seedStore(), JSON.stringify(exportStore(source)))).not.toThrow();
  });

  it('keeps rides of bikes with ids that are Object.prototype keys, and drops __proto__', () => {
    const grizl = SEED_PROFILES[1]!;
    const raw = {
      profiles: [{ ...grizl, id: 'constructor' }, { ...grizl, id: 'toString' }, { ...grizl, id: '__proto__' }],
      rides: JSON.parse('{"constructor": {"surface": "loose"}, "__proto__": {"surface": "rough"}}'),
    };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) });
    const store = loadStore(storage);
    expect(store.profiles.map((p) => p.id)).toEqual(['constructor', 'toString']);
    expect(store.rides['constructor']?.surface).toBe('loose');
    expect(Object.hasOwn(store.rides, 'toString')).toBe(false);
    expect(Object.getPrototypeOf(store.rides)).toBe(Object.prototype);
    saveStore(storage, store);
    expect(loadStore(storage).rides['constructor']?.surface).toBe('loose');
  });

  it('rejects files that are not exports', () => {
    expect(() => importInto(seedStore(), 'garbage')).toThrow(/not valid JSON/);
    expect(() => importInto(seedStore(), '{"profiles": []}')).toThrow(/not a tire pressure export/);
    expect(() => importInto(seedStore(), '{"app": "tire-pressure", "profiles": []}')).toThrow(/no bikes/);
  });
});
