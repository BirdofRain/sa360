/**
 * GHL M1A stamps `routing.calendar_id` / `routing.calendar_link` (and optional `sa360_*` aliases)
 * on lifecycle payloads. Normalize placeholders and extract usable values for outbound-context.
 */

const CURLY_PLACEHOLDER = /^\s*\{\{[\s\S]*\}\}\s*$/u;
const ANGLE_PLACEHOLDER = /^\s*<[^>]+>\s*$/u;

export function isUsableCalendarFieldValue(value: unknown): value is string {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== "string") {
    return false;
  }
  const t = value.trim();
  if (!t) {
    return false;
  }
  const lower = t.toLowerCase();
  if (lower === "null" || lower === "undefined") {
    return false;
  }
  if (CURLY_PLACEHOLDER.test(t) || ANGLE_PLACEHOLDER.test(t)) {
    return false;
  }
  return true;
}

export function normalizeRoutingCalendarField(value: unknown): string {
  return isUsableCalendarFieldValue(value) ? String(value).trim() : "";
}

export type RoutingCalendarExtract = {
  calendarId: string;
  calendarLink: string;
};

/**
 * Prefer `routing.calendar_id` / `routing.calendar_link`, then `sa360_calendar_id` / `sa360_calendar_link`.
 */
export function extractRoutingCalendarFromLifecyclePayload(payload: unknown): RoutingCalendarExtract {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { calendarId: "", calendarLink: "" };
  }
  const root = payload as Record<string, unknown>;
  const r = root.routing;
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    return { calendarId: "", calendarLink: "" };
  }
  const routing = r as Record<string, unknown>;

  const primaryId = normalizeRoutingCalendarField(routing.calendar_id);
  const primaryLink = normalizeRoutingCalendarField(routing.calendar_link);
  const sa360Id = normalizeRoutingCalendarField(routing.sa360_calendar_id);
  const sa360Link = normalizeRoutingCalendarField(routing.sa360_calendar_link);

  const calendarId = primaryId || sa360Id;
  const calendarLink = primaryLink || sa360Link;

  return { calendarId, calendarLink };
}
