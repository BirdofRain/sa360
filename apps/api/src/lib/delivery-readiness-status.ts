export const DELIVERY_MODES = ["shadow", "ready_for_live", "live", "paused"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const INTERNAL_APPROVAL_STATUSES = [
  "not_reviewed",
  "ready_for_review",
  "approved",
  "blocked",
] as const;
export type InternalApprovalStatus = (typeof INTERNAL_APPROVAL_STATUSES)[number];

export const READINESS_STATUSES = [
  "not_ready",
  "needs_config",
  "ready_for_shadow",
  "ready_for_live",
  "live_enabled",
  "blocked",
] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export const GHL_CONNECTION_CONNECTED = "connected";
export const GHL_CONNECTION_DISCONNECTED = "disconnected";

export function isDeliveryMode(value: string): value is DeliveryMode {
  return (DELIVERY_MODES as readonly string[]).includes(value);
}

export function isInternalApprovalStatus(value: string): value is InternalApprovalStatus {
  return (INTERNAL_APPROVAL_STATUSES as readonly string[]).includes(value);
}

export function isReadinessStatus(value: string): value is ReadinessStatus {
  return (READINESS_STATUSES as readonly string[]).includes(value);
}
