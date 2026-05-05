/** URL ↔ admin API query mapping for the webhook monitor (no secrets). */

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
};

export function parseWebhookMonitorSearchParams(sp: {
  [key: string]: string | string[] | undefined;
}): WebhookMonitorUrlQuery {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
  };

  return {
    q: get("q"),
    processingStatus: get("status"),
    httpStatus: get("http"),
    source: get("source"),
    clientAccountId: get("client"),
    from: get("from"),
    to: get("to"),
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
};

/** Build params sent to GET /admin/v1/coc/webhook-requests (excludes client-only `q`). */
export function webhookMonitorToAdminApiParams(query: WebhookMonitorUrlQuery): AdminWebhookFetchParams {
  const params: AdminWebhookFetchParams = {
    limit: 200,
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

  if (query.from?.trim()) params.from = query.from.trim();
  if (query.to?.trim()) params.to = query.to.trim();

  return params;
}
