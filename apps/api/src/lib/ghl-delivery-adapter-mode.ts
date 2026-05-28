/**
 * GHL delivery adapter execution mode (Phase 4H — no live writes).
 *
 * Env: GHL_DELIVERY_ADAPTER_MODE
 *   - disabled (default): simulation endpoint records disabled status only
 *   - simulate: build payloads and persist simulated step runs; no HTTP
 *   - readonly_probe: optional read-only GHL location check + simulation
 *   - live_blocked: explicit block if live delivery is requested
 *
 * Optional readonly probe (when mode=readonly_probe):
 *   GHL_PRIVATE_INTEGRATION_TOKEN or AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN
 *   GHL_API_BASE_URL (optional)
 * Never log token values.
 */

export const GHL_ADAPTER_MODES = [
  "disabled",
  "simulate",
  "readonly_probe",
  "live_blocked",
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

export const GHL_LIVE_NOT_IMPLEMENTED =
  "GHL live delivery is not implemented/enabled in Phase 4H.";
