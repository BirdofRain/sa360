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
 * In this patch, live GHL writes are never executed. This helper reports whether live writes
 * would be permitted by configuration (env max === live AND effective mode === live).
 * It is intentionally informational only; callers must still route through the simulation adapter.
 */
export function liveWritesPermitted(effectiveMode: ClientChannelWriteMode): boolean {
  return effectiveMode === "live" && getAdminConfigMaxWriteMode() === "live";
}
