/**
 * Calendar-safe date handling for admin-coc.
 *
 * Root issue: `new Date("YYYY-MM-DD")` parses as **UTC midnight**, so local users west of UTC
 * see the previous calendar day when using local getters. We parse date-only strings into
 * explicit local components instead.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Legacy Kanban/API payloads stored calendar dates as UTC midnight (`…T00:00:00.000Z`). */
const LEGACY_UTC_DATE_ONLY_ISO = /^(\d{4})-(\d{2})-(\d{2})T00:00:00\.000Z$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse `YYYY-MM-DD` as a plain calendar date (no timezone).
 */
export function parseDateOnlyLocal(dateString: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const m = DATE_ONLY_RE.exec(dateString.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Format a Date's **local** calendar fields as `YYYY-MM-DD` (for `<input type="date">`).
 */
export function formatDateOnlyLocal(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Local start/end of calendar day as ISO strings (for API `from` / `to` when filtering by date).
 */
export function dateOnlyToLocalDayRangeIso(
  dateOnly: string
): { startIso: string; endIso: string } | null {
  const p = parseDateOnlyLocal(dateOnly);
  if (!p) return null;
  const start = new Date(p.year, p.month - 1, p.day, 0, 0, 0, 0);
  const end = new Date(p.year, p.month - 1, p.day, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * `<input type="date">` → ISO instant at **local** midnight for that calendar day.
 */
export function dateOnlyInputToIso(dateOnly: string): string | null {
  const p = parseDateOnlyLocal(dateOnly);
  if (!p) return null;
  const d = new Date(p.year, p.month - 1, p.day, 0, 0, 0, 0);
  return d.toISOString();
}

/**
 * ISO timestamp → `<input type="date">` value preserving the intended calendar day.
 * - Legacy UTC-midnight dates (`YYYY-MM-DDT00:00:00.000Z`) use **UTC** calendar components.
 * - All other instants use **local** calendar components (local-midnight and full timestamps).
 */
export function isoToDateOnlyInputValue(iso: string | null | undefined): string {
  if (!iso?.trim()) return "";
  const s = iso.trim();
  const legacy = LEGACY_UTC_DATE_ONLY_ISO.exec(s);
  if (legacy) {
    return `${legacy[1]}-${legacy[2]}-${legacy[3]}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return formatDateOnlyLocal(d);
}

const DEFAULT_SHORT_DATE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
};

/**
 * Format an ISO instant using its **calendar day** in the user's timezone,
 * with legacy UTC-midnight date-only payloads (`…T00:00:00.000Z`) interpreted as that UTC calendar day.
 */
export function localeFormatCalendarDayFromIso(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_SHORT_DATE
): string | null {
  const ymd = isoToDateOnlyInputValue(iso ?? "");
  if (!ymd) return null;
  const p = parseDateOnlyLocal(ymd);
  if (!p) return null;
  const d = new Date(p.year, p.month - 1, p.day);
  return d.toLocaleDateString(undefined, options);
}

/**
 * Parse `YYYY-MM-DDTHH:mm` from `<input type="datetime-local">` as **local** wall time.
 */
export function parseDatetimeLocalString(value: string): Date | null {
  const m = DATETIME_LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return null;
  }
  return d;
}

/**
 * Format a Date as `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">` (local wall time).
 */
export function formatDatetimeLocalFromDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO string from URL/API → default value for `datetime-local`. */
export function isoStringToDatetimeLocalValue(iso: string | undefined): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return "";
  return formatDatetimeLocalFromDate(d);
}

/** `datetime-local` form value → ISO for query strings / API. */
export function datetimeLocalStringToIso(local: string): string | undefined {
  const d = parseDatetimeLocalString(local);
  if (!d) return undefined;
  return d.toISOString();
}
