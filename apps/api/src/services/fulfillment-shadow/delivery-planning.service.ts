import type { DeliveryTarget, PrismaClient } from "@prisma/client";

import { getDeliveryAdapter } from "./delivery-adapter.registry.js";
import {
  createDeliveryInstructions,
  listEnabledDeliveryTargetsForClient,
} from "../../repositories/delivery-target.repository.js";
import { prisma } from "../../lib/db.js";

export type DeliveryPlanningResult =
  | { ok: true; instructions: Awaited<ReturnType<typeof createDeliveryInstructions>> }
  | {
      ok: false;
      code:
        | "no_enabled_targets"
        | "required_target_not_ready"
        | "tenant_mismatch"
        | "allocation_not_found";
      reasons: string[];
    };

export async function planDeliveryInstructionsForAllocation(
  input: {
    leadAllocationId: string;
    clientAccountId: string;
  },
  db: PrismaClient = prisma
): Promise<DeliveryPlanningResult> {
  const allocation = await db.leadAllocation.findUnique({
    where: { id: input.leadAllocationId.trim() },
    select: { id: true, clientAccountId: true },
  });
  if (!allocation) {
    return { ok: false, code: "allocation_not_found", reasons: ["allocation_not_found"] };
  }
  if (allocation.clientAccountId !== input.clientAccountId.trim()) {
    return { ok: false, code: "tenant_mismatch", reasons: ["allocation_client_mismatch"] };
  }

  const targets = await listEnabledDeliveryTargetsForClient(input.clientAccountId, db);
  if (targets.length === 0) {
    return { ok: false, code: "no_enabled_targets", reasons: ["no_enabled_delivery_targets"] };
  }

  const tenantMismatches = targets.filter(
    (target) => target.clientAccountId !== input.clientAccountId.trim()
  );
  if (tenantMismatches.length > 0) {
    return {
      ok: false,
      code: "tenant_mismatch",
      reasons: tenantMismatches.map((target) => `delivery_target_client_mismatch:${target.id}`),
    };
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
    })),
    db
  );

  return { ok: true, instructions };
}
