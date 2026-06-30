/**
 * Demo-only direct delivery allowlist (Phase 5C).
 * Canonical Smart Agent 360 Demo destination — override via env for staging tests.
 */

export const DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID = "smart_agent_360_demo";
export const DIRECT_DEMO_CANONICAL_LOCATION_ID = "VPuMIhN6JpxdoXvvlekZ";
export const LIVE_CANARY_DESTINATION_ALLOWLIST_ENV = "SA360_LIVE_CANARY_ALLOWED_DESTINATIONS";

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

function destinationPairKey(clientAccountId: string, locationIdGhl: string): string {
  return `${clientAccountId.trim()}:${locationIdGhl.trim()}`;
}

function parseLiveCanaryAllowlistCsv(raw: string): Set<string> {
  const pairs = new Set<string>();
  for (const segment of raw.split(",")) {
    const token = segment.trim();
    if (!token) continue;
    const [clientAccountId, locationIdGhl] = token.split(":");
    const client = clientAccountId?.trim();
    const location = locationIdGhl?.trim();
    if (!client || !location) continue;
    pairs.add(destinationPairKey(client, location));
  }
  return pairs;
}

function parseLiveCanaryAllowlistJson(raw: string): Set<string> {
  const parsed = JSON.parse(raw) as unknown;
  const pairs = new Set<string>();
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === "string") {
        for (const pair of parseLiveCanaryAllowlistCsv(item)) {
          pairs.add(pair);
        }
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const client = typeof record.clientAccountId === "string" ? record.clientAccountId.trim() : "";
      const location = typeof record.locationIdGhl === "string" ? record.locationIdGhl.trim() : "";
      if (client && location) {
        pairs.add(destinationPairKey(client, location));
      }
    }
    return pairs;
  }

  if (parsed && typeof parsed === "object") {
    for (const [clientAccountId, locationIdGhl] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof locationIdGhl !== "string") continue;
      const client = clientAccountId.trim();
      const location = locationIdGhl.trim();
      if (!client || !location) continue;
      pairs.add(destinationPairKey(client, location));
    }
  }
  return pairs;
}

export function getLiveCanaryAllowedDestinationPairs(): Set<string> | null {
  const raw = process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV]?.trim();
  if (!raw) return null;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return parseLiveCanaryAllowlistJson(raw);
    } catch {
      return new Set();
    }
  }
  return parseLiveCanaryAllowlistCsv(raw);
}

export function isDestinationAllowedForLiveCanary(
  clientAccountId: string | null | undefined,
  locationIdGhl: string | null | undefined
): { configured: boolean; allowed: boolean } {
  const client = clientAccountId?.trim();
  const location = locationIdGhl?.trim();
  if (!client || !location) return { configured: false, allowed: false };
  const allowlist = getLiveCanaryAllowedDestinationPairs();
  if (!allowlist) {
    return { configured: false, allowed: true };
  }
  return {
    configured: true,
    allowed: allowlist.has(destinationPairKey(client, location)),
  };
}
