export const LF2_EXECUTION_ENABLED_ENV = "SA360_LF2_EXECUTION_ENABLED";
export const LF2_GHL_CANARY_ENABLED_ENV = "SA360_LF2_GHL_CANARY_ENABLED";
export const LF2_GHL_ALLOWED_CLIENT_IDS_ENV = "SA360_LF2_GHL_ALLOWED_CLIENT_IDS";
export const LF2_GHL_ALLOWED_LOCATION_IDS_ENV = "SA360_LF2_GHL_ALLOWED_LOCATION_IDS";
export const LF2_GHL_ALLOWED_ORDER_IDS_ENV = "SA360_LF2_GHL_ALLOWED_ORDER_IDS";
export const LF2_GHL_ALLOWED_SOURCE_LANES_ENV = "SA360_LF2_GHL_ALLOWED_SOURCE_LANES";

function parseBooleanEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function parseCsvAllowlist(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const values = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.length === 0) return null;
  return values;
}

export function isLf2ExecutionEnabled(): boolean {
  return parseBooleanEnv(LF2_EXECUTION_ENABLED_ENV);
}

export function isLf2GhlCanaryEnabled(): boolean {
  return parseBooleanEnv(LF2_GHL_CANARY_ENABLED_ENV);
}

export function getLf2GhlAllowedClientIds(): string[] | null {
  return parseCsvAllowlist(process.env[LF2_GHL_ALLOWED_CLIENT_IDS_ENV]);
}

export function getLf2GhlAllowedLocationIds(): string[] | null {
  return parseCsvAllowlist(process.env[LF2_GHL_ALLOWED_LOCATION_IDS_ENV]);
}

export function getLf2GhlAllowedOrderIds(): string[] | null {
  return parseCsvAllowlist(process.env[LF2_GHL_ALLOWED_ORDER_IDS_ENV]);
}

export function getLf2GhlAllowedSourceLanes(): string[] | null {
  return parseCsvAllowlist(process.env[LF2_GHL_ALLOWED_SOURCE_LANES_ENV]);
}

export type Lf2GhlCanaryAllowlistInput = {
  clientAccountId: string;
  locationIdGhl: string;
  leadOrderId: string;
  sourceLane: string;
};

export function evaluateLf2GhlCanaryAllowlists(input: Lf2GhlCanaryAllowlistInput): {
  allowed: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];

  if (!isLf2ExecutionEnabled()) {
    blockers.push(`${LF2_EXECUTION_ENABLED_ENV} must be true for LF2 execution.`);
  }
  if (!isLf2GhlCanaryEnabled()) {
    blockers.push(`${LF2_GHL_CANARY_ENABLED_ENV} must be true for LF2 GHL canary.`);
  }

  const clientAllowlist = getLf2GhlAllowedClientIds();
  const locationAllowlist = getLf2GhlAllowedLocationIds();
  const orderAllowlist = getLf2GhlAllowedOrderIds();
  const sourceLaneAllowlist = getLf2GhlAllowedSourceLanes();

  if (!clientAllowlist) {
    blockers.push(`${LF2_GHL_ALLOWED_CLIENT_IDS_ENV} is missing or empty; LF2 GHL canary denied.`);
  } else if (!clientAllowlist.includes(input.clientAccountId.trim())) {
    blockers.push("Client account is not in the LF2 GHL client allowlist.");
  }

  if (!locationAllowlist) {
    blockers.push(`${LF2_GHL_ALLOWED_LOCATION_IDS_ENV} is missing or empty; LF2 GHL canary denied.`);
  } else if (!locationAllowlist.includes(input.locationIdGhl.trim())) {
    blockers.push("GHL location is not in the LF2 GHL location allowlist.");
  }

  if (!orderAllowlist) {
    blockers.push(`${LF2_GHL_ALLOWED_ORDER_IDS_ENV} is missing or empty; LF2 GHL canary denied.`);
  } else if (!orderAllowlist.includes(input.leadOrderId.trim())) {
    blockers.push("Lead order is not in the LF2 GHL order allowlist.");
  }

  if (!sourceLaneAllowlist) {
    blockers.push(`${LF2_GHL_ALLOWED_SOURCE_LANES_ENV} is missing or empty; LF2 GHL canary denied.`);
  } else if (!sourceLaneAllowlist.includes(input.sourceLane.trim())) {
    blockers.push("Source lane is not in the LF2 GHL source-lane allowlist.");
  }

  return { allowed: blockers.length === 0, blockers };
}
