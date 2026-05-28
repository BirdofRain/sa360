import type { RoutingValidationStatusFilter } from "./routing-dry-run-validation-display";
import type { RoutingDryRunReviewQueue } from "./types";

export type RoutingDryRunMatchedFilter = "all" | "matched" | "unmatched";

export type RoutingDryRunLimit = 25 | 50 | 100;

export type RoutingDryRunReviewQueueFilter = RoutingDryRunReviewQueue | "all";

export type RoutingDryRunQuery = {
  masterClientAccountId: string;
  matched: RoutingDryRunMatchedFilter;
  validationStatus: RoutingValidationStatusFilter;
  reviewQueue: RoutingDryRunReviewQueueFilter;
  limit: RoutingDryRunLimit;
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function parseLimit(raw: string | undefined): RoutingDryRunLimit {
  const n = Number(raw);
  if (n === 25 || n === 50 || n === 100) return n;
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
  return {
    masterClientAccountId: firstString(sp.masterClientAccountId)?.trim() ?? "",
    matched: parseMatched(firstString(sp.matched)),
    validationStatus: parseValidationStatus(firstString(sp.validationStatus)),
    reviewQueue: parseReviewQueue(firstString(sp.reviewQueue)),
    limit: parseLimit(firstString(sp.limit)),
  };
}

export function routingDryRunQueryToApiParams(query: RoutingDryRunQuery): {
  masterClientAccountId: string;
  limit: number;
  matched?: boolean;
  validationStatus?: string;
  reviewQueue?: RoutingDryRunReviewQueue;
} | null {
  const master = query.masterClientAccountId.trim();
  if (!master) return null;
  const reviewQueue = query.reviewQueue === "all" ? undefined : query.reviewQueue;
  const params: {
    masterClientAccountId: string;
    limit: number;
    matched?: boolean;
    validationStatus?: string;
    reviewQueue?: RoutingDryRunReviewQueue;
  } = {
    masterClientAccountId: master,
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
  if (query.masterClientAccountId.trim()) {
    params.set("masterClientAccountId", query.masterClientAccountId.trim());
  }
  if (query.matched !== "all") params.set("matched", query.matched);
  if (query.validationStatus !== "all") params.set("validationStatus", query.validationStatus);
  if (query.reviewQueue !== "all") params.set("reviewQueue", query.reviewQueue);
  params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `/routing-dry-run?${qs}` : "/routing-dry-run";
}

/** Optional env default for master account filter (operator convenience only). */
export function getRoutingDryRunDefaultMasterClientAccountId(): string {
  return process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID?.trim() ?? "";
}
