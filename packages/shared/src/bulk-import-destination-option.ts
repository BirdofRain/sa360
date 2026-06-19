export type BulkImportDestinationOptionNormalized = {
  clientAccountId: string;
  clientDisplayName: string;
  locationIdGhl: string;
  locationName: string;
  oauthStatus: string;
  readinessStatus: string;
  readyForSimulation: boolean;
  readyForDirectCanary: boolean;
  blockers: string[];
  isInitialCanaryTarget: boolean;
  canRunLiveCanary: boolean;
  liveCanaryBlockers: string[];
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Runtime guard for API and Admin C.O.C. destination option payloads. */
export function normalizeBulkImportDestinationOption(
  input: unknown
): BulkImportDestinationOptionNormalized {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    clientAccountId: asString(raw.clientAccountId),
    clientDisplayName: asString(raw.clientDisplayName),
    locationIdGhl: asString(raw.locationIdGhl),
    locationName: asString(raw.locationName),
    oauthStatus: asString(raw.oauthStatus, "disconnected"),
    readinessStatus: asString(raw.readinessStatus, "not_ready"),
    readyForSimulation: asBool(raw.readyForSimulation),
    readyForDirectCanary: asBool(raw.readyForDirectCanary),
    blockers: asStringArray(raw.blockers),
    isInitialCanaryTarget: asBool(raw.isInitialCanaryTarget),
    canRunLiveCanary: asBool(raw.canRunLiveCanary),
    liveCanaryBlockers: asStringArray(raw.liveCanaryBlockers),
  };
}

export function normalizeBulkImportDestinationOptions(
  items: unknown
): BulkImportDestinationOptionNormalized[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeBulkImportDestinationOption);
}
