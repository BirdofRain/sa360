/**
 * Validity policy for stored GoHighLevel configuration snapshots.
 *
 * A complete discovery is the only authoritative usable snapshot. Failed,
 * partial, authentication, outage, timeout, and malformed results stay in the
 * table as audit rows and are not current verification. A legacy row with no
 * outcome marker and no error or warning strings remains usable, including a
 * successful response whose workflow list is empty. A legacy row that recorded
 * a resource failure in errors or warnings is not usable.
 */

export const GHL_SNAPSHOT_LIST_KEYS = [
  "pipelines",
  "workflows",
  "users",
  "customFields",
  "tags",
  "data",
  "items",
  "results",
] as const;

export type GhlSnapshotOutcome =
  | "complete"
  | "authentication"
  | "timeout"
  | "provider_outage"
  | "network"
  | "malformed"
  | "partial_failure";

export type GhlDiscoveryFailureCode =
  | "RECONNECT_REQUIRED"
  | "TIMEOUT"
  | "PROVIDER_OUTAGE"
  | "MALFORMED_RESPONSE"
  | "PARTIAL_FAILURE"
  | "NO_USABLE_SNAPSHOT";

export type GhlSnapshotVerification = "live" | "cached" | "previously_captured";

export type GhlSnapshotOutcomeMarker = {
  discoveryOutcome: GhlSnapshotOutcome;
  usable: boolean;
};

const AUTH_TEXT = /invalid jwt|unauthorized|jwt expired|token expired|invalid token/i;

export function redactGhlDiscoveryText(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9\-._~+/]+=*|access_token|refresh_token|client_secret|authorization/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function readGhlSnapshotOutcome(value: unknown): GhlSnapshotOutcomeMarker | null {
  const candidates = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  for (const item of candidates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.discoveryOutcome !== "string" || typeof record.usable !== "boolean") continue;
    if (!isOutcome(record.discoveryOutcome)) continue;
    return { discoveryOutcome: record.discoveryOutcome, usable: record.usable };
  }
  return null;
}

export function ghlSnapshotMessageStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function isUsableGhlLocationConfigSnapshot(row: {
  errorsJson?: unknown;
  warningsJson?: unknown;
}): boolean {
  const marker = readGhlSnapshotOutcome(row.errorsJson) ?? readGhlSnapshotOutcome(row.warningsJson);
  if (marker) return marker.usable === true && marker.discoveryOutcome === "complete";
  return ghlSnapshotMessageStrings(row.errorsJson).length === 0 && ghlSnapshotMessageStrings(row.warningsJson).length === 0;
}

export function ghlSnapshotOutcomeMarker(outcome: GhlSnapshotOutcome): GhlSnapshotOutcomeMarker {
  return { discoveryOutcome: outcome, usable: outcome === "complete" };
}

export function failureCodeForSnapshotOutcome(outcome: Exclude<GhlSnapshotOutcome, "complete">): GhlDiscoveryFailureCode {
  switch (outcome) {
    case "authentication":
      return "RECONNECT_REQUIRED";
    case "timeout":
      return "TIMEOUT";
    case "provider_outage":
    case "network":
      return "PROVIDER_OUTAGE";
    case "malformed":
      return "MALFORMED_RESPONSE";
    default:
      return "PARTIAL_FAILURE";
  }
}

export function dominantSnapshotOutcome(
  failures: Array<"authentication" | "timeout" | "provider_outage" | "network" | "malformed" | "http_error" | "no_auth">,
  resourceCount: number
): Exclude<GhlSnapshotOutcome, "complete"> {
  if (failures.includes("authentication") || failures.includes("no_auth")) return "authentication";
  if (failures.length < resourceCount) return "partial_failure";
  if (failures.every((failure) => failure === "timeout")) return "timeout";
  if (failures.every((failure) => failure === "malformed")) return "malformed";
  if (failures.every((failure) => failure === "provider_outage" || failure === "network")) return "provider_outage";
  return "partial_failure";
}

export function discoveryFailureSummary(input: {
  outcome: Exclude<GhlSnapshotOutcome, "complete">;
  providerDetail: string | null;
}): string {
  switch (input.outcome) {
    case "authentication": {
      const jwt = input.providerDetail && /invalid jwt/i.test(input.providerDetail) ? " (Invalid JWT)" : "";
      return `GoHighLevel rejected this location's credentials${jwt}. Reconnect the location and refresh again.`;
    }
    case "timeout":
      return "GoHighLevel did not respond before the discovery request timed out.";
    case "provider_outage":
    case "network":
      return "GoHighLevel could not be reached for this discovery refresh.";
    case "malformed":
      return "GoHighLevel returned a discovery response that could not be read.";
    default:
      return "GoHighLevel discovery did not finish for every required resource, so this refresh was not saved as the usable snapshot.";
  }
}

export function discoveryFailureDetail(preserved: boolean): string {
  return preserved
    ? " The last usable snapshot was kept and is not current verification."
    : " No usable snapshot was stored.";
}

export function previouslyCapturedSnapshotMessage(failureSummary: string): string {
  return `This snapshot was previously captured for this location. It is not current GoHighLevel verification. The latest refresh failed: ${failureSummary}`;
}

export function resourceFailureLine(
  resource: string,
  failureClass: "authentication" | "timeout" | "provider_outage" | "network" | "malformed" | "http_error" | "no_auth",
  providerDetail: string | null
): string {
  switch (failureClass) {
    case "authentication":
      return `${resource}: GoHighLevel rejected the credentials${providerDetail && /invalid jwt/i.test(providerDetail) ? " (Invalid JWT)" : ""}.`;
    case "timeout":
      return `${resource}: the request timed out.`;
    case "provider_outage":
    case "network":
      return `${resource}: GoHighLevel could not be reached.`;
    case "malformed":
      return `${resource}: the response could not be read.`;
    case "no_auth":
      return `${resource}: GoHighLevel credentials for this location could not be used.`;
    default:
      return `${resource}: the request failed.`;
  }
}

export function providerSignalsAuthentication(value: string | null | undefined): boolean {
  return Boolean(value && AUTH_TEXT.test(value));
}

/**
 * The array a list parser will read, or null when the body is not an explicit
 * collection. An empty array is a successful empty result. An error object
 * with no collection is not an empty result.
 */
export function explicitDiscoveryCollection(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  for (const key of GHL_SNAPSHOT_LIST_KEYS) {
    if (!(key in record)) continue;
    return Array.isArray(record[key]) ? (record[key] as unknown[]) : null;
  }
  return null;
}

export function isWellFormedDiscoveredLocation(json: unknown, locationId: string): boolean {
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  const wrapped = (json as Record<string, unknown>).location ?? json;
  if (!wrapped || typeof wrapped !== "object" || Array.isArray(wrapped)) return false;
  const record = wrapped as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const message = record.message ?? record.error ?? record.msg;
  if (typeof message === "string" && message.trim() && !id && !name) return false;
  if (id && id !== locationId) return false;
  return true;
}

function isOutcome(value: string): value is GhlSnapshotOutcome {
  return (
    value === "complete" ||
    value === "authentication" ||
    value === "timeout" ||
    value === "provider_outage" ||
    value === "network" ||
    value === "malformed" ||
    value === "partial_failure"
  );
}
