/**
 * GHL delivery adapter execution mode.
 *
 * Env: GHL_DELIVERY_ADAPTER_MODE
 *   - disabled (default): simulation endpoint records disabled status only
 *   - simulate: build payloads and persist simulated step runs; no HTTP
 *   - readonly_probe: optional read-only GHL location check + simulation
 *   - live_blocked: explicit block if live delivery is requested
 *   - live_canary: manual one-plan live GHL writes via guarded admin endpoint only (Phase 4I)
 *
 * Token env (names only — never log values):
 *   GHL_PRIVATE_INTEGRATION_TOKEN or AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN
 *   GHL_API_BASE_URL (optional)
 */

export const GHL_ADAPTER_MODES = [
  "disabled",
  "simulate",
  "readonly_probe",
  "live_blocked",
  "live_canary",
] as const;

export type GhlAdapterMode = (typeof GHL_ADAPTER_MODES)[number];

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

export function getGhlDeliveryAdapterMode(): GhlAdapterMode {
  const raw = process.env.GHL_DELIVERY_ADAPTER_MODE?.trim().toLowerCase();
  if (raw && (GHL_ADAPTER_MODES as readonly string[]).includes(raw)) {
    return raw as GhlAdapterMode;
  }
  return "disabled";
}

export function isGhlAdapterSimulationAllowed(): boolean {
  const mode = getGhlDeliveryAdapterMode();
  return mode === "simulate" || mode === "readonly_probe";
}

export function isGhlLiveCanaryMode(): boolean {
  return getGhlDeliveryAdapterMode() === "live_canary";
}

/** True only when env is live_canary — used by server-side live transport. */
export function isGhlLiveCanaryWriteAllowed(): boolean {
  return isGhlLiveCanaryMode();
}

export const GHL_LIVE_NOT_IMPLEMENTED =
  "GHL live delivery is not implemented/enabled in Phase 4H.";

export const LIVE_CANARY_CONFIRMATION_TEXT = "DELIVER ONE LEAD";

export const GHL_LIVE_CANARY_SAFETY_MESSAGE =
  "Live canary mode is not automatic delivery. Zapier/legacy delivery remains active unless manually paused outside SA360.";
