export type AdminFetchFailure = { ok: false; status: number; body: string };

function isHtmlGatewayBody(body: string): boolean {
  const trimmed = body.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

/** Safe admin error text — never surface raw HTML gateway pages in the UI. */
export function formatAdminApiError(err: AdminFetchFailure): string {
  if (err.status === 0) return err.body;
  if (isHtmlGatewayBody(err.body) || err.status === 502 || err.status === 503 || err.status === 504) {
    return `Admin API temporarily unavailable (HTTP ${err.status}). The upstream response was not JSON.`;
  }
  if (err.body === "Invalid JSON from admin API") {
    return `Admin API returned a non-JSON response (HTTP ${err.status}).`;
  }
  const snippet = err.body.length > 280 ? `${err.body.slice(0, 280)}…` : err.body;
  return `Admin API error (${err.status}): ${snippet}`;
}
