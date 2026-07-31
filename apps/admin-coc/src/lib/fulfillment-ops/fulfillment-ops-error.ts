function isHtmlGatewayBody(body: string): boolean {
  const trimmed = body.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

export function formatFulfillmentOpsAdminError(status: number, body: string): string {
  if (status === 0) return body || "Admin API unavailable";
  if (isHtmlGatewayBody(body) || status === 502 || status === 503 || status === 504) {
    return `Admin API temporarily unavailable (HTTP ${status}). The upstream response was not JSON.`;
  }
  if (body === "Invalid JSON from admin API") {
    return `Admin API returned a non-JSON response (HTTP ${status}).`;
  }
  const snippet = body.length > 280 ? `${body.slice(0, 280)}…` : body;
  return `Admin API error (${status}): ${snippet}`;
}
