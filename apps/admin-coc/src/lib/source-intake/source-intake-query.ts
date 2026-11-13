/** Status the Source Intake queue already filters with `?status=`. */
export const SOURCE_INTAKE_AWAITING_REVIEW_STATUS = "needs_review";

export const SOURCE_INTAKE_AWAITING_REVIEW_HREF = `/source-intake?status=${SOURCE_INTAKE_AWAITING_REVIEW_STATUS}`;

/**
 * Current source-lead status after an external delivery write failed.
 * Source Intake opens this exact filter, and requeue is the operator action.
 */
export const SOURCE_INTAKE_DELIVERY_FAILED_STATUS = "delivery_failed";

/** Stored proof that the current failure was a live external write. */
export const SOURCE_INTAKE_LIVE_FAILURE_PARAM = "liveFailure";

export const SOURCE_INTAKE_DELIVERY_FAILED_HREF = `/source-intake?status=${SOURCE_INTAKE_DELIVERY_FAILED_STATUS}&${SOURCE_INTAKE_LIVE_FAILURE_PARAM}=true`;

export type SourceIntakeQuery = {
  status?: string;
  sourceProvider?: string;
  sourceSystem?: string;
  matched?: "true" | "false";
  clientAccountIdResolved?: string;
  limit?: number;
  cursor?: string;
  liveFailure?: boolean;
};

export function parseSourceIntakeSearchParams(
  sp: Record<string, string | string[] | undefined>
): SourceIntakeQuery {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  };
  const limitRaw = one("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = one("cursor");
  return {
    status: one("status"),
    sourceProvider: one("provider"),
    sourceSystem: one("system"),
    matched: one("matched") === "true" || one("matched") === "false" ? one("matched") as "true" | "false" : undefined,
    clientAccountIdResolved: one("client"),
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor: cursor && cursor.trim() !== "" ? cursor : undefined,
    liveFailure: one(SOURCE_INTAKE_LIVE_FAILURE_PARAM) === "true",
  };
}

/** Page URL for the current filters. Pass cursor null to clear it. */
export function sourceIntakePageHref(
  query: SourceIntakeQuery,
  overrides?: { cursor?: string | null }
): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.sourceProvider) params.set("provider", query.sourceProvider);
  if (query.sourceSystem) params.set("system", query.sourceSystem);
  if (query.matched) params.set("matched", query.matched);
  if (query.clientAccountIdResolved) params.set("client", query.clientAccountIdResolved);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.liveFailure) params.set(SOURCE_INTAKE_LIVE_FAILURE_PARAM, "true");
  const cursor = overrides && "cursor" in overrides ? overrides.cursor : query.cursor;
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `/source-intake?${qs}` : "/source-intake";
}

export function sourceIntakeToApiParams(query: SourceIntakeQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.status) params.status = query.status;
  if (query.sourceProvider) params.sourceProvider = query.sourceProvider;
  if (query.sourceSystem) params.sourceSystem = query.sourceSystem;
  if (query.matched) params.matched = query.matched;
  if (query.clientAccountIdResolved) params.clientAccountIdResolved = query.clientAccountIdResolved;
  if (query.limit) params.limit = String(query.limit);
  if (query.cursor) params.cursor = query.cursor;
  if (query.liveFailure) params.liveFailure = "true";
  return params;
}
