/**
 * Feature flag + write-mode env for the client channel profile settings layer.
 *
 * Safety: this layer never performs live GHL writes in this patch. `GHL_ADMIN_CONFIG_WRITE_MODE`
 * sets the MAXIMUM capability; the effective/saved write mode is always clamped to this value and
 * defaults to `simulate`.
 */

export const CLIENT_CHANNEL_WRITE_MODES = ["simulate", "shadow", "live"] as const;
export type ClientChannelWriteMode = (typeof CLIENT_CHANNEL_WRITE_MODES)[number];

export const DEFAULT_CLIENT_CHANNEL_WRITE_MODE: ClientChannelWriteMode = "simulate";

/** Whether the admin client profile settings surface is enabled. Default: enabled. */
export function isClientProfileSettingsEnabled(): boolean {
  const raw = process.env.SA360_CLIENT_PROFILE_SETTINGS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/**
 * Maximum write mode allowed by the environment. Defaults to `simulate` (safe).
 * Unknown / unset values fall back to `simulate`.
 */
export function getAdminConfigMaxWriteMode(): ClientChannelWriteMode {
  const raw = process.env.GHL_ADMIN_CONFIG_WRITE_MODE?.trim().toLowerCase();
  if (raw && (CLIENT_CHANNEL_WRITE_MODES as readonly string[]).includes(raw)) {
    return raw as ClientChannelWriteMode;
  }
  return DEFAULT_CLIENT_CHANNEL_WRITE_MODE;
}

const WRITE_MODE_RANK: Record<ClientChannelWriteMode, number> = {
  simulate: 0,
  shadow: 1,
  live: 2,
};

/** Clamp a requested write mode to the environment maximum. */
export function clampWriteModeToMax(
  requested: ClientChannelWriteMode,
  max: ClientChannelWriteMode = getAdminConfigMaxWriteMode()
): { effective: ClientChannelWriteMode; clamped: boolean } {
  if (WRITE_MODE_RANK[requested] > WRITE_MODE_RANK[max]) {
    return { effective: max, clamped: true };
  }
  return { effective: requested, clamped: false };
}

/**
 * In this patch, live GHL writes are never executed for the profile config itself. This helper
 * reports whether live writes would be permitted by configuration (env max === live AND effective
 * mode === live). Informational only; callers must still route through the simulation adapter.
 */
export function liveWritesPermitted(effectiveMode: ClientChannelWriteMode): boolean {
  return effectiveMode === "live" && getAdminConfigMaxWriteMode() === "live";
}

// ─── GHL custom-value mirror: live-write allowlist guardrails ──────────────

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Allowlisted client account IDs permitted for LIVE GHL config writes (empty = none). */
export function getGhlConfigWriteAllowlistClients(): string[] {
  return parseCsvEnv(process.env.SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS);
}

/** Allowlisted GHL location IDs permitted for LIVE GHL config writes (empty = none). */
export function getGhlConfigWriteAllowlistLocations(): string[] {
  return parseCsvEnv(process.env.SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS);
}

export type MirrorLiveGuardrailChecks = {
  featureEnabled: boolean;
  maxModeIsLive: boolean;
  effectiveModeIsLive: boolean;
  hasClientAllowlist: boolean;
  hasLocationAllowlist: boolean;
  clientAllowlisted: boolean;
  locationPresent: boolean;
  locationAllowlisted: boolean;
};

export type MirrorLiveGuardrailResult = {
  /** True only when every guardrail passes — live writes may proceed. */
  liveAllowed: boolean;
  checks: MirrorLiveGuardrailChecks;
  blockers: string[];
};

/**
 * Evaluate whether a LIVE GHL custom-value write is permitted for a given client/location.
 * Live is blocked unless: feature enabled, env max === live, effective mode === live, BOTH allowlist
 * envs are set, and the client + location are explicitly allowlisted. Missing allowlists block live.
 */
export function evaluateMirrorLiveGuardrails(input: {
  clientAccountId: string;
  locationId: string | null | undefined;
  effectiveMode: ClientChannelWriteMode;
}): MirrorLiveGuardrailResult {
  const clientAllowlist = getGhlConfigWriteAllowlistClients();
  const locationAllowlist = getGhlConfigWriteAllowlistLocations();
  const clientId = input.clientAccountId.trim();
  const locationId = input.locationId?.trim() || "";

  const checks: MirrorLiveGuardrailChecks = {
    featureEnabled: isClientProfileSettingsEnabled(),
    maxModeIsLive: getAdminConfigMaxWriteMode() === "live",
    effectiveModeIsLive: input.effectiveMode === "live",
    hasClientAllowlist: clientAllowlist.length > 0,
    hasLocationAllowlist: locationAllowlist.length > 0,
    clientAllowlisted: clientId.length > 0 && clientAllowlist.includes(clientId),
    locationPresent: locationId.length > 0,
    locationAllowlisted: locationId.length > 0 && locationAllowlist.includes(locationId),
  };

  const blockers: string[] = [];
  if (!checks.featureEnabled) blockers.push("Client profile settings feature flag is disabled.");
  if (!checks.maxModeIsLive) {
    blockers.push("GHL_ADMIN_CONFIG_WRITE_MODE is not 'live' (environment maximum).");
  }
  if (!checks.effectiveModeIsLive) blockers.push("Effective write mode is not 'live'.");
  if (!checks.hasClientAllowlist) {
    blockers.push("SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS is not set; live writes blocked.");
  }
  if (!checks.hasLocationAllowlist) {
    blockers.push("SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS is not set; live writes blocked.");
  }
  if (checks.hasClientAllowlist && !checks.clientAllowlisted) {
    blockers.push("This client is not in the live-write client allowlist.");
  }
  if (!checks.locationPresent) blockers.push("No target GHL location resolved.");
  if (checks.hasLocationAllowlist && checks.locationPresent && !checks.locationAllowlisted) {
    blockers.push("This GHL location is not in the live-write location allowlist.");
  }

  return { liveAllowed: blockers.length === 0, checks, blockers };
}
