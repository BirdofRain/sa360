import type { DeliveryReadinessRuleInput } from "../services/delivery-readiness.service.js";

/**
 * Optional one-plan pin. When set, only that delivery plan may pass live
 * canary preflight, and the four destination arming flags are satisfied in
 * memory for that plan only. The destination row is not updated.
 * Other live paths must refuse while the pin is set.
 */
export const GHL_SINGLE_PLAN_CANARY_ID_ENV = "SA360_GHL_SINGLE_PLAN_CANARY_ID";

export const GHL_SINGLE_PLAN_CANARY_MISMATCH =
  "SA360_GHL_SINGLE_PLAN_CANARY_ID does not match this delivery plan. No GHL request was sent.";

export const GHL_SINGLE_PLAN_CANARY_OTHER_PATH =
  "Live delivery on this path is closed while SA360_GHL_SINGLE_PLAN_CANARY_ID is set. Use the pinned delivery-plan canary only.";

export function getGhlSinglePlanCanaryId(): string | null {
  const value = process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV]?.trim();
  return value ? value : null;
}

export function ghlSinglePlanCanaryDecision(planId: string | null | undefined):
  | { pinned: false }
  | { pinned: true; allowed: boolean } {
  const pin = getGhlSinglePlanCanaryId();
  if (!pin) return { pinned: false };
  return { pinned: true, allowed: Boolean(planId?.trim() && planId.trim() === pin) };
}

/**
 * In-memory exception for the pinned plan. Does not copy snapshot, field-map,
 * or connection flags, and does not write the destination.
 */
export function applySinglePlanCanaryArmingException(
  input: DeliveryReadinessRuleInput
): DeliveryReadinessRuleInput {
  return {
    ...input,
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
  };
}
