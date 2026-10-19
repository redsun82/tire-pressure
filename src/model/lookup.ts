/** A temperature looked up from a sensor or a weather service. */
export interface Reading {
  tempC: number;
  /** When it was measured, if known. */
  measuredAt: Date | null;
}

/** A failure to show the user as is. */
export class LookupError extends Error {}

/** "now", "12 min ago", "3 h ago", "2 days ago". */
export function formatAge(measuredAt: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - measuredAt.getTime()) / 60_000);
  if (minutes < 2) return 'now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Older readings are flagged: the sensor may be offline or out of battery. */
export const STALE_AFTER_MS = 12 * 60 * 60_000;
