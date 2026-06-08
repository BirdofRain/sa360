/**
 * Demo-only direct delivery allowlist (Phase 5C).
 * Canonical Smart Agent 360 Demo destination — override via env for staging tests.
 */

export const DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID = "smart_agent_360_demo";
export const DIRECT_DEMO_CANONICAL_LOCATION_ID = "VPuMIhN6JpxdoXvvlekZ";

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getDirectDeliveryAllowedClientIds(): ReadonlySet<string> {
  const fromEnv = parseCsvEnv(process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS);
  if (fromEnv.length > 0) return new Set(fromEnv);
  return new Set([DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID]);
}

export function getDirectDeliveryAllowedLocationIds(): ReadonlySet<string> {
  const fromEnv = parseCsvEnv(process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS);
  if (fromEnv.length > 0) return new Set(fromEnv);
  return new Set([DIRECT_DEMO_CANONICAL_LOCATION_ID]);
}

export function isDirectDemoDestinationAllowed(
  clientAccountId: string | null | undefined,
  locationId: string | null | undefined
): boolean {
  const client = clientAccountId?.trim();
  const loc = locationId?.trim();
  if (!client || !loc) return false;
  return (
    getDirectDeliveryAllowedClientIds().has(client) &&
    getDirectDeliveryAllowedLocationIds().has(loc)
  );
}

/** Live direct delivery requires explicit env allowlist (both vars set). */
export function isDirectLiveDeliveryEnvConfigured(): boolean {
  return Boolean(
    process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS?.trim() &&
      process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS?.trim()
  );
}
