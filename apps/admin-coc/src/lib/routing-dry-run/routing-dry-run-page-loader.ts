import "server-only";

import {
  fetchAdminRoutingDryRunDecisions,
  fetchAdminRoutingDryRunStats,
  getAdminApiBaseUrl,
  isAdminApiConfigured,
} from "../admin-api/server.ts";
import {
  logRoutingDryRunDiagnostic,
  topLevelKeysOf,
} from "./routing-dry-run-diagnostics.ts";
import { routingDryRunEmptyHint } from "./routing-dry-run-empty-state.ts";
import {
  applyRoutingDryRunDefaultMaster,
  parseRoutingDryRunSearchParams,
  routingDryRunQueryToApiParams,
  routingDryRunQueryToStatsParams,
  type RoutingDryRunQuery,
} from "./routing-dry-run-query.ts";
import { serializeRoutingDryRunRowsForRsc } from "./routing-dry-run-rsc-serialize.ts";
import {
  ROUTING_DRY_RUN_ACTION_FAILED,
  safeNormalizeRoutingDryRunDecisionList,
  type RoutingDryRunDecisionView,
} from "./routing-dry-run-safe.ts";
import { normalizeRoutingDryRunStats } from "./routing-dry-run-stats-normalize.ts";
import type { RoutingDryRunStats } from "./types.ts";

export type RoutingDryRunPageLoadResult = {
  query: RoutingDryRunQuery;
  configured: boolean;
  hasMaster: boolean;
  decisionsError: string | null;
  statsError: string | null;
  globalStats: RoutingDryRunStats | null;
  items: RoutingDryRunDecisionView[];
  emptyHint: string | null;
  loadWarnings: string[];
};

function buildRequestUrl(path: string): string | undefined {
  const base = getAdminApiBaseUrl();
  if (!base) return undefined;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function loadDecisionsSection(
  apiParams: NonNullable<ReturnType<typeof routingDryRunQueryToApiParams>>,
  safeMode: boolean
): Promise<{ items: RoutingDryRunDecisionView[]; error: string | null }> {
  const path = `/admin/v1/routing/dry-run-decisions?masterClientAccountId=${encodeURIComponent(apiParams.masterClientAccountId)}&limit=${apiParams.limit}`;
  const requestUrl = buildRequestUrl(path);

  try {
    const res = await fetchAdminRoutingDryRunDecisions(apiParams);
    logRoutingDryRunDiagnostic({
      section: "decisions",
      safeMode,
      requestUrl,
      status: res.error ? 0 : 200,
      jsonOk: Boolean(res.data),
      topLevelKeys: topLevelKeysOf(res.data),
      rowCount: Array.isArray(res.data?.items) ? res.data.items.length : undefined,
      error: res.error ?? undefined,
    });

    if (res.error) return { items: [], error: res.error };

    let items: RoutingDryRunDecisionView[] = [];
    try {
      items = safeNormalizeRoutingDryRunDecisionList(res.data?.items ?? []);
      logRoutingDryRunDiagnostic({
        section: "normalize",
        safeMode,
        rowCount: items.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logRoutingDryRunDiagnostic({ section: "normalize", safeMode, error: msg });
      return { items: [], error: ROUTING_DRY_RUN_ACTION_FAILED };
    }

    try {
      items = serializeRoutingDryRunRowsForRsc(items);
      logRoutingDryRunDiagnostic({ section: "serialize", safeMode, rowCount: items.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logRoutingDryRunDiagnostic({ section: "serialize", safeMode, error: msg });
      return { items: [], error: "Decision rows could not be serialized for display." };
    }

    return { items, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRoutingDryRunDiagnostic({ section: "decisions", safeMode, requestUrl, error: msg });
    return { items: [], error: ROUTING_DRY_RUN_ACTION_FAILED };
  }
}

async function loadStatsSection(
  statsParams: { masterClientAccountId: string },
  safeMode: boolean
): Promise<{ stats: RoutingDryRunStats | null; error: string | null }> {
  if (safeMode) {
    return { stats: null, error: null };
  }

  const path = `/admin/v1/routing/dry-run-stats?masterClientAccountId=${encodeURIComponent(statsParams.masterClientAccountId)}`;
  const requestUrl = buildRequestUrl(path);

  try {
    const res = await fetchAdminRoutingDryRunStats(statsParams);
    logRoutingDryRunDiagnostic({
      section: "stats",
      safeMode,
      requestUrl,
      status: res.error ? 0 : 200,
      jsonOk: Boolean(res.data),
      topLevelKeys: topLevelKeysOf(res.data),
      error: res.error ?? undefined,
    });

    if (res.error) return { stats: null, error: res.error };

    const stats = normalizeRoutingDryRunStats(
      (res.data as { stats?: unknown } | null)?.stats ?? res.data
    );
    if (!stats) {
      return { stats: null, error: "Global stats response was empty or malformed." };
    }
    return { stats, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logRoutingDryRunDiagnostic({ section: "stats", safeMode, requestUrl, error: msg });
    return { stats: null, error: ROUTING_DRY_RUN_ACTION_FAILED };
  }
}

export async function loadRoutingDryRunPageData(
  sp: Record<string, string | string[] | undefined>
): Promise<RoutingDryRunPageLoadResult> {
  const loadWarnings: string[] = [];
  let query = parseRoutingDryRunSearchParams(sp);

  logRoutingDryRunDiagnostic({
    section: "query",
    safeMode: query.safeMode,
    topLevelKeys: Object.keys(sp).slice(0, 20),
  });

  if (!query.safeMode) {
    query = applyRoutingDryRunDefaultMaster(query);
  } else if (!query.masterClientAccountId.trim()) {
    query = applyRoutingDryRunDefaultMaster(query);
    if (query.masterClientAccountId.trim()) {
      loadWarnings.push("Safe mode: using env default master for decisions list only.");
    }
  }

  const configured = isAdminApiConfigured();
  const apiParams = routingDryRunQueryToApiParams(query);
  const hasMaster = Boolean(apiParams?.masterClientAccountId);
  const statsParams = query.safeMode ? null : routingDryRunQueryToStatsParams(query);

  let decisionsError: string | null = null;
  let statsError: string | null = null;
  let items: RoutingDryRunDecisionView[] = [];
  let globalStats: RoutingDryRunStats | null = null;

  if (configured && apiParams) {
    const decisions = await loadDecisionsSection(apiParams, query.safeMode);
    items = decisions.items;
    decisionsError = decisions.error;
  }

  if (configured && statsParams) {
    const stats = await loadStatsSection(statsParams, query.safeMode);
    globalStats = stats.stats;
    statsError = stats.error;
  } else if (query.safeMode) {
    loadWarnings.push("Safe mode: global stats skipped.");
  }

  const emptyHint = routingDryRunEmptyHint({
    configured,
    hasMaster,
    hasApiError: Boolean(decisionsError),
    itemCount: items.length,
    matchedFilter: query.matched,
    validationStatusFilter: query.validationStatus,
    reviewQueueFilter: query.reviewQueue,
  });

  return {
    query,
    configured,
    hasMaster,
    decisionsError,
    statsError,
    globalStats,
    items,
    emptyHint,
    loadWarnings,
  };
}
