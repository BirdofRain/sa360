import type { RoutingRuleDeliveryConfigPatch } from "../schemas/delivery-readiness.schema.js";
import {
  findCampaignRoutingRuleById,
  updateCampaignRoutingRuleDeliveryConfig,
} from "../repositories/campaign-routing-rule.repository.js";
import { evaluateDeliveryReadiness } from "./delivery-readiness.service.js";
import {
  deliveryConfigUpdateFromPatch,
  mergeRuleForAssessment,
  persistedReadinessAfterAssessment,
  presentRoutingRuleWithReadiness,
  type RoutingRuleWithReadinessItem,
} from "./delivery-readiness-admin.present.js";

export type PatchDeliveryConfigResult =
  | { item: RoutingRuleWithReadinessItem }
  | { notFound: true }
  | { error: string; code: "CONFIRMATION_REQUIRED" | "VALIDATION" };

export function requiresLiveConfirmation(
  patch: RoutingRuleDeliveryConfigPatch
): boolean {
  if (patch.deliveryEnabled === true) return true;
  if (patch.deliveryMode === "live") return true;
  return false;
}

export async function patchRoutingRuleDeliveryConfig(
  ruleId: string,
  patch: RoutingRuleDeliveryConfigPatch
): Promise<PatchDeliveryConfigResult> {
  const existing = await findCampaignRoutingRuleById(ruleId.trim());
  if (!existing) return { notFound: true };

  if (requiresLiveConfirmation(patch) && patch.confirmLiveDeliveryRisk !== true) {
    return {
      error:
        "Enabling live delivery requires confirmLiveDeliveryRisk: true. No delivery is executed in this phase.",
      code: "CONFIRMATION_REQUIRED",
    };
  }

  const merged = mergeRuleForAssessment(existing, patch);
  const assessment = evaluateDeliveryReadiness(merged);

  if (requiresLiveConfirmation(patch) && !assessment.readyForLive) {
    return {
      error:
        "Cannot enable live delivery: destination is not ready for live. Resolve blockers first.",
      code: "VALIDATION",
    };
  }

  const data = {
    ...deliveryConfigUpdateFromPatch(patch),
    ...persistedReadinessAfterAssessment(assessment),
  };

  const updated = await updateCampaignRoutingRuleDeliveryConfig(existing.id, data);
  return { item: presentRoutingRuleWithReadiness(updated) };
}
