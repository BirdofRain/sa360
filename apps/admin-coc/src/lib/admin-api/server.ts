import "server-only";

import type {
  AdminMetricsSummary,
  AdminSynthflowDetail,
  AdminSynthflowListResponse,
  AdminSynthflowOutboundResultDetail,
  AdminSynthflowOutboundResultListResponse,
  AdminWebhookListResponse,
} from "./types";
import type { AdminSynthflowFetchParams } from "../synthflow-monitor-query";
import type { AdminSynthflowOutboundFetchParams } from "../synthflow-outbound-monitor-query";
import type { AdminWebhookFetchParams } from "../webhook-monitor-query";

/** Must match `apps/api` (`admin-auth.ts`). */
export const ADMIN_KEY_HEADER = "x-sa360-admin-key";

/**
 * Public origin of the Fastify API (e.g. `http://localhost:3000`).
 * `NEXT_PUBLIC_*` is required for the browser if we later add client calls; server routes read it too.
 */
export function getAdminApiBaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

/**
 * Server-only key used to call `/admin/v1`. Prefer `SA360_ADMIN_API_KEY` in this app;
 * falls back to `ADMIN_API_KEY` so local dev can reuse the same value as the API process.
 * Never use `NEXT_PUBLIC_*` for this.
 */
export function getAdminApiKey(): string | undefined {
  const a = process.env.SA360_ADMIN_API_KEY?.trim();
  const b = process.env.ADMIN_API_KEY?.trim();
  return a || b || undefined;
}

export function isAdminApiConfigured(): boolean {
  return Boolean(getAdminApiBaseUrl() && getAdminApiKey());
}

type AdminFetchFailure = { ok: false; status: number; body: string };
type AdminFetchSuccess<T> = { ok: true; data: T };
type AdminFetchResult<T> = AdminFetchSuccess<T> | AdminFetchFailure;

export async function adminFetchJson<T>(path: string): Promise<AdminFetchResult<T>> {
  const baseUrl = getAdminApiBaseUrl();
  const apiKey = getAdminApiKey();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      status: 0,
      body:
        "Admin API is not configured. Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) for this Next.js app.",
    };
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      [ADMIN_KEY_HEADER]: apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text || res.statusText };
  }

  try {
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, status: res.status, body: "Invalid JSON from admin API" };
  }
}

function formatError(err: AdminFetchFailure): string {
  if (err.status === 0) return err.body;
  const snippet = err.body.length > 280 ? `${err.body.slice(0, 280)}…` : err.body;
  return `Admin API error (${err.status}): ${snippet}`;
}

/** Same handler as `/admin/v1/metrics/summary`; optional `from`/`to` ISO strings narrow the summary window (API default: ~last 7 days). */
export async function fetchAdminMetricsSummary(options?: {
  from?: string;
  to?: string;
}): Promise<{
  summary: AdminMetricsSummary | null;
  error: string | null;
}> {
  const searchParams = new URLSearchParams();
  if (options?.from?.trim()) searchParams.set("from", options.from.trim());
  if (options?.to?.trim()) searchParams.set("to", options.to.trim());
  const qs = searchParams.toString();
  const path = `/admin/v1/coc/summary-metrics${qs ? `?${qs}` : ""}`;
  const res = await adminFetchJson<AdminMetricsSummary>(path);
  if (!res.ok) return { summary: null, error: formatError(res) };
  return { summary: res.data, error: null };
}

function buildWebhookRequestsQueryString(params: AdminWebhookFetchParams): string {
  const searchParams = new URLSearchParams();
  const limit = params.limit ?? 50;
  searchParams.set("limit", String(limit));
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.source) searchParams.set("source", params.source);
  if (params.processingStatus) searchParams.set("processingStatus", params.processingStatus);
  if (params.clientAccountId) searchParams.set("clientAccountId", params.clientAccountId);
  if (params.eventUuid) searchParams.set("eventUuid", params.eventUuid);
  if (params.eventNameInternal) searchParams.set("eventNameInternal", params.eventNameInternal);
  if (params.httpStatus !== undefined) searchParams.set("httpStatus", String(params.httpStatus));
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  return searchParams.toString();
}

/** Loads webhook request rows via `GET /admin/v1/coc/webhook-requests` with optional filters. */
export async function fetchAdminWebhookRequests(
  params: AdminWebhookFetchParams = {}
): Promise<{
  items: AdminWebhookListResponse["items"];
  nextCursor: string | null;
  error: string | null;
}> {
  const qs = buildWebhookRequestsQueryString(params);
  const res = await adminFetchJson<AdminWebhookListResponse>(
    `/admin/v1/coc/webhook-requests?${qs}`
  );
  if (!res.ok) return { items: [], nextCursor: null, error: formatError(res) };
  return { items: res.data.items, nextCursor: res.data.nextCursor, error: null };
}

function buildSynthflowRequestsQueryString(params: AdminSynthflowFetchParams): string {
  const searchParams = new URLSearchParams();
  const limit = params.limit ?? 50;
  searchParams.set("limit", String(limit));
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.processingStatus) searchParams.set("processingStatus", params.processingStatus);
  if (params.lookupStatus) searchParams.set("lookupStatus", params.lookupStatus);
  if (params.knownCaller) searchParams.set("knownCaller", params.knownCaller);
  if (params.matchedBy) searchParams.set("matchedBy", params.matchedBy);
  if (params.fromNumber) searchParams.set("fromNumber", params.fromNumber);
  if (params.toNumber) searchParams.set("toNumber", params.toNumber);
  if (params.phoneE164) searchParams.set("phoneE164", params.phoneE164);
  if (params.modelId) searchParams.set("modelId", params.modelId);
  if (params.clientAccountId) searchParams.set("clientAccountId", params.clientAccountId);
  if (params.subaccountIdGhl) searchParams.set("subaccountIdGhl", params.subaccountIdGhl);
  if (params.httpStatus !== undefined) searchParams.set("httpStatus", String(params.httpStatus));
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  return searchParams.toString();
}

/** Synthflow inbound lookup logs via `GET /admin/v1/coc/synthflow-requests`. */
export async function fetchAdminSynthflowRequests(
  params: AdminSynthflowFetchParams = {}
): Promise<{
  items: AdminSynthflowListResponse["items"];
  nextCursor: string | null;
  error: string | null;
}> {
  const qs = buildSynthflowRequestsQueryString(params);
  const res = await adminFetchJson<AdminSynthflowListResponse>(
    `/admin/v1/coc/synthflow-requests?${qs}`
  );
  if (!res.ok) return { items: [], nextCursor: null, error: formatError(res) };
  return { items: res.data.items, nextCursor: res.data.nextCursor, error: null };
}

export async function fetchAdminSynthflowRequestDetail(id: string): Promise<{
  detail: AdminSynthflowDetail | null;
  error: string | null;
}> {
  const trimmed = id.trim();
  if (!trimmed) return { detail: null, error: "Missing id" };
  const res = await adminFetchJson<AdminSynthflowDetail>(
    `/admin/v1/coc/synthflow-requests/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { detail: null, error: formatError(res) };
  return { detail: res.data, error: null };
}

function buildSynthflowOutboundResultsQueryString(params: AdminSynthflowOutboundFetchParams): string {
  const searchParams = new URLSearchParams();
  const limit = params.limit ?? 50;
  searchParams.set("limit", String(limit));
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.outcome) searchParams.set("outcome", params.outcome);
  if (params.clientAccountId) searchParams.set("clientAccountId", params.clientAccountId);
  if (params.subaccountIdGhl !== undefined) searchParams.set("subaccountIdGhl", params.subaccountIdGhl);
  if (params.contactIdGhl) searchParams.set("contactIdGhl", params.contactIdGhl);
  if (params.callId) searchParams.set("callId", params.callId);
  if (params.modelId) searchParams.set("modelId", params.modelId);
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  return searchParams.toString();
}

/** Outbound call outcomes via `GET /admin/v1/coc/synthflow-outbound-results`. */
export async function fetchAdminSynthflowOutboundResults(
  params: AdminSynthflowOutboundFetchParams = {}
): Promise<{
  items: AdminSynthflowOutboundResultListResponse["items"];
  nextCursor: string | null;
  error: string | null;
}> {
  const qs = buildSynthflowOutboundResultsQueryString(params);
  const res = await adminFetchJson<AdminSynthflowOutboundResultListResponse>(
    `/admin/v1/coc/synthflow-outbound-results?${qs}`
  );
  if (!res.ok) return { items: [], nextCursor: null, error: formatError(res) };
  return { items: res.data.items, nextCursor: res.data.nextCursor, error: null };
}

export async function fetchAdminSynthflowOutboundResultDetail(id: string): Promise<{
  detail: AdminSynthflowOutboundResultDetail | null;
  error: string | null;
}> {
  const trimmed = id.trim();
  if (!trimmed) return { detail: null, error: "Missing id" };
  const res = await adminFetchJson<AdminSynthflowOutboundResultDetail>(
    `/admin/v1/coc/synthflow-outbound-results/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { detail: null, error: formatError(res) };
  return { detail: res.data, error: null };
}
