import type {
  AdminRuntimeSetting,
  AdminRuntimeSettingScope,
} from "@prisma/client";
import { logger } from "../lib/logger.js";
import {
  currentRuntimeEnvironment,
  getEnvFallbackForKey,
  getRuntimeSettingDefinition,
  getSafeDefaultForKey,
  isAllowedRuntimeSettingKey,
  isLiveRuntimeSettingValue,
  validateRuntimeSettingValue,
  type AdminRuntimeSettingEnvironmentName,
  type RuntimeSettingKey,
} from "../lib/admin-runtime-settings-keys.js";
import {
  findRuntimeSettingExact,
  upsertRuntimeSetting,
  type RuntimeSettingLocator,
} from "../repositories/admin-runtime-setting.repository.js";

/** Confirmation text required to set a PRODUCTION live mode through the service. */
export const PRODUCTION_LIVE_CONFIRMATION_TEXT = "ENABLE PRODUCTION LIVE";

/** Value returned in place of a sensitive setting's raw value on admin reads. */
export const REDACTED_VALUE = "__redacted__";

export type RuntimeSettingContext = {
  environment?: AdminRuntimeSettingEnvironmentName;
  clientAccountId?: string | null;
  subaccountIdGhl?: string | null;
};

export type RuntimeSettingSource =
  | "subaccount"
  | "client"
  | "global"
  | "env"
  | "default";

export type ResolvedRuntimeSetting = {
  key: RuntimeSettingKey;
  value: string;
  source: RuntimeSettingSource;
  environment: AdminRuntimeSettingEnvironmentName;
  isSensitive: boolean;
};

function normalize(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function resolveEnvironment(
  context: RuntimeSettingContext
): AdminRuntimeSettingEnvironmentName {
  return context.environment ?? currentRuntimeEnvironment();
}

/** Build the ordered list of DB locators to try, most specific first. */
function locatorChain(
  key: RuntimeSettingKey,
  context: RuntimeSettingContext,
  environment: AdminRuntimeSettingEnvironmentName
): Array<{ source: RuntimeSettingSource; locator: RuntimeSettingLocator }> {
  const clientAccountId = normalize(context.clientAccountId);
  const subaccountIdGhl = normalize(context.subaccountIdGhl);
  const chain: Array<{ source: RuntimeSettingSource; locator: RuntimeSettingLocator }> =
    [];

  if (subaccountIdGhl) {
    chain.push({
      source: "subaccount",
      locator: {
        key,
        scope: "SUBACCOUNT",
        environment,
        clientAccountId,
        subaccountIdGhl,
      },
    });
  }
  if (clientAccountId) {
    chain.push({
      source: "client",
      locator: {
        key,
        scope: "CLIENT",
        environment,
        clientAccountId,
        subaccountIdGhl: null,
      },
    });
  }
  chain.push({
    source: "global",
    locator: {
      key,
      scope: "GLOBAL",
      environment,
      clientAccountId: null,
      subaccountIdGhl: null,
    },
  });
  return chain;
}

/** Extract a valid allowed string value from a stored JSON value, or null. */
function storedValueToValidString(key: RuntimeSettingKey, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const validation = validateRuntimeSettingValue(key, raw);
  return validation.ok ? validation.value : null;
}

/**
 * Read the persisted setting row at the most specific matching scope for the
 * given context. DB-only: returns null when no row exists (no env/default fallback).
 */
export async function getRuntimeSetting(
  key: string,
  context: RuntimeSettingContext = {}
): Promise<AdminRuntimeSetting | null> {
  if (!isAllowedRuntimeSettingKey(key)) {
    throw new Error(`Unknown runtime setting key: ${key}`);
  }
  const environment = resolveEnvironment(context);
  for (const { locator } of locatorChain(key, context, environment)) {
    const row = await findRuntimeSettingExact(locator);
    if (row) return row;
  }
  return null;
}

/**
 * Resolve the effective value for a key, walking SUBACCOUNT → CLIENT → GLOBAL,
 * then env fallback, then the safe default. Always returns a usable value.
 */
export async function resolveRuntimeSetting(
  key: string,
  context: RuntimeSettingContext = {}
): Promise<ResolvedRuntimeSetting> {
  if (!isAllowedRuntimeSettingKey(key)) {
    throw new Error(`Unknown runtime setting key: ${key}`);
  }
  const def = getRuntimeSettingDefinition(key)!;
  const environment = resolveEnvironment(context);

  for (const { source, locator } of locatorChain(key, context, environment)) {
    const row = await findRuntimeSettingExact(locator);
    if (!row) continue;
    const value = storedValueToValidString(key, row.value);
    if (value === null) {
      logger.warn("admin runtime setting has invalid stored value; skipping", {
        key,
        scope: locator.scope,
        environment,
      });
      continue;
    }
    return {
      key,
      value,
      source,
      environment,
      isSensitive: row.isSensitive,
    };
  }

  const envValue = getEnvFallbackForKey(key);
  if (envValue !== null) {
    return { key, value: envValue, source: "env", environment, isSensitive: def.isSensitive };
  }

  return {
    key,
    value: getSafeDefaultForKey(key),
    source: "default",
    environment,
    isSensitive: def.isSensitive,
  };
}

export type SetRuntimeSettingOptions = {
  /** Required (and must match PRODUCTION_LIVE_CONFIRMATION_TEXT) for PRODUCTION live values. */
  confirmationText?: string;
  isSensitive?: boolean;
  isEditable?: boolean;
  description?: string | null;
};

export type SetRuntimeSettingResult =
  | { ok: true; setting: AdminRuntimeSetting; resolved: ResolvedRuntimeSetting }
  | {
      ok: false;
      error: string;
      code: "UNKNOWN_KEY" | "INVALID_VALUE" | "CONFIRMATION" | "NOT_EDITABLE";
    };

function scopeFromContext(context: RuntimeSettingContext): {
  scope: AdminRuntimeSettingScope;
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
} {
  const clientAccountId = normalize(context.clientAccountId);
  const subaccountIdGhl = normalize(context.subaccountIdGhl);
  if (subaccountIdGhl) {
    return { scope: "SUBACCOUNT", clientAccountId, subaccountIdGhl };
  }
  if (clientAccountId) {
    return { scope: "CLIENT", clientAccountId, subaccountIdGhl: null };
  }
  return { scope: "GLOBAL", clientAccountId: null, subaccountIdGhl: null };
}

/**
 * Persist a runtime setting value for a scope derived from context.
 * Guardrails: rejects unknown keys, invalid values, non-editable settings, and
 * PRODUCTION live values without the explicit confirmation string. Never stores
 * secrets — only allowed mode-switch keys/values pass validation.
 */
export async function setRuntimeSetting(
  key: string,
  value: unknown,
  context: RuntimeSettingContext = {},
  reason?: string | null,
  updatedBy?: string | null,
  options: SetRuntimeSettingOptions = {}
): Promise<SetRuntimeSettingResult> {
  if (!isAllowedRuntimeSettingKey(key)) {
    return { ok: false, error: `Unknown runtime setting key: ${key}`, code: "UNKNOWN_KEY" };
  }

  const validation = validateRuntimeSettingValue(key, value);
  if (!validation.ok) {
    return { ok: false, error: validation.error, code: "INVALID_VALUE" };
  }
  const newValue = validation.value;

  const environment = resolveEnvironment(context);
  const { scope, clientAccountId, subaccountIdGhl } = scopeFromContext(context);
  const locator: RuntimeSettingLocator = {
    key,
    scope,
    environment,
    clientAccountId,
    subaccountIdGhl,
  };

  const existing = await findRuntimeSettingExact(locator);
  if (existing && existing.isEditable === false) {
    return {
      ok: false,
      error: `Setting ${key} (${scope}/${environment}) is locked (isEditable=false).`,
      code: "NOT_EDITABLE",
    };
  }

  // PRODUCTION live escalation requires explicit operator confirmation.
  if (
    environment === "PRODUCTION" &&
    isLiveRuntimeSettingValue(key, newValue) &&
    normalize(options.confirmationText) !== PRODUCTION_LIVE_CONFIRMATION_TEXT
  ) {
    return {
      ok: false,
      error: `Setting ${key}=${newValue} in PRODUCTION requires confirmationText "${PRODUCTION_LIVE_CONFIRMATION_TEXT}".`,
      code: "CONFIRMATION",
    };
  }

  const oldValue =
    existing && typeof existing.value === "string" ? existing.value : null;

  const setting = await upsertRuntimeSetting({
    ...locator,
    value: newValue,
    reason: normalize(reason),
    updatedBy: normalize(updatedBy),
    isSensitive: options.isSensitive,
    isEditable: options.isEditable,
    description: options.description,
  });

  // Audit trail (key, old/new value, updatedBy, reason). No secrets are ever logged
  // because only non-secret mode-switch values pass validation.
  logger.info("admin runtime setting changed", {
    event: "admin_runtime_setting_changed",
    key,
    scope,
    environment,
    clientAccountId,
    subaccountIdGhl,
    oldValue,
    newValue,
    updatedBy: normalize(updatedBy),
    reason: normalize(reason),
  });

  const resolved = await resolveRuntimeSetting(key, context);
  return { ok: true, setting, resolved };
}

export type AdminRuntimeSettingView = {
  id: string;
  key: string;
  scope: AdminRuntimeSettingScope;
  environment: AdminRuntimeSetting["environment"];
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
  value: string;
  isSensitive: boolean;
  isEditable: boolean;
  description: string | null;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

/**
 * Admin read view. Sensitive settings never expose their raw value — they are
 * redacted. (All built-in keys are non-sensitive; this protects any row an
 * operator flags as sensitive.)
 */
export function presentRuntimeSettingForAdmin(
  setting: AdminRuntimeSetting
): AdminRuntimeSettingView {
  const rawValue = typeof setting.value === "string" ? setting.value : "";
  return {
    id: setting.id,
    key: setting.key,
    scope: setting.scope,
    environment: setting.environment,
    clientAccountId: setting.clientAccountId,
    subaccountIdGhl: setting.subaccountIdGhl,
    value: setting.isSensitive ? REDACTED_VALUE : rawValue,
    isSensitive: setting.isSensitive,
    isEditable: setting.isEditable,
    description: setting.description,
    reason: setting.reason,
    updatedBy: setting.updatedBy,
    updatedAt: setting.updatedAt.toISOString(),
  };
}
