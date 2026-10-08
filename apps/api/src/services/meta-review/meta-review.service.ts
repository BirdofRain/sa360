import { createHmac } from "node:crypto";

import { DEFAULT_GRAPH_API_VERSION } from "../../lib/meta-webhook.js";

export const META_REVIEW_SUBSCRIPTION_CONFIRMATION = "SUBSCRIBE LEADGEN";
export const META_REVIEW_PERMISSIONS = [
  "pages_manage_metadata",
  "pages_show_list",
  "pages_read_engagement",
  "ads_read",
  "leads_retrieval",
] as const;

export type MetaReviewConfig = {
  enabled: boolean;
  writesEnabled: boolean;
  graphApiVersion: string;
  userAccessToken: string | null;
  pageAccessToken: string | null;
  pageAccessTokenPageId: string | null;
  appId: string | null;
  appSecret: string | null;
  allowedPageIds: ReadonlySet<string>;
  allowedAdAccountIds: ReadonlySet<string>;
  callbackConfigured: boolean;
  intakeEnabled: boolean;
  graphFetchEnabled: boolean;
  routingEnabled: boolean;
  legacyDirectIntakeEnabled: boolean;
};

export type MetaReviewTrace = {
  method: "GET" | "POST";
  endpoint: string;
  httpStatus: number;
  ok: boolean;
  timestamp: string;
  error: {
    code: string | null;
    subcode: string | null;
    type: string | null;
    message: string;
  } | null;
};

export class MetaReviewError extends Error {
  constructor(
    readonly code:
      | "feature_disabled"
      | "writes_disabled"
      | "token_unavailable"
      | "not_allowlisted"
      | "invalid_input"
      | "graph_error"
      | "confirmation_required"
      | "app_id_unavailable",
    readonly httpStatus: number,
    message: string,
    readonly trace: MetaReviewTrace | null = null
  ) {
    super(message);
    this.name = "MetaReviewError";
  }
}

type FetchLike = typeof fetch;

function envFlag(name: string): boolean {
  return (process.env[name]?.trim() ?? "").toLowerCase() === "true";
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function idSet(name: string): ReadonlySet<string> {
  const values = (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^act_/, ""))
    .filter((value) => /^\d{5,32}$/.test(value));
  return new Set(values);
}

export function getMetaReviewConfig(): MetaReviewConfig {
  return {
    enabled: envFlag("SA360_META_REVIEW_ENABLED"),
    writesEnabled: envFlag("SA360_META_REVIEW_WRITES_ENABLED"),
    graphApiVersion: envValue("META_GRAPH_API_VERSION") ?? DEFAULT_GRAPH_API_VERSION,
    userAccessToken: envValue("META_REVIEW_USER_ACCESS_TOKEN"),
    pageAccessToken: envValue("META_PAGE_ACCESS_TOKEN"),
    pageAccessTokenPageId: envValue("META_PAGE_ACCESS_TOKEN_PAGE_ID"),
    appId: envValue("META_REVIEW_APP_ID"),
    appSecret: envValue("META_APP_SECRET"),
    allowedPageIds: idSet("SA360_META_REVIEW_ALLOWED_PAGE_IDS"),
    allowedAdAccountIds: idSet("SA360_META_REVIEW_ALLOWED_AD_ACCOUNT_IDS"),
    callbackConfigured: Boolean(envValue("META_WEBHOOK_VERIFY_TOKEN") && envValue("META_APP_SECRET")),
    intakeEnabled: envFlag("SA360_META_LEAD_ADS_INTAKE_ENABLED"),
    graphFetchEnabled: envFlag("SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED"),
    routingEnabled: envFlag("SA360_META_LEAD_ADS_ROUTING_ENABLED"),
    legacyDirectIntakeEnabled: envFlag("FACEBOOK_DIRECT_INTAKE_ENABLED"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 50)
    : [];
}

function sanitizeMessage(value: unknown, config: MetaReviewConfig): string {
  let message = typeof value === "string" ? value : "Meta Graph API request failed.";
  for (const secret of [
    config.userAccessToken,
    config.pageAccessToken,
    config.appSecret,
  ]) {
    if (secret) message = message.split(secret).join("***REDACTED***");
  }
  return message
    .replace(/EAA[A-Za-z0-9_-]{12,}/g, "***REDACTED***")
    .replace(/([?&](?:access_token|appsecret_proof|input_token)=)[^&\s]+/gi, "$1***REDACTED***")
    .slice(0, 300);
}

function readGraphError(
  body: unknown,
  config: MetaReviewConfig
): MetaReviewTrace["error"] {
  const error = asRecord(asRecord(body)?.error);
  if (!error) {
    return {
      code: null,
      subcode: null,
      type: null,
      message: "Meta Graph API request failed.",
    };
  }
  const code = error.code;
  const subcode = error.error_subcode;
  return {
    code: typeof code === "number" || typeof code === "string" ? String(code) : null,
    subcode:
      typeof subcode === "number" || typeof subcode === "string" ? String(subcode) : null,
    type: stringValue(error.type),
    message: sanitizeMessage(error.message, config),
  };
}

function assertEnabled(config: MetaReviewConfig): void {
  if (!config.enabled) {
    throw new MetaReviewError("feature_disabled", 404, "Meta review tooling is disabled.");
  }
}

function assertAllowed(
  value: string,
  allowlist: ReadonlySet<string>,
  label: "Page" | "ad account"
): void {
  if (!allowlist.has(value)) {
    throw new MetaReviewError(
      "not_allowlisted",
      403,
      `${label} is not in the dedicated Meta review allowlist.`
    );
  }
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim().replace(/^act_/, "");
  if (!/^\d{5,32}$/.test(normalized)) {
    throw new MetaReviewError("invalid_input", 400, `${label} must be a numeric Meta ID.`);
  }
  return normalized;
}

function proofFor(token: string, secret: string | null): string | null {
  return secret ? createHmac("sha256", secret).update(token, "utf8").digest("hex") : null;
}

async function graphCall(input: {
  method: "GET" | "POST";
  path: string;
  traceEndpoint: string;
  token: string | null;
  config: MetaReviewConfig;
  params?: URLSearchParams;
  fetchImpl?: FetchLike;
}): Promise<{ body: unknown; trace: MetaReviewTrace }> {
  assertEnabled(input.config);
  if (!input.token) {
    throw new MetaReviewError(
      "token_unavailable",
      409,
      "The required server-side Meta token is not configured."
    );
  }
  const params = new URLSearchParams(input.params);
  const proof = proofFor(input.token, input.config.appSecret);
  if (proof) params.set("appsecret_proof", proof);
  const query = params.toString();
  const url = `https://graph.facebook.com/${input.config.graphApiVersion}/${input.path}${
    query ? `?${query}` : ""
  }`;
  const timestamp = new Date().toISOString();
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: input.method,
      headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    const trace: MetaReviewTrace = {
      method: input.method,
      endpoint: input.traceEndpoint,
      httpStatus: 0,
      ok: false,
      timestamp,
      error: {
        code: null,
        subcode: null,
        type: "network_error",
        message: "Meta Graph API request could not be completed.",
      },
    };
    throw new MetaReviewError("graph_error", 502, trace.error.message, trace);
  }
  const body = (await response.json().catch(() => null)) as unknown;
  const trace: MetaReviewTrace = {
    method: input.method,
    endpoint: input.traceEndpoint,
    httpStatus: response.status,
    ok: response.ok,
    timestamp,
    error: response.ok ? null : readGraphError(body, input.config),
  };
  if (!response.ok) {
    throw new MetaReviewError(
      "graph_error",
      response.status >= 400 && response.status < 500 ? response.status : 502,
      trace.error?.message ?? "Meta Graph API request failed.",
      trace
    );
  }
  return { body, trace };
}

function dataRows(body: unknown): Record<string, unknown>[] {
  const data = asRecord(body)?.data;
  return Array.isArray(data)
    ? data.map(asRecord).filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

export function getMetaReviewPreflight(config = getMetaReviewConfig()) {
  assertEnabled(config);
  return {
    enabled: config.enabled,
    writesEnabled: config.writesEnabled,
    graphApiVersion: config.graphApiVersion,
    tokens: {
      userOrSystemUser: { configured: Boolean(config.userAccessToken), masked: config.userAccessToken ? "configured (masked)" : "not configured" },
      page: {
        configured: Boolean(config.pageAccessToken),
        masked: config.pageAccessToken ? "configured (masked)" : "not configured",
        boundPageId: config.pageAccessTokenPageId,
      },
    },
    allowlists: {
      pageIds: [...config.allowedPageIds],
      adAccountIds: [...config.allowedAdAccountIds].map((id) => `act_${id}`),
    },
    callback: {
      configured: config.callbackConfigured,
      routes: ["/sources/facebook/lead-created", "/webhooks/meta/leadgen"],
    },
    productionSafety: {
      intakeEnabled: config.intakeEnabled,
      graphFetchEnabled: config.graphFetchEnabled,
      routingEnabled: config.routingEnabled,
      legacyDirectIntakeEnabled: config.legacyDirectIntakeEnabled,
      safeForReview:
        !config.intakeEnabled &&
        !config.graphFetchEnabled &&
        !config.routingEnabled &&
        !config.legacyDirectIntakeEnabled,
    },
    requiredTokens: {
      pages: "User or System User access token",
      permissions: "User or System User access token",
      subscription: "Page access token",
      posts: "Page access token",
      insights: "User or System User access token with ad-account access",
    },
  };
}

export async function listMetaReviewPages(
  config = getMetaReviewConfig(),
  fetchImpl?: FetchLike
) {
  const fields = "id,name,tasks";
  const result = await graphCall({
    method: "GET",
    path: "me/accounts",
    traceEndpoint: `/${config.graphApiVersion}/me/accounts?fields=${fields}`,
    token: config.userAccessToken,
    config,
    params: new URLSearchParams({ fields, limit: "50" }),
    fetchImpl,
  });
  const items = dataRows(result.body)
    .map((row) => ({
      id: stringValue(row.id),
      name: stringValue(row.name),
      tasks: stringArray(row.tasks),
    }))
    .filter(
      (item): item is { id: string; name: string | null; tasks: string[] } =>
        Boolean(item.id && config.allowedPageIds.has(item.id))
    );
  return { items, trace: result.trace };
}

export async function listMetaReviewPermissions(
  config = getMetaReviewConfig(),
  fetchImpl?: FetchLike
) {
  const result = await graphCall({
    method: "GET",
    path: "me/permissions",
    traceEndpoint: `/${config.graphApiVersion}/me/permissions`,
    token: config.userAccessToken,
    config,
    params: new URLSearchParams({ fields: "permission,status" }),
    fetchImpl,
  });
  const allowed = new Set<string>(META_REVIEW_PERMISSIONS);
  const items = dataRows(result.body)
    .map((row) => ({
      permission: stringValue(row.permission),
      status: stringValue(row.status),
    }))
    .filter(
      (item): item is { permission: string; status: string | null } =>
        Boolean(item.permission && allowed.has(item.permission))
    );
  return { items, trace: result.trace };
}

export async function getMetaReviewSubscription(
  pageIdInput: string,
  config = getMetaReviewConfig(),
  fetchImpl?: FetchLike
) {
  const pageId = normalizeId(pageIdInput, "Page ID");
  assertAllowed(pageId, config.allowedPageIds, "Page");
  const fields = "id,name,subscribed_fields";
  const result = await graphCall({
    method: "GET",
    path: `${pageId}/subscribed_apps`,
    traceEndpoint: `/${config.graphApiVersion}/${pageId}/subscribed_apps?fields=${fields}`,
    token: config.pageAccessToken,
    config,
    params: new URLSearchParams({ fields, limit: "25" }),
    fetchImpl,
  });
  const items = dataRows(result.body).map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name),
    subscribedFields: stringArray(row.subscribed_fields),
  }));
  return { pageId, items, trace: result.trace };
}

export async function listMetaReviewPosts(
  pageIdInput: string,
  config = getMetaReviewConfig(),
  fetchImpl?: FetchLike
) {
  const pageId = normalizeId(pageIdInput, "Page ID");
  assertAllowed(pageId, config.allowedPageIds, "Page");
  const fields = "id,message,created_time,permalink_url";
  const result = await graphCall({
    method: "GET",
    path: `${pageId}/posts`,
    traceEndpoint: `/${config.graphApiVersion}/${pageId}/posts?fields=${fields}`,
    token: config.pageAccessToken,
    config,
    params: new URLSearchParams({ fields, limit: "5" }),
    fetchImpl,
  });
  const items = dataRows(result.body).map((row) => ({
    id: stringValue(row.id),
    message: stringValue(row.message)?.slice(0, 500) ?? null,
    createdTime: stringValue(row.created_time),
    permalinkUrl: stringValue(row.permalink_url),
  }));
  return { pageId, items, trace: result.trace };
}

function isoDate(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw new MetaReviewError("invalid_input", 400, `${label} must be YYYY-MM-DD.`);
  }
  return trimmed;
}

export async function listMetaReviewInsights(
  adAccountIdInput: string,
  sinceInput: string,
  untilInput: string,
  config = getMetaReviewConfig(),
  fetchImpl?: FetchLike
) {
  const adAccountId = normalizeId(adAccountIdInput, "Ad account ID");
  assertAllowed(adAccountId, config.allowedAdAccountIds, "ad account");
  const since = isoDate(sinceInput, "since");
  const until = isoDate(untilInput, "until");
  if (since > until) {
    throw new MetaReviewError("invalid_input", 400, "since must not be after until.");
  }
  const fields = "campaign_id,campaign_name,impressions,spend,date_start,date_stop";
  const result = await graphCall({
    method: "GET",
    path: `act_${adAccountId}/insights`,
    traceEndpoint: `/${config.graphApiVersion}/act_${adAccountId}/insights?level=campaign&fields=${fields}&time_range=${since}..${until}`,
    token: config.userAccessToken,
    config,
    params: new URLSearchParams({
      level: "campaign",
      fields,
      time_range: JSON.stringify({ since, until }),
      limit: "25",
    }),
    fetchImpl,
  });
  const items = dataRows(result.body).map((row) => ({
    campaignId: stringValue(row.campaign_id),
    campaignName: stringValue(row.campaign_name),
    impressions: stringValue(row.impressions),
    spend: stringValue(row.spend),
    dateStart: stringValue(row.date_start),
    dateStop: stringValue(row.date_stop),
  }));
  return { adAccountId: `act_${adAccountId}`, since, until, items, trace: result.trace };
}

export async function subscribeMetaReviewLeadgen(
  pageIdInput: string,
  confirmationText: string,
  config = getMetaReviewConfig(),
  fetchImpl?: FetchLike
) {
  assertEnabled(config);
  if (!config.writesEnabled) {
    throw new MetaReviewError("writes_disabled", 409, "Meta review writes are disabled.");
  }
  if (confirmationText.trim() !== META_REVIEW_SUBSCRIPTION_CONFIRMATION) {
    throw new MetaReviewError(
      "confirmation_required",
      400,
      `Type "${META_REVIEW_SUBSCRIPTION_CONFIRMATION}" exactly.`
    );
  }
  if (!config.appId) {
    throw new MetaReviewError(
      "app_id_unavailable",
      409,
      "META_REVIEW_APP_ID is required for duplicate-safe subscription checks."
    );
  }
  const current = await getMetaReviewSubscription(pageIdInput, config, fetchImpl);
  const ownApp = current.items.find((item) => item.id === config.appId);
  if (ownApp?.subscribedFields.includes("leadgen")) {
    return {
      pageId: current.pageId,
      alreadySubscribed: true,
      subscribedFields: ownApp.subscribedFields,
      trace: current.trace,
    };
  }
  const pageId = current.pageId;
  const write = await graphCall({
    method: "POST",
    path: `${pageId}/subscribed_apps`,
    traceEndpoint: `/${config.graphApiVersion}/${pageId}/subscribed_apps?subscribed_fields=leadgen`,
    token: config.pageAccessToken,
    config,
    params: new URLSearchParams({ subscribed_fields: "leadgen" }),
    fetchImpl,
  });
  return {
    pageId,
    alreadySubscribed: false,
    subscribedFields: ["leadgen"],
    trace: write.trace,
  };
}
