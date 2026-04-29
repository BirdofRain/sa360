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

/** When set, InboundContactIndex lookup is restricted to this clientAccountId (recommended for multi-tenant). */
export function getSynthflowLookupClientAccountId(): string | undefined {
  const v = process.env.SYNTHFLOW_LOOKUP_CLIENT_ACCOUNT_ID?.trim();
  return v || undefined;
}

/**
 * When SYNTHFLOW_LOOKUP_CLIENT_ACCOUNT_ID is set:
 * - If this env var is **absent**, match any subaccount for that client.
 * - If present (including empty string), match that exact `subaccountIdGhl` ("" = no subaccount in index).
 */
export function getSynthflowLookupSubaccountIdGhl(): string | undefined {
  if (!("SYNTHFLOW_LOOKUP_SUBACCOUNT_ID_GHL" in process.env)) {
    return undefined;
  }
  return process.env.SYNTHFLOW_LOOKUP_SUBACCOUNT_ID_GHL?.trim() ?? "";
}

