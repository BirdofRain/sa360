export type SourceIntakeQuery = {
  status?: string;
  sourceProvider?: string;
  sourceSystem?: string;
  matched?: "true" | "false";
  clientAccountIdResolved?: string;
  limit?: number;
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
  return {
    status: one("status"),
    sourceProvider: one("provider"),
    sourceSystem: one("system"),
    matched: one("matched") === "true" || one("matched") === "false" ? one("matched") as "true" | "false" : undefined,
    clientAccountIdResolved: one("client"),
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

export function sourceIntakeToApiParams(query: SourceIntakeQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.status) params.status = query.status;
  if (query.sourceProvider) params.sourceProvider = query.sourceProvider;
  if (query.sourceSystem) params.sourceSystem = query.sourceSystem;
  if (query.matched) params.matched = query.matched;
  if (query.clientAccountIdResolved) params.clientAccountIdResolved = query.clientAccountIdResolved;
  if (query.limit) params.limit = String(query.limit);
  return params;
}
