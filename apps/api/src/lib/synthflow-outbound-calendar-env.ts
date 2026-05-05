/**
 * Optional JSON map for outbound scheduling hints (no invented URLs — ops supply real IDs/links).
 * Env: `SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON`
 *
 * ```json
 * {
 *   "byAgentId": { "user_abc": { "calendarId": "cal_1", "calendarLink": "https://..." } },
 *   "defaultByClientAccountId": { "ca_xyz": { "calendarId": "cal_2", "calendarLink": "https://..." } }
 * }
 * ```
 */
export type OutboundCalendarEntry = {
  calendarId: string;
  calendarLink?: string;
};

export type OutboundCalendarMap = {
  byAgentId?: Record<string, OutboundCalendarEntry>;
  defaultByClientAccountId?: Record<string, OutboundCalendarEntry>;
};

export type OutboundCalendarResolution = {
  entry: OutboundCalendarEntry | null;
  /** Where the calendar row came from for logging / fallback_used. */
  source: "agent" | "client_default" | "none";
};

let cached: { raw: string; map: OutboundCalendarMap } | null = null;

function normalizeEntry(raw: OutboundCalendarEntry): OutboundCalendarEntry | null {
  const id = raw.calendarId?.trim() ?? "";
  if (!id) {
    return null;
  }
  const link = raw.calendarLink?.trim();
  return {
    calendarId: id,
    ...(link ? { calendarLink: link } : {}),
  };
}

function readMapFromEnv(): OutboundCalendarMap {
  const raw = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON?.trim() ?? "";
  if (cached && cached.raw === raw) {
    return cached.map;
  }
  if (!raw) {
    cached = { raw, map: {} };
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as OutboundCalendarMap;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      cached = { raw, map: {} };
      return {};
    }
    cached = { raw, map: parsed };
    return parsed;
  } catch {
    cached = { raw, map: {} };
    return {};
  }
}

export function resolveOutboundCalendarEntry(params: {
  clientAccountId: string;
  assignedAgentId?: string | null;
}): OutboundCalendarResolution {
  const map = readMapFromEnv();
  const agentKey = params.assignedAgentId?.trim();
  if (agentKey && map.byAgentId?.[agentKey]) {
    const n = normalizeEntry(map.byAgentId[agentKey]!);
    if (n) {
      return { entry: n, source: "agent" };
    }
  }
  const cid = params.clientAccountId.trim();
  if (cid && map.defaultByClientAccountId?.[cid]) {
    const n = normalizeEntry(map.defaultByClientAccountId[cid]!);
    if (n) {
      return { entry: n, source: "client_default" };
    }
  }
  return { entry: null, source: "none" };
}

/** Test helper: clear cached JSON map. */
export function resetOutboundCalendarMapCacheForTests(): void {
  cached = null;
}
