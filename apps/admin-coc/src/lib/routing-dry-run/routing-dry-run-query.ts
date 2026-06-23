import { getDefaultMasterClientAccountId } from "../clients/master-client-default.ts";
import type { RoutingValidationStatusFilter } from "./routing-dry-run-validation-display";
import type { RoutingDryRunReviewQueue } from "./types";

export type RoutingDryRunMatchedFilter = "all" | "matched" | "unmatched";

export type RoutingDryRunLimit = 5 | 25 | 50 | 100;

export type RoutingDryRunReviewQueueFilter = RoutingDryRunReviewQueue | "all";

export type RoutingDryRunQuery = {
  masterClientAccountId: string;
  matched: RoutingDryRunMatchedFilter;
  validationStatus: RoutingValidationStatusFilter;
  reviewQueue: RoutingDryRunReviewQueueFilter;
  limit: RoutingDryRunLimit;
  /** Emergency minimal page: skip stats, cap list, relaxed filters. */
  safeMode: boolean;
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function parseSafeMode(raw: string | undefined): boolean {
  return raw === "1" || raw === "true";
}

function parseLimit(raw: string | undefined, safeMode: boolean): RoutingDryRunLimit {
  const n = Number(raw);
  if (n === 5 || n === 25 || n === 50 || n === 100) return n;
  if (safeMode) return 5;
  return 50;
}

function parseMatched(raw: string | undefined): RoutingDryRunMatchedFilter {
  if (raw === "matched" || raw === "unmatched") return raw;
  return "all";
}

const REVIEW_QUEUES: RoutingDryRunReviewQueueFilter[] = [
  "all",
  "unreviewed_only",
  "mismatches",
  "needs_mapping",
  "matched_no_plan",
  "matched_needs_config_plan",
];

function parseReviewQueue(raw: string | undefined): RoutingDryRunReviewQueueFilter {
  if (raw && (REVIEW_QUEUES as string[]).includes(raw)) {
    return raw as RoutingDryRunReviewQueueFilter;
  }
  return "all";
}

function parseValidationStatus(raw: string | undefined): RoutingValidationStatusFilter {
  const allowed: RoutingValidationStatusFilter[] = [
    "all",
    "unreviewed",
    "matched_legacy",
    "mismatch",
    "needs_mapping",
    "ignored_test",
    "legacy_unknown",
  ];
  if (raw && (allowed as string[]).includes(raw)) return raw as RoutingValidationStatusFilter;
  return "all";
}

export function parseRoutingDryRunSearchParams(
  sp: Record<string, string | string[] | undefined>
): RoutingDryRunQuery {
  const safeMode = parseSafeMode(firstString(sp.safe));
  return {
    masterClientAccountId: firstString(sp.masterClientAccountId)?.trim() ?? "",
    matched: safeMode ? "all" : parseMatched(firstString(sp.matched)),
    validationStatus: safeMode ? "all" : parseValidationStatus(firstString(sp.validationStatus)),
    reviewQueue: safeMode ? "all" : parseReviewQueue(firstString(sp.reviewQueue)),
    limit: parseLimit(firstString(sp.limit), safeMode),
    safeMode,
  };
}

export function routingDryRunQueryToApiParams(query: RoutingDryRunQuery): {
  masterClientAccountId?: string;
  limit: number;
  matched?: boolean;
  validationStatus?: string;
  reviewQueue?: RoutingDryRunReviewQueue;
} {
  const master = query.masterClientAccountId.trim();
  const reviewQueue = query.reviewQueue === "all" ? undefined : query.reviewQueue;
  const params: {
    masterClientAccountId?: string;
    limit: number;
    matched?: boolean;
    validationStatus?: string;
    reviewQueue?: RoutingDryRunReviewQueue;
  } = {
    limit: query.limit,
    matched:
      query.matched === "all"
        ? undefined
        : query.matched === "matched",
    validationStatus:
      reviewQueue || query.validationStatus === "all"
        ? undefined
        : query.validationStatus,
  };
  if (master) params.masterClientAccountId = master;
  if (reviewQueue) params.reviewQueue = reviewQueue;
  return params;
}

export function routingDryRunQueryToStatsParams(query: RoutingDryRunQuery): {
  masterClientAccountId: string;
} | null {
  const master = query.masterClientAccountId.trim();
  if (!master) return null;
  return { masterClientAccountId: master };
}

export function buildRoutingDryRunHref(query: RoutingDryRunQuery): string {
  const params = new URLSearchParams();
  if (query.safeMode) params.set("safe", "1");
  if (query.masterClientAccountId.trim()) {
    params.set("masterClientAccountId", query.masterClientAccountId.trim());
  }
  if (!query.safeMode && query.matched !== "all") params.set("matched", query.matched);
  if (!query.safeMode && query.validationStatus !== "all") {
    params.set("validationStatus", query.validationStatus);
  }
  if (!query.safeMode && query.reviewQueue !== "all") params.set("reviewQueue", query.reviewQueue);
  params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `/routing-dry-run?${qs}` : "/routing-dry-run";
}

/** Emergency URL: minimal list, no stats, no master filter. */
export function routingDryRunSafeHref(): string {
  return buildRoutingDryRunHref({
    masterClientAccountId: "",
    matched: "all",
    validationStatus: "all",
    reviewQueue: "all",
    limit: 5,
    safeMode: true,
  });
}

/** Clears all filters and loads the page in full (non-safe) mode. */
export function routingDryRunCleanHref(): string {
  return "/routing-dry-run";
}

export function hasRoutingDryRunMasterFilter(query: RoutingDryRunQuery): boolean {
  return Boolean(query.masterClientAccountId.trim());
}

/** Optional env default for master account filter (operator convenience only). */
export function getRoutingDryRunDefaultMasterClientAccountId(): string {
  return getDefaultMasterClientAccountId();
}

/** Apply env default when query string omits masterClientAccountId. */
export function applyRoutingDryRunDefaultMaster(query: RoutingDryRunQuery): RoutingDryRunQuery {
  if (query.masterClientAccountId.trim()) return query;
  const def = getRoutingDryRunDefaultMasterClientAccountId();
  return def ? { ...query, masterClientAccountId: def } : query;
}
