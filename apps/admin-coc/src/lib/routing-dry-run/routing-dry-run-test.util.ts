export type RoutingDryRunTestParseResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/** Parse operator-pasted lifecycle JSON for manual dry-run (no persistence). */
export function parseRoutingDryRunTestJson(raw: string): RoutingDryRunTestParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste a JSON payload first." };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Payload must be a JSON object." };
    }
    return { ok: true, payload: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON — check commas and quotes." };
  }
}

export function formatRoutingDryRunApiError(status: number, body: string): string {
  if (status === 0) return "Admin API is not configured.";
  if (status === 401 || status === 403) return "Admin API rejected the request (check API key).";
  if (status === 400) {
    try {
      const j = JSON.parse(body) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* ignore */
    }
    return "Invalid payload for dry-run (check lifecycle schema).";
  }
  if (status >= 500) return "Admin API error — try again later.";
  const snippet = body.trim().slice(0, 200);
  return snippet ? `Request failed (${status}): ${snippet}` : `Request failed (${status}).`;
}
