/**
 * Allowed admin runtime setting keys, their valid values, safe defaults, and
 * environment-variable fallbacks.
 *
 * SAFETY INVARIANTS
 * - This registry only describes operational *mode switches*. It must never be
 *   used to store secrets/credentials — secrets stay in environment variables.
 * - Safe defaults are the most conservative (non-live) option for every key so
 *   that a missing DB row + missing env var can never escalate behavior.
 * - Env fallbacks read `process.env` on demand (after dotenv has loaded) and map
 *   legacy env values into the allowed value set, preserving existing behavior.
 */

export type AdminRuntimeSettingEnvironmentName = "STAGING" | "PRODUCTION";

/** A "live" value escalates behavior and requires extra confirmation in PRODUCTION. */
export type RuntimeSettingKeyDefinition = {
  readonly key: string;
  readonly allowedValues: readonly string[];
  readonly safeDefault: string;
  /** Values considered "live" (real external side effects). */
  readonly liveValues: readonly string[];
  readonly isSensitive: boolean;
  readonly description: string;
  /** Resolve a value from environment variables, or null when none/invalid. */
  readonly envFallback: () => string | null;
};

function pickEnvValue(
  envVar: string,
  allowed: readonly string[],
  aliases: Record<string, string> = {}
): string | null {
  const raw = process.env[envVar]?.trim().toLowerCase();
  if (!raw) return null;
  const mapped = aliases[raw] ?? raw;
  return allowed.includes(mapped) ? mapped : null;
}

export const GHL_DELIVERY_MODE_VALUES = [
  "simulate",
  "shadow",
  "live_canary",
  "live",
] as const;

export const META_DISPATCH_MODE_VALUES = ["disabled", "simulate", "live"] as const;

export const ROUTING_MODE_VALUES = ["dry_run", "shadow", "live"] as const;

export const BACKUP_SHEET_EXPORT_MODE_VALUES = ["disabled", "enabled"] as const;

export const RUNTIME_SETTING_DEFINITIONS = {
  "ghl.delivery_mode": {
    key: "ghl.delivery_mode",
    allowedValues: GHL_DELIVERY_MODE_VALUES,
    safeDefault: "simulate",
    liveValues: ["live_canary", "live"],
    isSensitive: false,
    description:
      "GHL lead delivery execution mode. simulate=no writes, shadow=record-only, live_canary=single-lead live, live=full live delivery.",
    envFallback: () =>
      // Preserve legacy env behavior: GHL_DELIVERY_ADAPTER_MODE drives delivery today.
      // Only map values that exist in the delivery_mode value set; anything else
      // (disabled/readonly_probe/live_blocked) is treated as the safe default.
      pickEnvValue("GHL_DELIVERY_ADAPTER_MODE", GHL_DELIVERY_MODE_VALUES),
  },
  "meta.dispatch_mode": {
    key: "meta.dispatch_mode",
    allowedValues: META_DISPATCH_MODE_VALUES,
    safeDefault: "disabled",
    liveValues: ["live"],
    isSensitive: false,
    description:
      "Meta CAPI dispatch mode. disabled=no dispatch, simulate=build-only, live=real Meta dispatch.",
    envFallback: () => {
      // Prefer explicit META_DISPATCH_MODE when present.
      const explicit = pickEnvValue("META_DISPATCH_MODE", META_DISPATCH_MODE_VALUES);
      if (explicit) return explicit;
      // Otherwise honor the legacy META_SYNC_ENABLED gate without enabling live by default.
      const sync = process.env.META_SYNC_ENABLED?.trim().toLowerCase();
      if (sync === undefined || sync === "") return null;
      if (["false", "0", "no", "n", "off"].includes(sync)) return "disabled";
      // META_SYNC_ENABLED truthy historically only enqueues — map to simulate, never live.
      return "simulate";
    },
  },
  "routing.mode": {
    key: "routing.mode",
    allowedValues: ROUTING_MODE_VALUES,
    safeDefault: "dry_run",
    liveValues: ["live"],
    isSensitive: false,
    description:
      "Routing execution mode. dry_run=decisions only, shadow=record-only, live=apply routing.",
    envFallback: () =>
      pickEnvValue("ROUTING_MODE", ROUTING_MODE_VALUES, { dryrun: "dry_run" }),
  },
  "backup_sheet_export.mode": {
    key: "backup_sheet_export.mode",
    allowedValues: BACKUP_SHEET_EXPORT_MODE_VALUES,
    safeDefault: "disabled",
    liveValues: [],
    isSensitive: false,
    description:
      "Backup sheet export mode. disabled=no export, enabled=export to backup sheet.",
    envFallback: () =>
      pickEnvValue("BACKUP_SHEET_EXPORT_MODE", BACKUP_SHEET_EXPORT_MODE_VALUES, {
        true: "enabled",
        "1": "enabled",
        on: "enabled",
        false: "disabled",
        "0": "disabled",
        off: "disabled",
      }),
  },
} as const satisfies Record<string, RuntimeSettingKeyDefinition>;

export type RuntimeSettingKey = keyof typeof RUNTIME_SETTING_DEFINITIONS;

export const RUNTIME_SETTING_KEYS = Object.keys(
  RUNTIME_SETTING_DEFINITIONS
) as RuntimeSettingKey[];

export function isAllowedRuntimeSettingKey(key: string): key is RuntimeSettingKey {
  return Object.prototype.hasOwnProperty.call(RUNTIME_SETTING_DEFINITIONS, key);
}

export function getRuntimeSettingDefinition(
  key: string
): RuntimeSettingKeyDefinition | null {
  return isAllowedRuntimeSettingKey(key) ? RUNTIME_SETTING_DEFINITIONS[key] : null;
}

export type RuntimeSettingValueValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate a raw value for a key. Only known keys with known string values pass.
 * Rejects unknown keys, non-string values, and values outside the allowed set.
 */
export function validateRuntimeSettingValue(
  key: string,
  value: unknown
): RuntimeSettingValueValidation {
  const def = getRuntimeSettingDefinition(key);
  if (!def) {
    return { ok: false, error: `Unknown runtime setting key: ${key}` };
  }
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `Value for ${key} must be a string (one of: ${def.allowedValues.join(", ")}).`,
    };
  }
  const normalized = value.trim();
  if (!def.allowedValues.includes(normalized)) {
    return {
      ok: false,
      error: `Invalid value "${value}" for ${key}. Allowed: ${def.allowedValues.join(", ")}.`,
    };
  }
  return { ok: true, value: normalized };
}

export function isLiveRuntimeSettingValue(key: string, value: string): boolean {
  const def = getRuntimeSettingDefinition(key);
  if (!def) return false;
  return def.liveValues.includes(value);
}

export function getSafeDefaultForKey(key: RuntimeSettingKey): string {
  return RUNTIME_SETTING_DEFINITIONS[key].safeDefault;
}

export function getEnvFallbackForKey(key: RuntimeSettingKey): string | null {
  return RUNTIME_SETTING_DEFINITIONS[key].envFallback();
}

/** Current environment derived from env, defaulting to the safer STAGING. */
export function currentRuntimeEnvironment(): AdminRuntimeSettingEnvironmentName {
  const raw = (process.env.SA360_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return raw === "production" || raw === "prod" ? "PRODUCTION" : "STAGING";
}
