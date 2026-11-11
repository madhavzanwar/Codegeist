const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  // Jira due dates are plain YYYY-MM-DD; treat them as end of that day UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/** Human friendly duration, e.g. "3.5 days" or "5 hours". */
export function formatAge(hours: number): string {
  const h = Math.max(0, hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  const days = h / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fraction (0..1) of the sprint that has elapsed, or null if dates are missing/invalid. */
export function elapsedFraction(start: string | undefined, end: string | undefined, now: Date): number | null {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e || e.getTime() <= s.getTime()) return null;
  const f = (now.getTime() - s.getTime()) / (e.getTime() - s.getTime());
  return Math.min(1, Math.max(0, f));
}
