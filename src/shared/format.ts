/**
 * Display-time helpers.
 *
 * Phase 1 only formats total tracked time. Phase 2 reuses
 * `formatDurationMs` for the live timer and for entry lists.
 *
 * The "compact" form is what the card chips show: `2h 14m`,
 * `45m`, `12s`, `0m`. The "verbose" form is what entries show:
 * `2 h 14 m 03 s`.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Format a duration in milliseconds as a short human-readable
 *  string suitable for card chips. */
export function formatDurationCompact(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  if (safe >= DAY_MS) {
    const days = Math.floor(safe / DAY_MS);
    const hours = Math.floor((safe % DAY_MS) / HOUR_MS);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (safe >= HOUR_MS) {
    const hours = Math.floor(safe / HOUR_MS);
    const minutes = Math.floor((safe % HOUR_MS) / MINUTE_MS);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (safe >= MINUTE_MS) {
    const minutes = Math.floor(safe / MINUTE_MS);
    return `${minutes}m`;
  }
  const seconds = Math.floor(safe / 1000);
  return `${seconds}s`;
}

/** Total tracked time on a card, summed from closed entries. */
export function totalTrackedMs(
  entries: ReadonlyArray<{ startAt: number; endAt: number | null }>,
  now: number = Date.now(),
): number {
  let total = 0;
  for (const e of entries) {
    const end = e.endAt ?? now;
    if (end > e.startAt) total += end - e.startAt;
  }
  return total;
}

/** Format an ISO date (YYYY-MM-DD) as a short human string. */
export function formatDueDate(iso: string | undefined): string | null {
  if (!iso) return null;
  // We treat the string as a calendar date (no time / no TZ).
  // Parse it explicitly to avoid the Date() timezone shift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** Validate that a string is YYYY-MM-DD. */
export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
