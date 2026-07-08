import type { DeliveryTarget } from "@prisma/client";

import { getDeliveryAdapter } from "./delivery-adapter.registry.js";
import {
  createDeliveryInstructions,
  listEnabledDeliveryTargetsForClient,
} from "../../repositories/delivery-target.repository.js";

export type DeliveryPlanningResult =
  | { ok: true; instructions: Awaited<ReturnType<typeof createDeliveryInstructions>> }
  | { ok: false; code: "no_enabled_targets" | "required_target_not_ready"; reasons: string[] };

export async function planDeliveryInstructionsForAllocation(input: {
  leadAllocationId: string;
  clientAccountId: string;
}): Promise<DeliveryPlanningResult> {
  const targets = await listEnabledDeliveryTargetsForClient(input.clientAccountId);
  if (targets.length === 0) {
    return { ok: false, code: "no_enabled_targets", reasons: ["no_enabled_delivery_targets"] };
  }

  const requiredTargets = targets.filter((target) => target.isRequired);
  const optionalTargets = targets.filter((target) => !target.isRequired);
  const orderedTargets: DeliveryTarget[] = [
    ...requiredTargets.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    ...optionalTargets.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
  ];

  const readinessReasons: string[] = [];
  for (const target of requiredTargets) {
    const adapter = getDeliveryAdapter(target.adapterKey);
    const metadata =
      target.configMetadataJson && typeof target.configMetadataJson === "object"
        ? (target.configMetadataJson as Record<string, unknown>)
        : {};
    const validation = adapter
      ? adapter.validateTarget({ configMetadata: metadata })
      : { ok: false as const, readinessStatus: "unknown_adapter", reason: "adapter_not_registered" };
    if (!validation.ok) {
      readinessReasons.push(`required_target_not_ready:${target.adapterKey}:${validation.reason}`);
    }
  }

  if (readinessReasons.length > 0) {
    return {
      ok: false,
      code: "required_target_not_ready",
      reasons: readinessReasons,
    };
  }

  const instructions = await createDeliveryInstructions(
    orderedTargets.map((target, index) => ({
      leadAllocationId: input.leadAllocationId,
      deliveryTargetId: target.id,
      sequence: index + 1,
      isRequired: target.isRequired,
    }))
  );

  return { ok: true, instructions };
}
