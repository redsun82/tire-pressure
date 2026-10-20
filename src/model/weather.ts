/**
 * The current outside temperature from Open-Meteo (free, no key, CC BY 4.0), for the browser's
 * location rounded to about 1 km. https://open-meteo.com/en/docs
 */
import { LookupError, type Reading } from './lookup';

export const WEATHER_ATTRIBUTION = { name: 'Open-Meteo.com', url: 'https://open-meteo.com/' } as const;

/** Two decimals: about 1 km, plenty for the weather and less precise than the exact position. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function weatherUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: roundCoordinate(latitude).toFixed(2),
    longitude: roundCoordinate(longitude).toFixed(2),
    current: 'temperature_2m',
    timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseWeather(body: unknown): Reading {
  const current = typeof body === 'object' && body !== null ? (body as { current?: unknown }).current : undefined;
  const temp = typeof current === 'object' && current !== null ? (current as { temperature_2m?: unknown }).temperature_2m : undefined;
  if (typeof temp !== 'number' || !Number.isFinite(temp)) throw new LookupError('The weather service sent an unexpected answer.');
  const time = (current as { time?: unknown }).time;
  const measuredAt = typeof time === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time) ? new Date(`${time}Z`) : null;
  return { tempC: temp, measuredAt };
}

export async function readWeather(latitude: number, longitude: number, fetchFn: typeof fetch = fetch): Promise<Reading> {
  let response: Response;
  try {
    response = await fetchFn(weatherUrl(latitude, longitude));
  } catch {
    throw new LookupError("Couldn't reach the weather service. Are you online?");
  }
  if (!response.ok) throw new LookupError(`The weather service answered with an error (${response.status}).`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LookupError('The weather service sent an unexpected answer.');
  }
  return parseWeather(body);
}

/** The user said no to location access, or closed the browser's prompt without answering. */
export class LocationDeniedError extends LookupError {}

/** The browser's position, with messages for the usual failures. */
export function currentPosition(
  geolocation: Geolocation | null | undefined = globalThis.navigator?.geolocation,
): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(new LookupError('This browser has no location access.'));
      return;
    }
    geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (error) =>
        reject(
          error.code === error.PERMISSION_DENIED
            ? new LocationDeniedError('Location access is off for this app. Allow it in the browser settings, or set the temperature by hand.')
            : new LookupError("Couldn't get your location. Try again, or set the temperature by hand."),
        ),
      // City-level is enough, and a recent fix saves battery.
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 20_000 },
    );
  });
}

export type LocationPermission = PermissionState | 'unknown';

/** Whether the browser would give the position, ask for it, or refuses: 'unknown' without the Permissions API. */
export async function locationPermission(
  permissions: Permissions | undefined = globalThis.navigator?.permissions,
): Promise<LocationPermission> {
  try {
    return permissions ? (await permissions.query({ name: 'geolocation' })).state : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Whether to look the position up without a tap. The browser may ask the user once; after they
 * said no or closed the prompt (`declined`), only a tap asks again, so the app never nags.
 */
export function mayLocateUntapped(permission: LocationPermission, declined: boolean): boolean {
  if (permission === 'granted') return true;
  if (permission === 'denied') return false;
  return !declined;
}
