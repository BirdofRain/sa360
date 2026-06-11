export type DeliveryRuntimeMode = "simulate" | "live_canary";

export type DeliveryRuntimeModeStatus = {
  ok: boolean;
  effectiveMode: DeliveryRuntimeMode | string;
  configuredRuntimeMode: DeliveryRuntimeMode | string;
  maxAllowedMode: string;
  liveCanaryEnabledUntil: string | null;
  canRunLiveCanary: boolean;
  reason: string;
  enabledBy: string | null;
  enabledAt: string | null;
  lastChangedAt: string | null;
};

export const ENABLE_LIVE_CANARY_CONFIRMATION_TEXT = "ENABLE LIVE CANARY";
export const RETURN_TO_SIMULATE_CONFIRMATION_TEXT = "RETURN TO SIMULATE";
