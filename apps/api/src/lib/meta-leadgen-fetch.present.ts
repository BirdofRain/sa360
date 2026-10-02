function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type MetaLeadgenFetchPresentation = {
  state: string | null;
  jobId: string | null;
  attempt: number | null;
  queuedAt: string | null;
  requeuedAt: string | null;
  enqueueFailedAt: string | null;
  fetchStartedAt: string | null;
  fetchFinishedAt: string | null;
  graphOutcome: string | null;
  graphStatus: number | null;
  graphErrorCode: string | null;
  graphErrorMessage: string | null;
  tokenScope: string | null;
  liveDelivery: false;
  capiDispatched: false;
};

/**
 * Graph fetch observability for direct Meta Lead Ads rows, read from
 * `enrichmentMetadataJson.metaLeadgenFetch`. Token-free by construction: the
 * fetch service never stores the access token or the Graph URL.
 */
export function presentMetaLeadgenFetch(enrichmentJson: unknown): MetaLeadgenFetchPresentation | null {
  const bag = asRecord(asRecord(enrichmentJson)?.metaLeadgenFetch);
  if (!bag) return null;
  const graphError = asRecord(bag.graphError);
  return {
    state: asString(bag.state),
    jobId: asString(bag.jobId),
    attempt: typeof bag.attempt === "number" ? bag.attempt : null,
    queuedAt: asString(bag.queuedAt),
    requeuedAt: asString(bag.requeuedAt),
    enqueueFailedAt: asString(bag.enqueueFailedAt),
    fetchStartedAt: asString(bag.fetchStartedAt),
    fetchFinishedAt: asString(bag.fetchFinishedAt),
    graphOutcome: asString(bag.graphOutcome),
    graphStatus: typeof bag.graphStatus === "number" ? bag.graphStatus : null,
    graphErrorCode: asString(graphError?.code),
    graphErrorMessage: asString(graphError?.message),
    tokenScope: asString(bag.tokenScope),
    liveDelivery: false,
    capiDispatched: false,
  };
}
