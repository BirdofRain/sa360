import "server-only";

import type {
  AdminKanbanBoard,
  AdminKanbanCard,
  AdminKanbanCardCreate,
  AdminKanbanCardUpdate,
  AdminKanbanReorderItem,
  AdminMetricsSummary,
  AdminSynthflowDetail,
  AdminSynthflowListResponse,
  AdminSynthflowOutboundResultDetail,
  AdminSynthflowOutboundResultListResponse,
  AdminWebhookDetail,
  AdminWebhookListResponse,
  AdminLeadTimelineResponse,
  AutomationAccounts,
  AutomationAppointments,
  AutomationDashboardQuery,
  AutomationDashboardSummary,
  AutomationSignalHealth,
  AutomationWorkflowProgression,
  AdminActionDashboardToday,
  ActionDashboardTodayQuery,
} from "./types";
import type { AdminSynthflowFetchParams } from "../synthflow-monitor-query";
import type { AdminSynthflowOutboundFetchParams } from "../synthflow-outbound-monitor-query";
import type { AdminWebhookFetchParams } from "../webhook-monitor-query";
import type { LeadTimelineFetchParams } from "../lead-timeline-query";
import { buildLeadTimelineQueryString } from "../lead-timeline-query";
import type {
  ClientDetailResponse,
  ClientsListResponse,
  RoutingRuleCreateBody,
} from "../clients/types";
import type {
  DeliveryReadinessListResponse,
  RoutingRuleDeliveryConfigPatchBody,
  RoutingRuleWithReadinessItem,
} from "../delivery-readiness/types";
import type { GhlAdapterRunItem, GhlAdapterSimulateResponse } from "../ghl-adapter/types";
import type {
  GhlLiveCanaryExecuteResponse,
  GhlLiveCanaryPreflightResponse,
} from "../ghl-live-canary/types";
import type {
  GhlConnectionProbeResponse,
  GhlConnectionsListResponse,
  GhlOAuthDebugResponse,
  GhlOAuthStartResponse,
} from "../ghl-connections/types";
import type {
  GhlLocationConfigDiscoveryResponse,
  RoutingRuleGhlConfigSaveBody,
  RoutingRuleGhlConfigSaveResponse,
  RoutingRuleGhlConfigSummaryResponse,
} from "../ghl-config/types";
import type { DuplicateRiskReviewPatchBody } from "../routing-dry-run/duplicate-risk-types";
import type {
  LeadDeliveryPlanItem,
  RoutingDryRunListResponse,
  RoutingDryRunTestResponse,
  RoutingDryRunValidationPatchBody,
  RoutingDryRunValidationPatchResponse,
} from "../routing-dry-run/types";
import type {
  DirectDemoDeliveryMode,
  DirectDemoDeliveryResponse,
} from "../direct-delivery-demo/types";
import type {
  SourceLeadDetail,
  SourceLeadListResponse,
  SourceLeadApproveMode,
} from "../source-intake/types";

import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url";

/** Must match `apps/api` (`admin-auth.ts`). */
export const ADMIN_KEY_HEADER = "x-sa360-admin-key";

/**
 * Public origin of the Fastify API (e.g. `http://localhost:3000`).
 * `NEXT_PUBLIC_*` is required for the browser if we later add client calls; server routes read it too.
 */
export function getAdminApiBaseUrl(): string | undefined {
  return getSa360PublicApiBaseUrl();
}

/**
 * Server-only key used to call `/admin/v1`. Prefer `SA360_ADMIN_API_KEY` in this app;
 * falls back to `ADMIN_API_KEY` so local dev can reuse the same value as the API process.
 * Never use `NEXT_PUBLIC_*` for this.
 */
export function getAdminApiKey(): string | undefined {
  const a = process.env.SA360_ADMIN_API_KEY?.trim();
  const b = process.env.ADMIN_API_KEY?.trim();
  const c = process.env.SA360_ADMIN_KEY?.trim();
  return a || b || c || undefined;
}

export function isAdminApiConfigured(): boolean {
  return Boolean(getAdminApiBaseUrl() && getAdminApiKey());
}

type AdminFetchFailure = { ok: false; status: number; body: string };
type AdminFetchSuccess<T> = { ok: true; data: T };
type AdminFetchResult<T> = AdminFetchSuccess<T> | AdminFetchFailure;

export async function adminFetchJson<T>(path: string): Promise<AdminFetchResult<T>> {
  return adminRequestJson<T>("GET", path);
}

/** Generic admin-API request helper. Used for GETs (via `adminFetchJson`) and writes. */
export async function adminRequestJson<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<AdminFetchResult<T>> {
  const baseUrl = getAdminApiBaseUrl();
  const apiKey = getAdminApiKey();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      status: 0,
      body:
        "Admin API is not configured. Set NEXT_PUBLIC_SA360_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) and SA360_ADMIN_API_KEY, ADMIN_API_KEY, or SA360_ADMIN_KEY for this Next.js app.",
    };
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    [ADMIN_KEY_HEADER]: apiKey,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      body: `Admin API request failed: ${msg.slice(0, 200)}`,
    };
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
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.sortDirection) searchParams.set("sortDirection", params.sortDirection);
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

export async function fetchAdminLeadTimeline(
  params: LeadTimelineFetchParams
): Promise<{
  timeline: AdminLeadTimelineResponse | null;
  error: string | null;
}> {
  const qs = buildLeadTimelineQueryString(params);
  if (!qs) {
    return { timeline: null, error: "Missing lead timeline query parameters." };
  }
  const res = await adminFetchJson<AdminLeadTimelineResponse>(
    `/admin/v1/coc/lead-timeline?${qs}`
  );
  if (!res.ok) return { timeline: null, error: formatError(res) };
  return { timeline: res.data, error: null };
}

export async function fetchAdminWebhookRequestDetail(id: string): Promise<{
  detail: AdminWebhookDetail | null;
  error: string | null;
}> {
  const trimmed = id.trim();
  if (!trimmed) return { detail: null, error: "Missing id" };
  const res = await adminFetchJson<AdminWebhookDetail>(
    `/admin/v1/coc/webhook-requests/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { detail: null, error: formatError(res) };
  return { detail: res.data, error: null };
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

// ─── Kanban (internal launch board) ────────────────────────────────────────

export async function fetchAdminKanbanBoard(boardKey: string): Promise<{
  board: AdminKanbanBoard | null;
  error: string | null;
}> {
  const trimmed = boardKey.trim();
  if (!trimmed) return { board: null, error: "Missing boardKey" };
  const res = await adminFetchJson<AdminKanbanBoard>(
    `/admin/v1/kanban/boards/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { board: null, error: formatError(res) };
  return { board: res.data, error: null };
}

export async function updateAdminKanbanCard(
  id: string,
  patch: AdminKanbanCardUpdate
): Promise<{ card: AdminKanbanCard | null; error: string | null }> {
  const trimmed = id.trim();
  if (!trimmed) return { card: null, error: "Missing id" };
  const res = await adminRequestJson<AdminKanbanCard>(
    "PUT",
    `/admin/v1/kanban/cards/${encodeURIComponent(trimmed)}`,
    patch
  );
  if (!res.ok) return { card: null, error: formatError(res) };
  return { card: res.data, error: null };
}

export async function createAdminKanbanCard(
  input: AdminKanbanCardCreate
): Promise<{ card: AdminKanbanCard | null; error: string | null }> {
  const res = await adminRequestJson<AdminKanbanCard>(
    "POST",
    `/admin/v1/kanban/cards`,
    input
  );
  if (!res.ok) return { card: null, error: formatError(res) };
  return { card: res.data, error: null };
}

export async function reorderAdminKanbanBoard(
  boardKey: string,
  items: AdminKanbanReorderItem[]
): Promise<{ cards: AdminKanbanCard[] | null; error: string | null }> {
  const trimmed = boardKey.trim();
  if (!trimmed) return { cards: null, error: "Missing boardKey" };
  const res = await adminRequestJson<{ boardKey: string; cards: AdminKanbanCard[] }>(
    "PUT",
    `/admin/v1/kanban/boards/${encodeURIComponent(trimmed)}/reorder`,
    { items }
  );
  if (!res.ok) return { cards: null, error: formatError(res) };
  return { cards: res.data.cards, error: null };
}

function buildAutomationDashboardQuery(params: AutomationDashboardQuery = {}): string {
  const searchParams = new URLSearchParams();
  if (params.clientAccountId?.trim()) {
    searchParams.set("clientAccountId", params.clientAccountId.trim());
  }
  if (params.locationId?.trim()) searchParams.set("locationId", params.locationId.trim());
  if (params.range) searchParams.set("range", params.range);
  if (params.from?.trim()) searchParams.set("from", params.from.trim());
  if (params.to?.trim()) searchParams.set("to", params.to.trim());
  return searchParams.toString();
}

async function fetchAutomationDashboard<T>(
  segment: string,
  params: AutomationDashboardQuery = {}
): Promise<{ data: T | null; error: string | null }> {
  const qs = buildAutomationDashboardQuery(params);
  const path = `/admin/v1/automation-dashboard/${segment}${qs ? `?${qs}` : ""}`;
  const res = await adminFetchJson<T>(path);
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAutomationDashboardSummary(params?: AutomationDashboardQuery) {
  return fetchAutomationDashboard<AutomationDashboardSummary>("summary", params);
}

export async function fetchAutomationWorkflowProgression(params?: AutomationDashboardQuery) {
  return fetchAutomationDashboard<AutomationWorkflowProgression>(
    "workflow-progression",
    params
  );
}

export async function fetchAutomationAppointments(params?: AutomationDashboardQuery) {
  return fetchAutomationDashboard<AutomationAppointments>("appointments", params);
}

export async function fetchAutomationSignalHealth(params?: AutomationDashboardQuery) {
  return fetchAutomationDashboard<AutomationSignalHealth>("signal-health", params);
}

export async function fetchAutomationAccounts(params?: AutomationDashboardQuery) {
  return fetchAutomationDashboard<AutomationAccounts>("accounts", params);
}

function buildActionDashboardTodayQuery(params: ActionDashboardTodayQuery): string {
  const searchParams = new URLSearchParams();
  searchParams.set("clientAccountId", params.clientAccountId.trim());
  if (params.locationId?.trim()) searchParams.set("locationId", params.locationId.trim());
  if (params.agentDisplayName?.trim()) {
    searchParams.set("agentDisplayName", params.agentDisplayName.trim());
  }
  return searchParams.toString();
}

export async function fetchActionDashboardToday(
  params: ActionDashboardTodayQuery
): Promise<{ data: AdminActionDashboardToday | null; error: string | null }> {
  const qs = buildActionDashboardTodayQuery(params);
  const res = await adminFetchJson<AdminActionDashboardToday>(
    `/admin/v1/action-dashboard/today?${qs}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

// ─── Campaign routing dry-run (read-only review) ───────────────────────────

export type RoutingDryRunFetchParams = {
  masterClientAccountId: string;
  limit?: number;
  matched?: boolean;
  validationStatus?: string;
  reviewQueue?: string;
};

function buildRoutingDryRunDecisionsQueryString(params: RoutingDryRunFetchParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set("masterClientAccountId", params.masterClientAccountId.trim());
  searchParams.set("limit", String(params.limit ?? 50));
  if (params.matched !== undefined) {
    searchParams.set("matched", params.matched ? "true" : "false");
  }
  if (params.validationStatus?.trim()) {
    searchParams.set("validationStatus", params.validationStatus.trim());
  }
  if (params.reviewQueue?.trim()) {
    searchParams.set("reviewQueue", params.reviewQueue.trim());
  }
  return searchParams.toString();
}

export async function fetchAdminRoutingDryRunStats(
  params: { masterClientAccountId: string; destinationClientAccountId?: string }
): Promise<{
  data: import("@/lib/routing-dry-run/types").RoutingDryRunStatsResponse | null;
  error: string | null;
}> {
  const master = params.masterClientAccountId.trim();
  if (!master) {
    return { data: null, error: "masterClientAccountId is required." };
  }
  const searchParams = new URLSearchParams();
  searchParams.set("masterClientAccountId", master);
  if (params.destinationClientAccountId?.trim()) {
    searchParams.set("destinationClientAccountId", params.destinationClientAccountId.trim());
  }
  const res = await adminFetchJson<
    import("@/lib/routing-dry-run/types").RoutingDryRunStatsResponse
  >(`/admin/v1/routing/dry-run-stats?${searchParams.toString()}`);
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminRoutingDryRunDecisions(
  params: RoutingDryRunFetchParams
): Promise<{
  data: RoutingDryRunListResponse | null;
  error: string | null;
}> {
  const master = params.masterClientAccountId.trim();
  if (!master) {
    return { data: null, error: "masterClientAccountId is required." };
  }
  const qs = buildRoutingDryRunDecisionsQueryString(params);
  const res = await adminFetchJson<RoutingDryRunListResponse>(
    `/admin/v1/routing/dry-run-decisions?${qs}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminRoutingDryRun(payload: unknown): Promise<{
  data: RoutingDryRunTestResponse | null;
  error: string | null;
  status: number;
}> {
  const res = await adminRequestJson<RoutingDryRunTestResponse>(
    "POST",
    "/admin/v1/routing/dry-run",
    { payload }
  );
  if (!res.ok) return { data: null, error: formatError(res), status: res.status };
  return { data: res.data, error: null, status: 200 };
}

export async function patchAdminRoutingDryRunValidation(
  decisionId: string,
  body: RoutingDryRunValidationPatchBody
): Promise<{
  data: RoutingDryRunValidationPatchResponse | null;
  error: string | null;
}> {
  const trimmed = decisionId.trim();
  if (!trimmed) return { data: null, error: "Missing decision id" };
  const res = await adminRequestJson<RoutingDryRunValidationPatchResponse>(
    "PATCH",
    `/admin/v1/routing/dry-run-decisions/${encodeURIComponent(trimmed)}/validation`,
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

type DuplicateRiskReviewResponse = {
  ok: boolean;
  duplicateRisk: import("../routing-dry-run/duplicate-risk-types").DuplicateRiskAssessmentItem;
};

export async function patchAdminDuplicateRiskReview(
  decisionId: string,
  body: DuplicateRiskReviewPatchBody
): Promise<{
  data: DuplicateRiskReviewResponse | null;
  error: string | null;
}> {
  const trimmed = decisionId.trim();
  if (!trimmed) return { data: null, error: "Missing decision id" };
  const res = await adminRequestJson<DuplicateRiskReviewResponse>(
    "PATCH",
    `/admin/v1/routing/dry-run-decisions/${encodeURIComponent(trimmed)}/duplicate-risk-review`,
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

// ─── Delivery readiness (guarded live config; no GHL execution) ───────────

type RoutingRulePatchResponse = { ok: boolean; item: RoutingRuleWithReadinessItem };

export async function fetchAdminDeliveryReadiness(
  params: {
    masterClientAccountId?: string;
    clientAccountId?: string;
    status?: string;
  }
): Promise<{ data: DeliveryReadinessListResponse | null; error: string | null }> {
  const searchParams = new URLSearchParams();
  if (params.masterClientAccountId?.trim()) {
    searchParams.set("masterClientAccountId", params.masterClientAccountId.trim());
  }
  if (params.clientAccountId?.trim()) {
    searchParams.set("clientAccountId", params.clientAccountId.trim());
  }
  if (params.status?.trim()) searchParams.set("status", params.status.trim());
  const res = await adminFetchJson<DeliveryReadinessListResponse>(
    `/admin/v1/delivery-readiness?${searchParams.toString()}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminRoutingRules(
  params: { masterClientAccountId: string; clientAccountId?: string; active?: boolean }
): Promise<{ data: DeliveryReadinessListResponse | null; error: string | null }> {
  const searchParams = new URLSearchParams();
  searchParams.set("masterClientAccountId", params.masterClientAccountId.trim());
  if (params.clientAccountId?.trim()) {
    searchParams.set("clientAccountId", params.clientAccountId.trim());
  }
  if (params.active !== undefined) {
    searchParams.set("active", params.active ? "true" : "false");
  }
  const res = await adminFetchJson<DeliveryReadinessListResponse>(
    `/admin/v1/routing/rules?${searchParams.toString()}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function patchAdminRoutingRuleDeliveryConfig(
  ruleId: string,
  body: RoutingRuleDeliveryConfigPatchBody
): Promise<{ data: RoutingRulePatchResponse | null; error: string | null }> {
  const trimmed = ruleId.trim();
  if (!trimmed) return { data: null, error: "Missing rule id" };
  const res = await adminRequestJson<RoutingRulePatchResponse>(
    "PATCH",
    `/admin/v1/routing/rules/${encodeURIComponent(trimmed)}/delivery-config`,
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminGhlLocationConfig(
  locationId: string,
  refresh = false
): Promise<{ data: GhlLocationConfigDiscoveryResponse | null; error: string | null }> {
  const trimmed = locationId.trim();
  if (!trimmed) return { data: null, error: "Missing location id" };
  const qs = refresh ? "?refresh=true" : "";
  const res = await adminFetchJson<GhlLocationConfigDiscoveryResponse>(
    `/admin/v1/ghl/locations/${encodeURIComponent(trimmed)}/config${qs}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminRoutingRuleGhlConfig(
  ruleId: string
): Promise<{ data: RoutingRuleGhlConfigSummaryResponse | null; error: string | null }> {
  const trimmed = ruleId.trim();
  if (!trimmed) return { data: null, error: "Missing rule id" };
  const res = await adminFetchJson<RoutingRuleGhlConfigSummaryResponse>(
    `/admin/v1/routing/rules/${encodeURIComponent(trimmed)}/ghl-config`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminRoutingRuleGhlConfig(
  ruleId: string,
  body: RoutingRuleGhlConfigSaveBody
): Promise<{ data: RoutingRuleGhlConfigSaveResponse | null; error: string | null }> {
  const trimmed = ruleId.trim();
  if (!trimmed) return { data: null, error: "Missing rule id" };
  const res = await adminRequestJson<RoutingRuleGhlConfigSaveResponse>(
    "POST",
    `/admin/v1/routing/rules/${encodeURIComponent(trimmed)}/ghl-config`,
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminClientDeliveryConfig(
  clientAccountId: string,
  locationId?: string
): Promise<{
  data: import("@/lib/clients/delivery-config-types").ClientDeliveryConfigResponse | null;
  error: string | null;
}> {
  const id = clientAccountId.trim();
  if (!id) return { data: null, error: "Missing clientAccountId" };
  const params = new URLSearchParams();
  if (locationId?.trim()) params.set("locationId", locationId.trim());
  const qs = params.toString();
  const res = await adminFetchJson<
    import("@/lib/clients/delivery-config-types").ClientDeliveryConfigResponse
  >(`/admin/v1/clients/${encodeURIComponent(id)}/delivery-config${qs ? `?${qs}` : ""}`);
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminClientGhlConfig(
  clientAccountId: string,
  body: RoutingRuleGhlConfigSaveBody
): Promise<{
  data: import("@/lib/clients/delivery-config-types").ClientGhlConfigSaveResponse | null;
  error: string | null;
}> {
  const id = clientAccountId.trim();
  if (!id) return { data: null, error: "Missing clientAccountId" };
  const res = await adminRequestJson<
    import("@/lib/clients/delivery-config-types").ClientGhlConfigSaveResponse
  >("POST", `/admin/v1/clients/${encodeURIComponent(id)}/ghl-config`, body);
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

// ─── Shadow delivery plans (no external execution) ─────────────────────────

type DeliveryPlanResponse = { ok: boolean; plan: LeadDeliveryPlanItem };

export async function postAdminDeliveryPlanForDecision(
  decisionId: string
): Promise<{ plan: LeadDeliveryPlanItem | null; error: string | null }> {
  const trimmed = decisionId.trim();
  if (!trimmed) return { plan: null, error: "Missing decision id" };
  const res = await adminRequestJson<DeliveryPlanResponse>(
    "POST",
    `/admin/v1/routing/dry-run-decisions/${encodeURIComponent(trimmed)}/delivery-plan`
  );
  if (!res.ok) return { plan: null, error: formatError(res) };
  return { plan: res.data.plan, error: null };
}

export async function fetchAdminDeliveryPlanForDecision(
  decisionId: string
): Promise<{ plan: LeadDeliveryPlanItem | null; error: string | null }> {
  const trimmed = decisionId.trim();
  if (!trimmed) return { plan: null, error: "Missing decision id" };
  const res = await adminRequestJson<DeliveryPlanResponse>(
    "GET",
    `/admin/v1/routing/dry-run-decisions/${encodeURIComponent(trimmed)}/delivery-plan`
  );
  if (!res.ok) return { plan: null, error: formatError(res) };
  return { plan: res.data.plan, error: null };
}

type GhlAdapterRunResponse = { ok: boolean; adapterRun: GhlAdapterRunItem; safetyMessage: string };

export async function postAdminGhlAdapterSimulate(
  planId: string,
  body?: { checkLiveReadiness?: boolean }
): Promise<{ data: GhlAdapterSimulateResponse | null; error: string | null; status: number }> {
  const trimmed = planId.trim();
  if (!trimmed) return { data: null, error: "Missing plan id", status: 400 };
  const res = await adminRequestJson<GhlAdapterSimulateResponse>(
    "POST",
    `/admin/v1/delivery-plans/${encodeURIComponent(trimmed)}/ghl-adapter/simulate`,
    body ?? {}
  );
  if (res.ok) return { data: res.data, status: 200, error: null };
  if (res.status === 409) {
    try {
      const parsed = JSON.parse(res.body) as GhlAdapterSimulateResponse;
      if (parsed?.adapterRun) {
        return { data: parsed, status: res.status, error: parsed.blockedReason ?? formatError(res) };
      }
    } catch {
      /* fall through */
    }
  }
  return { data: null, error: formatError(res), status: res.status };
}

export async function fetchAdminGhlAdapterRun(
  runId: string
): Promise<{ data: GhlAdapterRunResponse | null; error: string | null }> {
  const trimmed = runId.trim();
  if (!trimmed) return { data: null, error: "Missing run id" };
  const res = await adminRequestJson<GhlAdapterRunResponse>(
    "GET",
    `/admin/v1/ghl-adapter/runs/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminGhlLiveCanaryPreflight(
  planId: string
): Promise<{ data: GhlLiveCanaryPreflightResponse | null; error: string | null }> {
  const trimmed = planId.trim();
  if (!trimmed) return { data: null, error: "Missing plan id" };
  const res = await adminRequestJson<GhlLiveCanaryPreflightResponse>(
    "GET",
    `/admin/v1/delivery-plans/${encodeURIComponent(trimmed)}/ghl-live/canary/preflight`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminGhlLiveCanaryExecute(
  planId: string,
  body: { confirmLiveDeliveryRisk: true; operatorConfirmationText: string }
): Promise<{ data: GhlLiveCanaryExecuteResponse | null; error: string | null; status: number }> {
  const trimmed = planId.trim();
  if (!trimmed) return { data: null, error: "Missing plan id", status: 400 };
  const res = await adminRequestJson<GhlLiveCanaryExecuteResponse>(
    "POST",
    `/admin/v1/delivery-plans/${encodeURIComponent(trimmed)}/ghl-live/canary`,
    body
  );
  if (res.ok) return { data: res.data, status: 200, error: null };
  try {
    const parsed = JSON.parse(res.body) as GhlLiveCanaryExecuteResponse & {
      blockers?: string[];
    };
    return {
      data: parsed,
      status: res.status,
      error: parsed.blockers?.join(" ") ?? formatError(res),
    };
  } catch {
    return { data: null, error: formatError(res), status: res.status };
  }
}

export type GhlLiveDeliveryRunDetailResponse = {
  ok: boolean;
  liveRun?: import("../ghl-live-canary/types").GhlLiveDeliveryRunItem;
  stepSummary?: import("../direct-delivery-demo/types").DirectDemoLiveRunStepSummary[];
  apiBuildVersion?: {
    commitSha?: string | null;
    commitShort?: string | null;
    buildLabel?: string | null;
    buildSource?: string | null;
  };
  safetyMessage?: string;
  error?: string;
};

export async function fetchAdminGhlLiveDeliveryRun(
  liveRunId: string
): Promise<{ data: GhlLiveDeliveryRunDetailResponse | null; error: string | null }> {
  const trimmed = liveRunId.trim();
  if (!trimmed) return { data: null, error: "Missing live run id" };
  const res = await adminFetchJson<GhlLiveDeliveryRunDetailResponse>(
    `/admin/v1/ghl-live-delivery/runs/${encodeURIComponent(trimmed)}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

// ─── GHL OAuth connections (Phase 5A) ───────────────────────────────────────

type GhlConnectionMutationResponse = { ok: boolean; connection: GhlConnectionsListResponse["items"][number] };

export async function fetchAdminGhlConnections(
  clientAccountId?: string
): Promise<{ data: GhlConnectionsListResponse | null; error: string | null }> {
  const qs = clientAccountId?.trim()
    ? `?clientAccountId=${encodeURIComponent(clientAccountId.trim())}`
    : "";
  const res = await adminFetchJson<GhlConnectionsListResponse>(`/admin/v1/ghl/connections${qs}`);
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminGhlOAuthDebug(): Promise<{
  data: GhlOAuthDebugResponse | null;
  error: string | null;
}> {
  const res = await adminFetchJson<GhlOAuthDebugResponse>("/admin/v1/ghl/oauth/debug");
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminGhlOAuthStart(
  clientAccountId?: string,
  returnTo?: string
): Promise<{ data: GhlOAuthStartResponse | null; error: string | null }> {
  const params = new URLSearchParams();
  if (clientAccountId?.trim()) params.set("clientAccountId", clientAccountId.trim());
  params.set("returnTo", returnTo?.trim() || "/ghl-connections");
  const res = await adminFetchJson<GhlOAuthStartResponse>(
    `/admin/v1/ghl/oauth/start?${params.toString()}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminGhlConnectionProbe(
  id: string
): Promise<{ data: GhlConnectionProbeResponse | null; error: string | null }> {
  const res = await adminRequestJson<GhlConnectionProbeResponse>(
    "POST",
    `/admin/v1/ghl/connections/${encodeURIComponent(id.trim())}/probe`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function patchAdminGhlConnectionLinkClient(
  id: string,
  clientAccountId: string
): Promise<{ data: GhlConnectionMutationResponse | null; error: string | null }> {
  const res = await adminRequestJson<GhlConnectionMutationResponse>(
    "PATCH",
    `/admin/v1/ghl/connections/${encodeURIComponent(id.trim())}/link-client`,
    { clientAccountId }
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function deleteAdminGhlConnection(
  id: string,
  opts?: { purge?: boolean }
): Promise<{ data: GhlConnectionMutationResponse | { ok: boolean; purged: boolean } | null; error: string | null }> {
  const qs = opts?.purge ? "?purge=true" : "";
  const res = await adminRequestJson<GhlConnectionMutationResponse | { ok: boolean; purged: boolean }>(
    "DELETE",
    `/admin/v1/ghl/connections/${encodeURIComponent(id.trim())}${qs}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminGhlOAuthPendingInstalls(): Promise<{
  data: import("@/lib/ghl-connections/types").GhlOAuthPendingInstallsResponse | null;
  error: string | null;
}> {
  const res = await adminFetchJson<import("@/lib/ghl-connections/types").GhlOAuthPendingInstallsResponse>(
    "/admin/v1/ghl/oauth/pending-installs"
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function deleteAdminGhlOAuthPendingInstall(
  id: string,
  opts?: { purge?: boolean }
): Promise<{ data: { ok: boolean; purged?: boolean } | null; error: string | null }> {
  const qs = opts?.purge ? "?purge=true" : "";
  const res = await adminRequestJson<{ ok: boolean; purged?: boolean }>(
    "DELETE",
    `/admin/v1/ghl/oauth/pending-installs/${encodeURIComponent(id.trim())}${qs}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

// ─── Client onboarding (Phase 5A — config only) ────────────────────────────

export async function fetchAdminClients(params?: {
  status?: string;
}): Promise<{ data: ClientsListResponse | null; error: string | null }> {
  const searchParams = new URLSearchParams();
  if (params?.status?.trim()) searchParams.set("status", params.status.trim());
  const qs = searchParams.toString();
  const res = await adminFetchJson<ClientsListResponse>(
    `/admin/v1/clients${qs ? `?${qs}` : ""}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminClientDetail(
  clientAccountId: string
): Promise<{ data: ClientDetailResponse | null; error: string | null }> {
  const id = clientAccountId.trim();
  if (!id) return { data: null, error: "Missing clientAccountId" };
  const res = await adminFetchJson<ClientDetailResponse>(
    `/admin/v1/clients/${encodeURIComponent(id)}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminClient(
  body: Record<string, unknown>
): Promise<{ data: ClientDetailResponse | null; error: string | null }> {
  const res = await adminRequestJson<ClientDetailResponse>("POST", "/admin/v1/clients", body);
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function patchAdminClient(
  clientAccountId: string,
  body: Record<string, unknown>
): Promise<{ data: ClientDetailResponse | null; error: string | null }> {
  const id = clientAccountId.trim();
  const res = await adminRequestJson<ClientDetailResponse>(
    "PATCH",
    `/admin/v1/clients/${encodeURIComponent(id)}`,
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function patchAdminClientGhlDestination(
  clientAccountId: string,
  body: Record<string, unknown>
): Promise<{ data: ClientDetailResponse | null; error: string | null }> {
  const id = clientAccountId.trim();
  const res = await adminRequestJson<ClientDetailResponse>(
    "PATCH",
    `/admin/v1/clients/${encodeURIComponent(id)}/ghl-destination`,
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminRoutingRule(
  body: RoutingRuleCreateBody
): Promise<{ data: RoutingRulePatchResponse | null; error: string | null }> {
  const res = await adminRequestJson<RoutingRulePatchResponse>(
    "POST",
    "/admin/v1/routing/rules",
    body
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminRoutingRule(
  ruleId: string
): Promise<{ data: RoutingRulePatchResponse | null; error: string | null }> {
  const id = ruleId.trim();
  if (!id) return { data: null, error: "Missing rule id" };
  const res = await adminFetchJson<RoutingRulePatchResponse>(
    `/admin/v1/routing/rules/${encodeURIComponent(id)}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function deleteAdminRoutingRule(
  ruleId: string
): Promise<{ ok: boolean; error: string | null }> {
  const id = ruleId.trim();
  if (!id) return { ok: false, error: "Missing rule id" };
  const res = await adminRequestJson<{ ok: boolean; deleted?: boolean; id?: string }>(
    "DELETE",
    `/admin/v1/routing/rules/${encodeURIComponent(id)}?confirm=true`
  );
  if (!res.ok) return { ok: false, error: formatError(res) };
  return { ok: true, error: null };
}

export async function deleteAdminClient(
  clientAccountId: string
): Promise<{
  ok: boolean;
  error: string | null;
  routingRulesDeleted?: number;
  ghlConnectionsUnlinked?: number;
}> {
  const id = clientAccountId.trim();
  if (!id) return { ok: false, error: "Missing clientAccountId" };
  const res = await adminRequestJson<{
    ok: boolean;
    routingRulesDeleted?: number;
    ghlConnectionsUnlinked?: number;
  }>("DELETE", `/admin/v1/clients/${encodeURIComponent(id)}?confirm=true`);
  if (!res.ok) return { ok: false, error: formatError(res) };
  return {
    ok: true,
    error: null,
    routingRulesDeleted: res.data.routingRulesDeleted,
    ghlConnectionsUnlinked: res.data.ghlConnectionsUnlinked,
  };
}

export async function fetchAdminClientDeletionImpact(clientAccountId: string): Promise<{
  ok: boolean;
  error: string | null;
  impact?: {
    clientAccountId: string;
    clientDisplayName: string;
    counts: Record<string, number | boolean>;
    blockers: string[];
    blocked: boolean;
    warning: string;
  };
}> {
  const id = clientAccountId.trim();
  const res = await adminRequestJson<{
    impact: {
      clientAccountId: string;
      clientDisplayName: string;
      counts: Record<string, number | boolean>;
      blockers: string[];
      blocked: boolean;
      warning: string;
    };
  }>("GET", `/admin/v1/clients/${encodeURIComponent(id)}/deletion-impact`);
  if (!res.ok) return { ok: false, error: formatError(res) };
  return { ok: true, error: null, impact: res.data.impact };
}

export async function fetchAdminClientRekeyPreview(
  sourceClientAccountId: string,
  targetClientAccountId: string
): Promise<{
  ok: boolean;
  error: string | null;
  preview?: Record<string, unknown>;
}> {
  const params = new URLSearchParams({ targetClientAccountId: targetClientAccountId.trim() });
  const res = await adminRequestJson<{ preview: Record<string, unknown> }>(
    "GET",
    `/admin/v1/clients/${encodeURIComponent(sourceClientAccountId.trim())}/rekey-preview?${params}`
  );
  if (!res.ok) return { ok: false, error: formatError(res) };
  return { ok: true, error: null, preview: res.data.preview };
}

export async function postAdminClientRekey(
  sourceClientAccountId: string,
  body: { targetClientAccountId: string; confirmation: string }
): Promise<{
  ok: boolean;
  error: string | null;
  result?: Record<string, unknown>;
}> {
  const res = await adminRequestJson<{ result: Record<string, unknown> }>(
    "POST",
    `/admin/v1/clients/${encodeURIComponent(sourceClientAccountId.trim())}/rekey`,
    body
  );
  if (!res.ok) return { ok: false, error: formatError(res) };
  return { ok: true, error: null, result: res.data.result };
}

export async function fetchAdminRoutingRulesForClient(
  params: { masterClientAccountId?: string; clientAccountId: string; active?: boolean }
): Promise<{ data: DeliveryReadinessListResponse | null; error: string | null }> {
  const searchParams = new URLSearchParams();
  if (params.masterClientAccountId?.trim()) {
    searchParams.set("masterClientAccountId", params.masterClientAccountId.trim());
  }
  searchParams.set("clientAccountId", params.clientAccountId.trim());
  if (params.active !== undefined) {
    searchParams.set("active", params.active ? "true" : "false");
  }
  const res = await adminFetchJson<DeliveryReadinessListResponse>(
    `/admin/v1/routing/rules?${searchParams.toString()}`
  );
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminDirectDemoDelivery(body: {
  payload: unknown;
  mode: DirectDemoDeliveryMode;
  confirmLiveDeliveryRisk?: boolean;
  operatorConfirmationText?: string;
}): Promise<{
  data: DirectDemoDeliveryResponse | null;
  error: string | null;
  status: number;
}> {
  const res = await adminRequestJson<DirectDemoDeliveryResponse>(
    "POST",
    "/admin/v1/lead-delivery/direct-demo",
    body
  );
  if (res.ok) return { data: res.data, status: 200, error: null };
  try {
    const parsed = JSON.parse(res.body) as DirectDemoDeliveryResponse;
    return {
      data: parsed,
      status: res.status,
      error: parsed.reason ?? parsed.blockers?.join(" ") ?? formatError(res),
    };
  } catch {
    return { data: null, status: res.status, error: formatError(res) };
  }
}

export type AdminHealthResponse = {
  ok: boolean;
  service?: string;
  commitSha?: string | null;
  commitShort?: string | null;
  buildLabel?: string | null;
  buildSource?: string | null;
};

export async function fetchAdminHealth(): Promise<{
  data: AdminHealthResponse | null;
  error: string | null;
}> {
  const res = await adminFetchJson<AdminHealthResponse>("/admin/v1/health");
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function fetchAdminDeliveryRuntimeMode(): Promise<{
  data: import("@/lib/delivery-runtime-mode/types").DeliveryRuntimeModeStatus | null;
  error: string | null;
}> {
  const res = await adminFetchJson<
    import("@/lib/delivery-runtime-mode/types").DeliveryRuntimeModeStatus
  >("/admin/v1/delivery-runtime-mode");
  if (!res.ok) return { data: null, error: formatError(res) };
  return { data: res.data, error: null };
}

export async function postAdminDeliveryRuntimeMode(body: {
  mode: "simulate" | "live_canary";
  durationMinutes?: number;
  operatorConfirmationText: string;
  reason?: string;
}): Promise<{
  data: import("@/lib/delivery-runtime-mode/types").DeliveryRuntimeModeStatus | null;
  error: string | null;
}> {
  const res = await adminRequestJson<
    import("@/lib/delivery-runtime-mode/types").DeliveryRuntimeModeStatus
  >("POST", "/admin/v1/delivery-runtime-mode", body);
  if (res.ok) return { data: res.data, error: null };
  try {
    const parsed = JSON.parse(res.body) as { error?: string };
    return { data: null, error: parsed.error ?? formatError(res) };
  } catch {
    return { data: null, error: formatError(res) };
  }
}


export async function fetchAdminSourceLeads(
  params: Record<string, string> = {}
): Promise<{ items: SourceLeadListResponse["items"]; nextCursor: string | null; error: string | null }> {
  const qs = new URLSearchParams(params).toString();
  const path = qs ? `/admin/v1/source-leads?${qs}` : "/admin/v1/source-leads";
  const res = await adminFetchJson<SourceLeadListResponse>(path);
  if (!res.ok) return { items: [], nextCursor: null, error: formatError(res) };
  return { items: res.data.items ?? [], nextCursor: res.data.nextCursor ?? null, error: null };
}

export async function fetchAdminSourceLeadDetail(id: string): Promise<{
  item: SourceLeadDetail | null;
  error: string | null;
}> {
  const res = await adminFetchJson<{ ok: boolean; item: SourceLeadDetail }>(
    `/admin/v1/source-leads/${encodeURIComponent(id)}`
  );
  if (!res.ok) return { item: null, error: formatError(res) };
  return { item: res.data.item, error: null };
}

export async function postAdminSourceLeadApproveDelivery(
  id: string,
  body: {
    mode: SourceLeadApproveMode;
    operatorConfirmationText: string;
    confirmLiveDeliveryRisk?: boolean;
  }
): Promise<{ data: unknown; error: string | null; status: number }> {
  const res = await adminRequestJson<unknown>(
    "POST",
    `/admin/v1/source-leads/${encodeURIComponent(id)}/approve-delivery`,
    body
  );
  if (res.ok) {
    return { data: res.data, error: null, status: 200 };
  }
  try {
    const parsed = res.body ? (JSON.parse(res.body) as { reason?: string; error?: string }) : {};
    return {
      data: parsed,
      error: parsed.reason ?? parsed.error ?? formatError(res),
      status: res.status,
    };
  } catch {
    return { data: null, error: formatError(res), status: res.status };
  }
}
