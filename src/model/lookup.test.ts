import { describe, expect, it, vi } from 'vitest';
import { LookupError, formatAge } from './lookup';
import {
  SHELLY_STORAGE_KEY,
  loadShelly,
  normalizeDeviceId,
  normalizeServer,
  normalizeShelly,
  parseDeviceStatus,
  readShelly,
  saveShelly,
} from './shelly';
import { exportStore, seedStore } from './store';
import {
  LocationDeniedError,
  currentPosition,
  locationPermission,
  mayLocateUntapped,
  parseWeather,
  readWeather,
  roundCoordinate,
  weatherUrl,
} from './weather';

const CONFIG = { server: 'https://shelly-103-eu.shelly.cloud', authKey: 'secret-key', deviceId: 'e4b063d1a2b4' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('shelly config', () => {
  it('accepts the server as shown in the Shelly app, with or without scheme and path', () => {
    expect(normalizeServer('shelly-103-eu.shelly.cloud')).toBe(CONFIG.server);
    expect(normalizeServer(' https://Shelly-103-EU.shelly.cloud/ ')).toBe(CONFIG.server);
    expect(normalizeServer('https://shelly-103-eu.shelly.cloud/device/status?x=1')).toBe(CONFIG.server);
  });

  it('never sends the key anywhere but Shelly Cloud', () => {
    for (const bad of [
      'http://shelly-103-eu.shelly.cloud',
      'shelly-103-eu.shelly.cloud.evil.com',
      'evil.com/shelly-103-eu.shelly.cloud',
      'shelly-1.shelly.cloud@evil.com',
      'shelly-1.shelly.cloud:8080',
      'example.com',
      '',
    ]) {
      expect(normalizeServer(bad), bad).toBeNull();
    }
  });

  it('normalizes device ids', () => {
    expect(normalizeDeviceId(' E4B063D1A2B4 ')).toBe('e4b063d1a2b4');
    expect(normalizeDeviceId('shellyhtg3-e4b063d1a2b4')).toBe('e4b063d1a2b4');
    expect(normalizeDeviceId('shellyht-1234')).toBeNull();
    expect(normalizeDeviceId('')).toBeNull();
  });

  it('rejects incomplete configs', () => {
    expect(normalizeShelly({ ...CONFIG, authKey: '  ' })).toBeNull();
    expect(normalizeShelly({ ...CONFIG, server: 'example.com' })).toBeNull();
    expect(normalizeShelly({ ...CONFIG, deviceId: 7 })).toBeNull();
    expect(normalizeShelly(null)).toBeNull();
  });

  it('round-trips through its own storage key and can be removed', () => {
    const storage = memoryStorage();
    saveShelly(storage, CONFIG);
    expect([...storage.data.keys()]).toEqual([SHELLY_STORAGE_KEY]);
    expect(loadShelly(storage)).toEqual(CONFIG);
    saveShelly(storage, null);
    expect(loadShelly(storage)).toBeNull();
  });

  it('ignores corrupt or tampered storage', () => {
    expect(loadShelly(memoryStorage({ [SHELLY_STORAGE_KEY]: '{' }))).toBeNull();
    expect(loadShelly(memoryStorage({ [SHELLY_STORAGE_KEY]: JSON.stringify({ ...CONFIG, server: 'evil.com' }) }))).toBeNull();
  });

  it('is never part of an export', () => {
    const exported = JSON.stringify(exportStore(seedStore()));
    expect(exported).not.toMatch(/auth/i);
    expect(exported).not.toContain(CONFIG.authKey);
  });
});

describe('shelly status', () => {
  it('reads Gen2+ sensors', () => {
    const reading = parseDeviceStatus({ 'temperature:0': { id: 0, tC: 21.4, tF: 70.5 }, sys: { unixtime: 1_718_800_000 } });
    expect(reading).toEqual({ tempC: 21.4, measuredAt: new Date(1_718_800_000_000) });
  });

  it('reads add-on probes, preferring a built-in sensor, then the lowest probe', () => {
    expect(parseDeviceStatus({ 'temperature:101': { id: 101, tC: 7.5 }, 'temperature:100': { id: 100, tC: 19.1 } }).tempC).toBe(19.1);
    expect(parseDeviceStatus({ 'temperature:100': { id: 100, tC: 19.1 }, 'temperature:0': { id: 0, tC: 21 } }).tempC).toBe(21);
    // A probe that is unplugged reports tC null.
    expect(parseDeviceStatus({ 'temperature:100': { id: 100, tC: null }, 'temperature:101': { id: 101, tC: 7.5 } }).tempC).toBe(7.5);
  });

  it('reads Gen1 H&T', () => {
    const reading = parseDeviceStatus({ tmp: { value: 19.5, units: 'C', tC: 19.5, tF: 67.1, is_valid: true }, unixtime: 1_718_800_000 });
    expect(reading.tempC).toBe(19.5);
  });

  it("prefers the reading's own time to the device clock", () => {
    const reading = parseDeviceStatus({
      'temperature:100': { id: 100, tC: 18, _updated: '2024-06-18 08:00:00' },
      sys: { unixtime: 1_718_800_000 },
      _updated: '2024-06-19 13:22:10',
    });
    expect(reading.measuredAt?.toISOString()).toBe('2024-06-18T08:00:00.000Z');
  });

  it('falls back to the cloud update time, in UTC', () => {
    const reading = parseDeviceStatus({ 'temperature:0': { tC: 18 }, sys: { unixtime: 0 }, _updated: '2024-06-19 13:22:10' });
    expect(reading.measuredAt?.toISOString()).toBe('2024-06-19T13:22:10.000Z');
  });

  it('has no time when the cloud does not say', () => {
    expect(parseDeviceStatus({ 'temperature:0': { tC: 18 } }).measuredAt).toBeNull();
  });

  it("does not take a relay's internal temperature for the room", () => {
    expect(() => parseDeviceStatus({ 'switch:0': { temperature: { tC: 45 } } })).toThrow(LookupError);
    // Gen1 1PM / 2.5: `tmp` without `units`, next to relay state.
    expect(() =>
      parseDeviceStatus({ relays: [{ ison: true }], temperature: 45, overtemperature: false, tmp: { tC: 45, tF: 113, is_valid: true } }),
    ).toThrow('no temperature sensor reading');
    expect(() => parseDeviceStatus({ tmp: { tC: 45, tF: 113, is_valid: true } })).toThrow(LookupError);
  });

  it('reads Gen1 add-on probes next to a relay, preferring the lowest index', () => {
    const relay = { relays: [{ ison: true }], temperature: 45, overtemperature: false, tmp: { tC: 45, tF: 113, is_valid: true }, unixtime: 1_718_800_000 };
    const probe = (tC: number | null, hwID: string) => ({ tC, tF: tC === null ? null : (tC * 9) / 5 + 32, hwID });
    expect(parseDeviceStatus({ ...relay, ext_temperature: { '1': probe(7.5, '28a1'), '0': probe(19.1, '28b2') } })).toEqual({
      tempC: 19.1,
      measuredAt: new Date(1_718_800_000_000),
    });
    expect(parseDeviceStatus({ ...relay, ext_temperature: { '0': probe(null, '28b2'), '1': probe(7.5, '28a1') } }).tempC).toBe(7.5);
    // Without a probe reading, the relay's own temperature is still not the room's.
    expect(() => parseDeviceStatus({ ...relay, ext_temperature: {} })).toThrow('no temperature');
  });

  it('rejects invalid Gen1 readings', () => {
    expect(() => parseDeviceStatus({ tmp: { value: 999, units: 'C', tC: 999, is_valid: false } })).toThrow('no temperature');
  });

  it('posts the device id and key to the configured server', async () => {
    const fetchFn = vi.fn(async () => json({ isok: true, data: { online: false, device_status: { 'temperature:0': { tC: 20.5 } } } }));
    expect((await readShelly(CONFIG, fetchFn)).tempC).toBe(20.5);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://shelly-103-eu.shelly.cloud/device/status');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ id: 'e4b063d1a2b4', auth_key: 'secret-key' });
  });

  it('explains a rejected key', async () => {
    const fetchFn = async () => json({ isok: false, errors: { invalid_token: 'Invalid token' }, error: 'UNAUTHORIZED' }, 401);
    await expect(readShelly(CONFIG, fetchFn)).rejects.toThrow('rejected the cloud key');
  });

  it('passes on cloud errors', async () => {
    const fetchFn = async () => json({ isok: false, errors: { device_not_found: 'Device not found!' } });
    await expect(readShelly(CONFIG, fetchFn)).rejects.toThrow('Shelly Cloud: Device not found!');
  });

  it('explains being offline', async () => {
    const fetchFn = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(readShelly(CONFIG, fetchFn)).rejects.toThrow('Are you online?');
  });

  it('handles non-JSON errors', async () => {
    const fetchFn = async () => new Response('<html>busy</html>', { status: 503 });
    await expect(readShelly(CONFIG, fetchFn)).rejects.toThrow('(503)');
  });
});

describe('weather', () => {
  it('only sends the position rounded to about 1 km', () => {
    expect(roundCoordinate(45.46427)).toBe(45.46);
    expect(roundCoordinate(-0.125)).toBe(-0.12);
    const url = new URL(weatherUrl(45.46427, 9.18951));
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe('45.46');
    expect(url.searchParams.get('longitude')).toBe('9.19');
    expect(url.searchParams.get('current')).toBe('temperature_2m');
  });

  it('reads the current temperature and its time in UTC', () => {
    expect(parseWeather({ current: { time: '2024-06-19T13:15', interval: 900, temperature_2m: 13.2 } })).toEqual({
      tempC: 13.2,
      measuredAt: new Date('2024-06-19T13:15:00Z'),
    });
  });

  it('rejects unexpected answers', () => {
    for (const body of [null, {}, { current: {} }, { current: { temperature_2m: 'warm' } }]) {
      expect(() => parseWeather(body)).toThrow(LookupError);
    }
  });

  it('fetches and maps failures', async () => {
    expect((await readWeather(45.46, 9.19, async () => json({ current: { temperature_2m: -3.4 } }))).tempC).toBe(-3.4);
    await expect(readWeather(45.46, 9.19, async () => json({ reason: 'x' }, 400))).rejects.toThrow('(400)');
    await expect(
      readWeather(45.46, 9.19, async () => {
        throw new TypeError('offline');
      }),
    ).rejects.toThrow('Are you online?');
  });

  it('explains denied location access', async () => {
    const denied = {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError),
    } as Geolocation;
    await expect(currentPosition(denied)).rejects.toThrow('Location access is off');
    await expect(currentPosition(denied)).rejects.toBeInstanceOf(LocationDeniedError);
    await expect(currentPosition(null)).rejects.toThrow('no location access');
    const timeout = {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError),
    } as Geolocation;
    const error = await currentPosition(timeout).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LookupError);
    expect(error).not.toBeInstanceOf(LocationDeniedError);
  });

  it('reads the location permission, if the browser tells', async () => {
    const permissions = (state: PermissionState) => ({ query: async () => ({ state }) }) as unknown as Permissions;
    expect(await locationPermission(permissions('granted'))).toBe('granted');
    expect(await locationPermission(permissions('denied'))).toBe('denied');
    expect(await locationPermission(undefined)).toBe('unknown');
    const unsupported = { query: () => Promise.reject(new TypeError('geolocation')) } as unknown as Permissions;
    expect(await locationPermission(unsupported)).toBe('unknown');
  });

  it('only asks for the location without a tap until the user said no', () => {
    expect(mayLocateUntapped('granted', false)).toBe(true);
    expect(mayLocateUntapped('granted', true)).toBe(true);
    expect(mayLocateUntapped('denied', false)).toBe(false);
    expect(mayLocateUntapped('prompt', false)).toBe(true);
    expect(mayLocateUntapped('prompt', true)).toBe(false);
    expect(mayLocateUntapped('unknown', false)).toBe(true);
    expect(mayLocateUntapped('unknown', true)).toBe(false);
  });
});

describe('formatAge', () => {
  const now = new Date('2024-06-19T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it('reads naturally', () => {
    expect(formatAge(ago(1), now)).toBe('now');
    expect(formatAge(ago(12), now)).toBe('12 min ago');
    expect(formatAge(ago(150), now)).toBe('3 h ago');
    expect(formatAge(ago(3 * 24 * 60), now)).toBe('3 days ago');
  });
});
