export type RoutingDryRunMatchedFilter = "all" | "matched" | "unmatched";

export type RoutingDryRunLimit = 25 | 50 | 100;

export type RoutingDryRunQuery = {
  masterClientAccountId: string;
  matched: RoutingDryRunMatchedFilter;
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

export function parseRoutingDryRunSearchParams(
  sp: Record<string, string | string[] | undefined>
): RoutingDryRunQuery {
  return {
    masterClientAccountId: firstString(sp.masterClientAccountId)?.trim() ?? "",
    matched: parseMatched(firstString(sp.matched)),
    limit: parseLimit(firstString(sp.limit)),
  };
}

export function routingDryRunQueryToApiParams(query: RoutingDryRunQuery): {
  masterClientAccountId: string;
  limit: number;
  matched?: boolean;
} | null {
  const master = query.masterClientAccountId.trim();
  if (!master) return null;
  return {
    masterClientAccountId: master,
    limit: query.limit,
    matched:
      query.matched === "all"
        ? undefined
        : query.matched === "matched",
  };
}

export function buildRoutingDryRunHref(query: RoutingDryRunQuery): string {
  const params = new URLSearchParams();
  if (query.masterClientAccountId.trim()) {
    params.set("masterClientAccountId", query.masterClientAccountId.trim());
  }
  if (query.matched !== "all") params.set("matched", query.matched);
  params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `/routing-dry-run?${qs}` : "/routing-dry-run";
}

/** Optional env default for master account filter (operator convenience only). */
export function getRoutingDryRunDefaultMasterClientAccountId(): string {
  return process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID?.trim() ?? "";
}
