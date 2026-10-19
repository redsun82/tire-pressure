/**
 * Reads an indoor temperature from a Shelly sensor through Shelly Cloud, so the sensor itself can
 * stay on an isolated network. Shelly Cloud answers browsers directly (CORS `*`).
 * https://shelly-api-docs.shelly.cloud/cloud-control-api/communication
 */

import { LookupError, type Reading } from './lookup';

/** Kept apart from the bikes (own storage key), so exports never contain the cloud key. */
export const SHELLY_STORAGE_KEY = 'tire-pressure:shelly';

export interface ShellyConfig {
  /** Origin of the account's cloud server, e.g. `https://shelly-103-eu.shelly.cloud`. */
  server: string;
  /** "Authorization cloud key" from the Shelly app: it can control every device on the account. */
  authKey: string;
  deviceId: string;
}

/**
 * The cloud server origin from what the Shelly app shows ("shelly-103-eu.shelly.cloud", with or
 * without https:// or a path), or null. Only Shelly Cloud hosts: the key must never go elsewhere.
 */
export function normalizeServer(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/[/?#].*$/, '');
  return /^shelly-[a-z0-9-]+\.shelly\.cloud$/.test(host) ? `https://${host}` : null;
}

/**
 * The cloud device id: hex, MAC-like ("e4b063d1a2b4"). Also accepted with the model prefix the
 * device shows as its name ("shellyhtg3-e4b063d1a2b4") and in upper case.
 */
export function normalizeDeviceId(input: string): string | null {
  const match = /^(?:[a-z0-9]+-)?([0-9a-f]{6,16})$/.exec(input.trim().toLowerCase());
  return match ? match[1]! : null;
}

export function normalizeShelly(value: unknown): ShellyConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const server = typeof raw.server === 'string' ? normalizeServer(raw.server) : null;
  const deviceId = typeof raw.deviceId === 'string' ? normalizeDeviceId(raw.deviceId) : null;
  const authKey = typeof raw.authKey === 'string' ? raw.authKey.trim() : '';
  return server && deviceId && authKey ? { server, authKey, deviceId } : null;
}

export function loadShelly(storage: Pick<Storage, 'getItem'>): ShellyConfig | null {
  const text = storage.getItem(SHELLY_STORAGE_KEY);
  if (!text) return null;
  try {
    return normalizeShelly(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveShelly(storage: Pick<Storage, 'setItem' | 'removeItem'>, config: ShellyConfig | null): void {
  if (config) storage.setItem(SHELLY_STORAGE_KEY, JSON.stringify(config));
  else storage.removeItem(SHELLY_STORAGE_KEY);
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `"2024-06-19 13:22:10"` from the cloud is UTC. */
function parseUpdated(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return null;
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The ambient temperature in a `device_status`: `temperature:0` on Gen2+ sensors (H&T, Plus H&T,
 * add-on probes), `tmp` on Gen1 H&T. A relay's internal temperature is not ambient and is ignored.
 */
export function parseDeviceStatus(status: unknown): Reading {
  if (!isObject(status)) throw new LookupError('Shelly Cloud sent an unexpected answer.');
  const gen2 = status['temperature:0'];
  const gen1 = status.tmp;
  let tempC: number | null = null;
  let updated: unknown = status._updated;
  if (isObject(gen2)) {
    tempC = finite(gen2.tC);
    updated = gen2._updated ?? updated;
  } else if (isObject(gen1) && gen1.is_valid !== false) {
    tempC = finite(gen1.tC) ?? (gen1.units === 'C' ? finite(gen1.value) : null);
  }
  if (tempC === null) throw new LookupError('This Shelly device has no temperature reading.');
  const sys = status.sys;
  const unix = finite(isObject(sys) ? sys.unixtime : null) ?? finite(status.unixtime);
  // Devices without a synced clock report unixtime 0.
  const measuredAt = unix !== null && unix > 1e9 ? new Date(unix * 1000) : parseUpdated(updated);
  return { tempC, measuredAt };
}

/** Reads the configured sensor. Sleeping battery sensors give their last report, which is fine. */
export async function readShelly(config: ShellyConfig, fetchFn: typeof fetch = fetch): Promise<Reading> {
  let response: Response;
  try {
    response = await fetchFn(`${config.server}/device/status`, {
      method: 'POST',
      body: new URLSearchParams({ id: config.deviceId, auth_key: config.authKey }),
    });
  } catch {
    throw new LookupError("Couldn't reach Shelly Cloud. Are you online?");
  }
  if (response.status === 401) throw new LookupError('Shelly Cloud rejected the cloud key. Check the sensor setup.');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LookupError(`Shelly Cloud answered with an error (${response.status}).`);
  }
  if (!isObject(body) || body.isok !== true || !isObject(body.data)) {
    const errors = isObject(body) && isObject(body.errors) ? Object.values(body.errors).filter((e) => typeof e === 'string') : [];
    throw new LookupError(errors.length ? `Shelly Cloud: ${errors.join(' ')}` : `Shelly Cloud answered with an error (${response.status}).`);
  }
  return parseDeviceStatus(body.data.device_status);
}
