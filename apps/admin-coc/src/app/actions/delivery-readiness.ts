"use server";

import { patchAdminRoutingRuleDeliveryConfig } from "@/lib/admin-api/server";
import type {
  RoutingRuleDeliveryConfigPatchBody,
  RoutingRuleWithReadinessItem,
} from "@/lib/delivery-readiness/types";

export type PatchDeliveryConfigActionResult =
  | { ok: true; item: RoutingRuleWithReadinessItem }
  | { ok: false; error: string };

export async function patchRoutingRuleDeliveryConfigAction(
  ruleId: string,
  body: RoutingRuleDeliveryConfigPatchBody
): Promise<PatchDeliveryConfigActionResult> {
  const res = await patchAdminRoutingRuleDeliveryConfig(ruleId, body);
  if (!res.data?.item || res.error) {
    return { ok: false, error: res.error ?? "Failed to update delivery config." };
  }
  return { ok: true, item: res.data.item };
}
