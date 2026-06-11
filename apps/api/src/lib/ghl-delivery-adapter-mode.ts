/**
 * GHL delivery adapter execution mode.
 *
 * Env maximum capability (kill switch / ceiling):
 *   GHL_DELIVERY_ADAPTER_MAX_MODE = simulate | live_canary | disabled | readonly_probe
 *   SA360_GHL_LIVE_CANARY_ALLOWED = true | false
 *   Legacy: GHL_DELIVERY_ADAPTER_MODE (when new vars unset)
 *
 * Current effective mode is DB-backed via DeliveryRuntimeModeSetting (see delivery-runtime-mode.service).
 * Env no longer needs redeploy to switch simulate ↔ live_canary when max allows live_canary.
 */

export const GHL_ADAPTER_MODES = [
  "disabled",
  "simulate",
  "readonly_probe",
  "live_blocked",
  "live_canary",
] as const;

export type GhlAdapterMode = (typeof GHL_ADAPTER_MODES)[number];

export const GHL_ADAPTER_MAX_MODES = [
  "disabled",
  "simulate",
  "readonly_probe",
  "live_blocked",
  "live_canary",
] as const;

export type GhlAdapterMaxMode = (typeof GHL_ADAPTER_MAX_MODES)[number];

export const GHL_ADAPTER_RUN_STATUSES = [
  "disabled",
  "simulated",
  "blocked",
  "failed_validation",
  "readonly_probe_passed",
  "readonly_probe_failed",
] as const;

export type GhlAdapterRunStatus = (typeof GHL_ADAPTER_RUN_STATUSES)[number];

export const GHL_ADAPTER_STEP_STATUSES = [
  "simulated",
  "skipped",
  "blocked",
  "failed_validation",
  "readonly_checked",
] as const;

export type GhlAdapterStepStatus = (typeof GHL_ADAPTER_STEP_STATUSES)[number];

export const GHL_LIVE_DELIVERY_RUN_STATUSES = [
  "pending",
  "blocked",
  "executing",
  "succeeded",
  "partial_success",
  "failed",
  "skipped_duplicate",
  "rolled_back_manual",
] as const;

export type GhlLiveDeliveryRunStatus = (typeof GHL_LIVE_DELIVERY_RUN_STATUSES)[number];

export const GHL_LIVE_DELIVERY_STEP_STATUSES = [
  "pending",
  "skipped",
  "executing",
  "succeeded",
  "failed",
  "blocked",
] as const;

export type GhlLiveDeliveryStepStatus = (typeof GHL_LIVE_DELIVERY_STEP_STATUSES)[number];

function parseLegacyAdapterMode(): GhlAdapterMode | null {
  const raw = process.env.GHL_DELIVERY_ADAPTER_MODE?.trim().toLowerCase();
  if (raw && (GHL_ADAPTER_MODES as readonly string[]).includes(raw)) {
    return raw as GhlAdapterMode;
  }
  return null;
}

/** Environment maximum capability — not the current runtime mode. */
export function getGhlDeliveryAdapterMaxMode(): GhlAdapterMaxMode {
  const maxRaw = process.env.GHL_DELIVERY_ADAPTER_MAX_MODE?.trim().toLowerCase();
  if (maxRaw && (GHL_ADAPTER_MAX_MODES as readonly string[]).includes(maxRaw)) {
    return maxRaw as GhlAdapterMaxMode;
  }

  const allowedRaw = process.env.SA360_GHL_LIVE_CANARY_ALLOWED?.trim().toLowerCase();
  if (allowedRaw === "true" || allowedRaw === "1" || allowedRaw === "yes") {
    return "live_canary";
  }
  if (allowedRaw === "false" || allowedRaw === "0" || allowedRaw === "no") {
    return "simulate";
  }

  const legacy = parseLegacyAdapterMode();
  if (legacy) {
    if (legacy === "disabled" || legacy === "live_blocked") return legacy;
    if (legacy === "live_canary") return "live_canary";
    if (legacy === "readonly_probe") return "readonly_probe";
    return "simulate";
  }

  return "simulate";
}

export function isMaxModeLiveCanaryCapable(max: GhlAdapterMaxMode): boolean {
  return max === "live_canary";
}

export function isMaxModeSimulationCapable(max: GhlAdapterMaxMode): boolean {
  return max === "simulate" || max === "readonly_probe" || max === "live_canary";
}

let effectiveModeOverride: GhlAdapterMode | null = null;

/** Test-only sync override after resolveDeliveryRuntimeMode() warms cache. */
export function __setEffectiveAdapterModeForTests(mode: GhlAdapterMode | null): void {
  effectiveModeOverride = mode;
}

/**
 * Effective adapter mode (DB runtime + env max). Call resolveDeliveryRuntimeMode() first in async paths.
 * Without cache, falls back to simulate when max allows simulation.
 */
export function getGhlDeliveryAdapterMode(): GhlAdapterMode {
  if (effectiveModeOverride) return effectiveModeOverride;

  const max = getGhlDeliveryAdapterMaxMode();
  if (max === "disabled") return "disabled";
  if (max === "live_blocked") return "live_blocked";
  if (max === "readonly_probe") return "readonly_probe";
  return "simulate";
}

export function setEffectiveAdapterModeFromResolved(mode: GhlAdapterMode): void {
  effectiveModeOverride = mode;
}

export function clearEffectiveAdapterModeOverride(): void {
  effectiveModeOverride = null;
}

export function isGhlAdapterSimulationAllowed(): boolean {
  const mode = getGhlDeliveryAdapterMode();
  return mode === "simulate" || mode === "readonly_probe" || mode === "live_canary";
}

/** Mode stored on shadow adapter runs (never performs GHL writes). */
export function adapterSimulationRecordMode(envMode: GhlAdapterMode): GhlAdapterMode {
  return envMode === "live_canary" ? "simulate" : envMode;
}

export function isGhlLiveCanaryMode(): boolean {
  return getGhlDeliveryAdapterMode() === "live_canary";
}

/** True only when effective runtime mode is live_canary — used by server-side live transport. */
export function isGhlLiveCanaryWriteAllowed(): boolean {
  return isGhlLiveCanaryMode();
}

export const GHL_LIVE_NOT_IMPLEMENTED =
  "GHL live delivery is not implemented/enabled in Phase 4H.";

export const LIVE_CANARY_CONFIRMATION_TEXT = "DELIVER ONE LEAD";

export const GHL_LIVE_CANARY_SAFETY_MESSAGE =
  "Live canary mode is not automatic delivery. Zapier/legacy delivery remains active unless manually paused outside SA360.";
