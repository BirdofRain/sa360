import { hasGhlDeliveryConfigMissing } from "@/lib/ghl-config/ghl-config-discovery-display";
import { DELIVERY_PLAN_BLOCKED_MESSAGE } from "./routing-dry-run-safe";
import type { RoutingDryRunDecisionItem } from "./types";

export type DeliveryPlanEligibility = {
  allowed: boolean;
  message: string | null;
};

const BLOCKED_VALIDATION = new Set(["legacy_unknown", "unreviewed"]);

export function getDeliveryPlanEligibility(
  row: Pick<
    RoutingDryRunDecisionItem,
    "matched" | "matchedRuleId" | "validationStatus" | "deliveryReadiness"
  >
): DeliveryPlanEligibility {
  if (!row.matched || !row.matchedRuleId) {
    return { allowed: false, message: DELIVERY_PLAN_BLOCKED_MESSAGE };
  }

  const status = row.validationStatus?.trim() || "unreviewed";
  if (BLOCKED_VALIDATION.has(status)) {
    return { allowed: false, message: DELIVERY_PLAN_BLOCKED_MESSAGE };
  }

  const readiness = row.deliveryReadiness;
  if (readiness && hasGhlDeliveryConfigMissing(readiness.missingConfig)) {
    return { allowed: false, message: DELIVERY_PLAN_BLOCKED_MESSAGE };
  }

  return { allowed: true, message: null };
}
