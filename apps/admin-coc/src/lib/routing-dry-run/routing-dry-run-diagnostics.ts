import "server-only";

export type RoutingDryRunDiagnosticSection =
  | "query"
  | "decisions"
  | "stats"
  | "normalize"
  | "serialize";

export type RoutingDryRunDiagnosticPayload = {
  section: RoutingDryRunDiagnosticSection;
  safeMode: boolean;
  requestUrl?: string;
  status?: number;
  jsonOk?: boolean;
  topLevelKeys?: string[];
  rowCount?: number;
  error?: string;
};

const LOG_PREFIX = "[routing-dry-run-page]";

/** Temporary server-side diagnostics (no secrets). */
export function logRoutingDryRunDiagnostic(payload: RoutingDryRunDiagnosticPayload): void {
  const { section, safeMode, requestUrl, status, jsonOk, topLevelKeys, rowCount, error } =
    payload;
  console.error(
    LOG_PREFIX,
    JSON.stringify({
      section,
      safeMode,
      requestUrl: requestUrl ? sanitizeUrlForLog(requestUrl) : undefined,
      status,
      jsonOk,
      topLevelKeys,
      rowCount,
      error: error?.slice(0, 300),
    })
  );
}

function sanitizeUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search ? "?…" : ""}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

export function topLevelKeysOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, 20);
}
