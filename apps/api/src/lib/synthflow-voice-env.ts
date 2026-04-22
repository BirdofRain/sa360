/**
 * Synthflow voice inbound lookup configuration.
 * SYNTHFLOW_INBOUND_ENABLED defaults to false when unset (explicit opt-in).
 */
function parseEnabledFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") {
    return false;
  }
  return ["true", "1", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

export function isSynthflowInboundEnabled(): boolean {
  return parseEnabledFlag(process.env.SYNTHFLOW_INBOUND_ENABLED);
}

export function getLookupMode(): string {
  return (process.env.LOOKUP_MODE || "").trim().toLowerCase();
}

export function getMakeLookupUrl(): string | undefined {
  const u = process.env.MAKE_LOOKUP_URL?.trim();
  return u || undefined;
}

/** Upper bound for outbound Make lookup (ms). Parsed from MAKE_LOOKUP_TIMEOUT_MS; defaults to 8000, max 30000. */
export function getMakeLookupTimeoutMs(): number {
  const n = Number(process.env.MAKE_LOOKUP_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) {
    return 8000;
  }
  return Math.min(Math.floor(n), 30000);
}
