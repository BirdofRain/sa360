/** URL ↔ admin API query mapping for the webhook monitor (no secrets). */

import {
  receivedAtFromMinutesAgo,
  type WebhookQuickChip,
  type WebhookReceivedAtSort,
} from "./webhook-monitor-utils.ts";

export type WebhookMonitorUrlQuery = {
  /** Client-side substring filter across lead + ids (not sent to API). */
  q?: string;
  processingStatus?: string;
  httpStatus?: string;
  source?: string;
  /** Exact match; maps to API `clientAccountId`. */
  clientAccountId?: string;
  /** ISO-ish datetime strings for API `from` / `to` on `receivedAt`. */
  from?: string;
  to?: string;
  chip?: WebhookQuickChip;
  hideErrors?: boolean;
  live?: boolean;
  sort?: WebhookReceivedAtSort;
};

const CHIP_VALUES = new Set<WebhookQuickChip>([
  "all",
  "stored",
  "errors",
  "unauthorized",
  "validation_failed",
  "last15m",
  "last1h",
]);

function parseChip(raw: string | undefined): WebhookQuickChip | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase() as WebhookQuickChip;
  return CHIP_VALUES.has(v) ? v : undefined;
}

export function parseWebhookMonitorSearchParams(sp: {
  [key: string]: string | string[] | undefined;
}): WebhookMonitorUrlQuery {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
  };

  const sortRaw = get("sort");
  const sort: WebhookReceivedAtSort | undefined =
    sortRaw === "asc" || sortRaw === "desc" ? sortRaw : undefined;

  return {
    q: get("q"),
    processingStatus: get("status"),
    httpStatus: get("http"),
    source: get("source"),
    clientAccountId: get("client"),
    from: get("from"),
    to: get("to"),
    chip: parseChip(get("chip")) ?? "all",
    hideErrors: get("hideErrors") === "1",
    live: get("live") === "1",
    sort: sort ?? "desc",
  };
}

export type AdminWebhookFetchParams = {
  limit?: number;
  cursor?: string;
  source?: string;
  processingStatus?: string;
  clientAccountId?: string;
  eventUuid?: string;
  eventNameInternal?: string;
  httpStatus?: number;
  from?: string;
  to?: string;
  sortBy?: "receivedAt";
  sortDirection?: WebhookReceivedAtSort;
};

/** Build params sent to GET /admin/v1/coc/webhook-requests (excludes client-only `q`, `chip`, `hideErrors`). */
export function webhookMonitorToAdminApiParams(
  query: WebhookMonitorUrlQuery,
  now: Date = new Date()
): AdminWebhookFetchParams {
  const params: AdminWebhookFetchParams = {
    limit: 200,
    sortBy: "receivedAt",
    sortDirection: query.sort ?? "desc",
  };

  if (query.processingStatus?.trim()) params.processingStatus = query.processingStatus.trim();

  if (query.httpStatus?.trim()) {
    const n = Number.parseInt(query.httpStatus.trim(), 10);
    if (!Number.isNaN(n)) params.httpStatus = n;
  }

  const src = query.source?.trim();
  if (src === "ghl_lifecycle" || src === "synthflow_inbound_lookup") {
    params.source = src;
  }

  if (query.clientAccountId?.trim()) params.clientAccountId = query.clientAccountId.trim();

  let from = query.from?.trim();
  const to = query.to?.trim();

  const chip = query.chip ?? "all";
  if (chip === "unauthorized") params.processingStatus = "unauthorized";
  if (chip === "validation_failed") params.processingStatus = "validation_failed";

  if (chip === "last15m" || query.live) {
    from = receivedAtFromMinutesAgo(15, now);
  } else if (chip === "last1h") {
    from = receivedAtFromMinutesAgo(60, now);
  }

  if (from) params.from = from;
  if (to) params.to = to;

  if (query.live) {
    params.sortDirection = "desc";
  }

  return params;
}

export type WebhookMonitorUrlState = WebhookMonitorUrlQuery;

/** Serialize monitor URL search params (preserves filters + UX toggles). */
export function buildWebhookMonitorSearchParams(
  state: WebhookMonitorUrlState,
  overrides: Partial<WebhookMonitorUrlState> = {}
): URLSearchParams {
  const merged = { ...state, ...overrides };
  const p = new URLSearchParams();

  if (merged.q?.trim()) p.set("q", merged.q.trim());
  if (merged.processingStatus?.trim()) p.set("status", merged.processingStatus.trim());
  if (merged.httpStatus?.trim()) p.set("http", merged.httpStatus.trim());
  if (merged.source?.trim()) p.set("source", merged.source.trim());
  if (merged.clientAccountId?.trim()) p.set("client", merged.clientAccountId.trim());
  if (merged.from?.trim()) p.set("from", merged.from.trim());
  if (merged.to?.trim()) p.set("to", merged.to.trim());

  const chip = merged.chip ?? "all";
  if (chip !== "all") p.set("chip", chip);

  if (merged.hideErrors) p.set("hideErrors", "1");
  if (merged.live) p.set("live", "1");

  const sort = merged.sort ?? "desc";
  if (sort !== "desc") p.set("sort", sort);

  return p;
}

export function webhookMonitorHref(state: WebhookMonitorUrlState, overrides?: Partial<WebhookMonitorUrlState>): string {
  const qs = buildWebhookMonitorSearchParams(state, overrides).toString();
  return qs ? `/webhooks?${qs}` : "/webhooks";
}
