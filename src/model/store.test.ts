import { describe, expect, it } from 'vitest';
import { GRAVEL_BIKE, ROAD_BIKE, exampleStore } from './example-bikes.fixtures';
import { RIDE_DEFAULTS, defaultRide, normalizeRide, toPressureInput, type Profile } from './profile';
import { STORAGE_KEY, emptyStore, exportStore, importInto, loadStore, saveStore } from './store';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('store', () => {
  it('starts with no bikes on first start', () => {
    expect(loadStore(memoryStorage())).toEqual({ profiles: [], rides: {} });
  });

  it('loads bikes saved with the ids of the former built-in bikes unchanged', () => {
    // The user's own values, some of them different from what the built-in bikes had.
    const own = (id: string, base: Profile): Profile => ({
      ...base,
      id,
      name: `Own ${id}`,
      riderName: 'Sam',
      riderKg: 62,
      bikeKg: 7.9,
      correctionPct: -4,
    });
    const profiles = [own('seed-endurace', ROAD_BIKE), own('seed-grizl', { ...GRAVEL_BIKE, canTowTrailer: false, hookless: false })];
    const rides = { 'seed-grizl': { ...defaultRide(profiles[1]!), surface: 'rocky' as const, gearKg: 3 } };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ profiles, rides }) });
    expect(loadStore(storage)).toEqual({ profiles, rides });

    // Saved before wheel sizes, the correction and the motor existed: the same defaults as any other bike.
    const old = profiles.map(({ wheelBsdMm: _w, correctionPct: _c, rearHubMotorKg: _m, ...rest }) => rest);
    const loaded = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ profiles: old, rides }) }));
    expect(loaded.profiles).toEqual(profiles.map((p) => ({ ...p, wheelBsdMm: 622, correctionPct: 0, rearHubMotorKg: 0 })));
  });

  it('loads data saved with the last opened bike, and no longer saves it', () => {
    const raw = { profiles: [GRAVEL_BIKE], rides: {}, lastProfileId: GRAVEL_BIKE.id };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) });
    const store = loadStore(storage);
    expect(store).toEqual({ profiles: [GRAVEL_BIKE], rides: {} });
    saveStore(storage, store);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).not.toHaveProperty('lastProfileId');
    const imported = importInto(exampleStore(), JSON.stringify({ app: 'tire-pressure', ...raw }));
    expect(imported.store).not.toHaveProperty('lastProfileId');
    expect(imported.updated).toBe(1);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const store = exampleStore();
    store.profiles[0]!.riderKg = 68;
    store.rides[GRAVEL_BIKE.id] = {
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
    const ride = defaultRide(GRAVEL_BIKE);
    expect(ride).toMatchObject({ gearKg: 1, trailer: false, trailerKg: 25, bags: false, bagsKg: 5 });
  });

  it('keeps load weights while their switch is off', () => {
    const storage = memoryStorage();
    const gravel = GRAVEL_BIKE;
    const store = exampleStore();
    const set = (changes: object) => {
      store.rides[gravel.id] = { ...(store.rides[gravel.id] ?? defaultRide(gravel)), ...changes };
      saveStore(storage, store);
    };
    set({ trailer: true, trailerKg: 30, bags: true, bagsKg: 8 });
    set({ trailer: false, bags: false });

    const off = loadStore(storage).rides[gravel.id]!;
    expect(off).toMatchObject({ trailer: false, trailerKg: 30, bags: false, bagsKg: 8 });
    const offInput = toPressureInput(gravel, off);
    expect(offInput.trailerTongueKg).toBe(0);
    expect(offInput.rearBagsKg).toBe(0);

    set({ trailer: true, bags: true });
    const on = loadStore(storage).rides[gravel.id]!;
    expect(on).toMatchObject({ trailer: true, trailerKg: 30, bags: true, bagsKg: 8 });
    const onInput = toPressureInput(gravel, on);
    expect(onInput.trailerTongueKg).toBeCloseTo(3);
    expect(onInput.rearBagsKg).toBe(8);
  });

  it('ignores loads the bike cannot carry', () => {
    const road = ROAD_BIKE;
    expect(road).toMatchObject({ canTowTrailer: false, canCarryBags: false });
    expect(GRAVEL_BIKE).toMatchObject({ canTowTrailer: true, canCarryBags: true });
    const ride = { ...defaultRide(road), trailer: true, bags: true };
    const input = toPressureInput(road, ride);
    expect(input.trailerTongueKg).toBe(0);
    expect(input.rearBagsKg).toBe(0);
    const capable = toPressureInput({ ...road, canTowTrailer: true, canCarryBags: true }, ride);
    expect(capable.trailerTongueKg).toBeGreaterThan(0);
    expect(capable.rearBagsKg).toBe(RIDE_DEFAULTS.bagsKg);
  });

  it('defaults load capabilities of bikes saved before they existed to off', () => {
    const strip = ({ canTowTrailer: _t, canCarryBags: _b, ...rest }: Profile) => rest;
    const raw = { profiles: [strip(ROAD_BIKE), strip(GRAVEL_BIKE)], rides: {} };
    const store = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }));
    expect(store.profiles.map((p) => [p.canTowTrailer, p.canCarryBags])).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it('keeps loads that were on for bikes saved before load capabilities existed', () => {
    const strip = ({ canTowTrailer: _t, canCarryBags: _b, ...rest }: Profile) => rest;
    const custom = { ...strip(ROAD_BIKE), id: 'custom', name: 'Old touring bike' };
    const onlyBags = { ...strip(ROAD_BIKE), id: 'bags-only' };
    const rides = {
      custom: { ...defaultRide(ROAD_BIKE), trailer: true, trailerKg: 30, bags: true, bagsKg: 6 },
      'bags-only': { ...defaultRide(ROAD_BIKE), bags: true },
      [ROAD_BIKE.id]: { ...defaultRide(ROAD_BIKE), trailer: true },
    };
    const old = { profiles: [custom, onlyBags, strip(ROAD_BIKE)], rides };

    const check = (store: ReturnType<typeof loadStore>) => {
      const byId = (id: string) => store.profiles.find((p) => p.id === id)!;
      expect(byId('custom')).toMatchObject({ canTowTrailer: true, canCarryBags: true });
      expect(byId('bags-only')).toMatchObject({ canTowTrailer: false, canCarryBags: true });
      expect(byId(ROAD_BIKE.id)).toMatchObject({ canTowTrailer: true, canCarryBags: false });
      const input = toPressureInput(byId('custom'), store.rides.custom!);
      expect(input.trailerTongueKg).toBeCloseTo(3);
      expect(input.rearBagsKg).toBe(6);
    };
    check(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(old) })));
    check(importInto(exampleStore(), JSON.stringify({ app: 'tire-pressure', ...old })).store);

    // An old export without rides: the rides already on this device count.
    const local = exampleStore();
    local.rides = structuredClone(rides);
    check(importInto(local, JSON.stringify({ app: 'tire-pressure', profiles: old.profiles })).store);

    // An explicit "off" is respected.
    const explicit = { profiles: [{ ...custom, canTowTrailer: false, canCarryBags: false }], rides };
    const store = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(explicit) }));
    expect(store.profiles[0]).toMatchObject({ canTowTrailer: false, canCarryBags: false });
  });

  it('keeps the temperatures while the correction is off, and passes them on only when on', () => {
    const storage = memoryStorage();
    const gravel = GRAVEL_BIKE;
    const store = exampleStore();
    expect(defaultRide(gravel)).toMatchObject({ temperature: false, pumpC: 20, rideC: 20 });
    store.rides[gravel.id] = { ...defaultRide(gravel), temperature: true, pumpC: 22, rideC: 4 };
    saveStore(storage, store);
    expect(toPressureInput(gravel, loadStore(storage).rides[gravel.id]!).temperature).toEqual({ pumpC: 22, rideC: 4 });

    store.rides[gravel.id] = { ...store.rides[gravel.id]!, temperature: false };
    saveStore(storage, store);
    const off = loadStore(storage).rides[gravel.id]!;
    expect(off).toMatchObject({ temperature: false, pumpC: 22, rideC: 4 });
    expect(toPressureInput(gravel, off).temperature).toBeNull();
  });

  it('upgrades rides saved before temperatures existed, and sanitizes them', () => {
    const gravel = GRAVEL_BIKE;
    const old = { surface: 'loose', wet: true, gearKg: 2, trailer: true, trailerKg: 30, bags: false, bagsKg: 5 };
    expect(normalizeRide(old, gravel)).toEqual({ ...old, temperature: false, pumpC: 20, rideC: 20 });
    const raw = { profiles: [gravel], rides: { [gravel.id]: old } };
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) })).rides[gravel.id]).toMatchObject({
      temperature: false,
      pumpC: 20,
      rideC: 20,
    });
    const bad = normalizeRide({ ...old, temperature: 'yes', pumpC: 80, rideC: '5' }, gravel);
    // Out-of-range numbers are clamped, so an active correction isn't silently lost.
    expect(bad).toMatchObject({ temperature: false, pumpC: 45, rideC: 20 });
    expect(normalizeRide({ ...old, temperature: true, pumpC: 46, rideC: -30 }, gravel)).toMatchObject({
      temperature: true,
      pumpC: 45,
      rideC: -20,
    });
    expect(normalizeRide({ ...old, pumpC: Number.NaN, rideC: null }, gravel)).toMatchObject({ pumpC: 20, rideC: 20 });
    expect(normalizeRide({ ...old, temperature: true, pumpC: -20, rideC: 45 }, gravel)).toMatchObject({
      temperature: true,
      pumpC: -20,
      rideC: 45,
    });
  });

  it('puts bikes saved before wheel sizes existed on 700c, and keeps known sizes only', () => {
    const { wheelBsdMm: _w, ...old } = GRAVEL_BIKE;
    const raw = { profiles: [old, { ...old, id: 'kid', wheelBsdMm: 406 }, { ...old, id: 'odd', wheelBsdMm: 600 }], rides: {} };
    const sizes = (store: ReturnType<typeof loadStore>) => store.profiles.map((p) => p.wheelBsdMm);
    expect(sizes(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) })))).toEqual([622, 406, 622]);
    const imported = importInto(exampleStore(), JSON.stringify({ app: 'tire-pressure', ...raw })).store;
    expect(imported.profiles.find((p) => p.id === 'kid')?.wheelBsdMm).toBe(406);
    expect(imported.profiles.find((p) => p.id === old.id)?.wheelBsdMm).toBe(622);
  });

  it('gives bikes saved or exported before the correction existed none, and sanitizes it', () => {
    const { correctionPct: _c, ...old } = GRAVEL_BIKE;
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
    const store = exampleStore();
    store.profiles[1]!.correctionPct = -6;
    saveStore(storage, store);
    const loaded = loadStore(storage);
    expect(loaded.profiles[1]!.correctionPct).toBe(-6);
    const { store: imported } = importInto(exampleStore(), JSON.stringify(exportStore(loaded)));
    expect(imported.profiles[1]!.correctionPct).toBe(-6);
    expect(toPressureInput(imported.profiles[1]!, defaultRide(imported.profiles[1]!)).correctionPct).toBe(-6);
  });

  it('gives bikes saved or exported before the rear hub motor existed none, and sanitizes it', () => {
    const { rearHubMotorKg: _m, ...old } = GRAVEL_BIKE;
    const raw = {
      profiles: [
        old,
        { ...old, id: 'other' },
        { ...old, id: 'ebike', bikeKg: 14.3, rearHubMotorKg: 3.5 },
        { ...old, id: 'high', bikeKg: 25, rearHubMotorKg: 12 },
        { ...old, id: 'negative', rearHubMotorKg: -1 },
        { ...old, id: 'heavier', bikeKg: 5, rearHubMotorKg: 6 },
        { ...old, id: 'whole', bikeKg: 5, rearHubMotorKg: 5 },
        // A bike weight out of range falls back to the default (9 kg), and the motor is kept within it.
        { ...old, id: 'bad-bike', bikeKg: 100, rearHubMotorKg: 9.5 },
        { ...old, id: 'text', rearHubMotorKg: '3' },
        { ...old, id: 'nan', rearHubMotorKg: null },
      ],
      rides: {},
    };
    const expected = [0, 0, 3.5, 10, 0, 5, 5, 9, 0, 0];
    const motors = (store: ReturnType<typeof loadStore>) => store.profiles.map((p) => p.rearHubMotorKg);
    expect(motors(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) })))).toEqual(expected);
    const imported = importInto({ profiles: [], rides: {} }, JSON.stringify({ app: 'tire-pressure', ...raw })).store;
    expect(motors(imported)).toEqual(expected);
    for (const p of imported.profiles) expect(p.rearHubMotorKg).toBeLessThanOrEqual(p.bikeKg);
  });

  it('keeps the rear hub motor through storage and export, and passes it on', () => {
    const storage = memoryStorage();
    const store = exampleStore();
    store.profiles[1]!.bikeKg = 14.3;
    store.profiles[1]!.rearHubMotorKg = 3.5;
    saveStore(storage, store);
    const loaded = loadStore(storage);
    expect(loaded.profiles[1]!.rearHubMotorKg).toBe(3.5);
    const { store: imported } = importInto(exampleStore(), JSON.stringify(exportStore(loaded)));
    expect(imported.profiles[1]!.rearHubMotorKg).toBe(3.5);
    expect(toPressureInput(imported.profiles[1]!, defaultRide(imported.profiles[1]!)).rearHubMotorKg).toBe(3.5);
  });

  it('upgrades rides saved before load weights existed', () => {
    const ride = normalizeRide({ surface: 'smooth', wet: false, gearOffsetKg: 2, trailer: false, bags: false }, ROAD_BIKE);
    expect(ride).toEqual(defaultRide(ROAD_BIKE));
  });

  it('starts with no bikes on corrupt data', () => {
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: '{nope' }))).toEqual(emptyStore());
    expect(loadStore(memoryStorage({ [STORAGE_KEY]: '"x"' }))).toEqual(emptyStore());
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
    const source = exampleStore();
    source.profiles[0]!.riderKg = 85;
    source.profiles.push({ ...structuredClone(source.profiles[1]!), id: 'kid', name: 'Kid bike', riderKg: 30 });
    const file = JSON.stringify(exportStore(source));

    const { store, added, updated } = importInto(exampleStore(), file);
    expect(added).toBe(1);
    expect(updated).toBe(2);
    expect(store.profiles.find((p) => p.id === ROAD_BIKE.id)?.riderKg).toBe(85);
    expect(store.profiles.find((p) => p.id === 'kid')?.name).toBe('Kid bike');
  });

  it('rejects bikes whose tire minimum is above the maximum', () => {
    const source = exampleStore();
    source.profiles[1]!.tireMinPsi = 80; // the gravel bike is hookless: 5 bar max
    const file = JSON.stringify(exportStore(source));
    expect(() => importInto(exampleStore(), file)).toThrow(/“Gravel bike” has a tire minimum above/);
    source.profiles[1]!.tireMinPsi = 40;
    expect(() => importInto(exampleStore(), JSON.stringify(exportStore(source)))).not.toThrow();
  });

  it('keeps rides of bikes with ids that are Object.prototype keys, and drops __proto__', () => {
    const gravel = GRAVEL_BIKE;
    const raw = {
      profiles: [{ ...gravel, id: 'constructor' }, { ...gravel, id: 'toString' }, { ...gravel, id: '__proto__' }],
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
    expect(() => importInto(exampleStore(), 'garbage')).toThrow(/not valid JSON/);
    expect(() => importInto(exampleStore(), '{"profiles": []}')).toThrow(/not a tire pressure export/);
    expect(() => importInto(exampleStore(), '{"app": "tire-pressure", "profiles": []}')).toThrow(/no bikes/);
  });
});
