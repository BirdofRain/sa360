import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";
import {
  redactDeliveryTargetMetadataForPresentation,
  validateDeliveryTargetMetadata,
} from "../lib/delivery-target-metadata.validation.js";

export function sanitizeDeliveryTargetMetadata(value: unknown): Record<string, unknown> {
  return redactDeliveryTargetMetadataForPresentation(value);
}

export { validateDeliveryTargetMetadata };

export async function listEnabledDeliveryTargetsForClient(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.deliveryTarget.findMany({
    where: { clientAccountId: clientAccountId.trim(), enabled: true },
    orderBy: [{ isPrimary: "desc" }, { isRequired: "desc" }, { displayName: "asc" }],
  });
}

export async function createDeliveryTargetRecord(
  data: Prisma.DeliveryTargetCreateInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.deliveryTarget.create({ data });
}

export async function updateDeliveryTargetRecord(
  id: string,
  data: Prisma.DeliveryTargetUpdateInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.deliveryTarget.update({
    where: { id: id.trim() },
    data,
  });
}

export async function createDeliveryInstructions(
  inputs: Array<{
    leadAllocationId: string;
    deliveryTargetId: string;
    sequence: number;
    isRequired: boolean;
  }>,
  db: PrismaClient = prisma
) {
  if (inputs.length === 0) return [];
  await db.deliveryInstruction.createMany({
    data: inputs.map((row) => ({
      leadAllocationId: row.leadAllocationId,
      deliveryTargetId: row.deliveryTargetId,
      sequence: row.sequence,
      isRequired: row.isRequired,
      status: "planned",
    })),
    skipDuplicates: true,
  });
  return db.deliveryInstruction.findMany({
    where: { leadAllocationId: inputs[0]?.leadAllocationId },
    include: { deliveryTarget: true },
    orderBy: { sequence: "asc" },
  });
}

export function presentDeliveryTargetSafe(target: {
  id: string;
  clientAccountId: string;
  displayName: string;
  adapterKey: string;
  enabled: boolean;
  isPrimary: boolean;
  isRequired: boolean;
  configMetadataJson: unknown;
  readinessStatus: string;
}) {
  const safeMetadata = redactDeliveryTargetMetadataForPresentation(target.configMetadataJson);

  return {
    id: target.id,
    clientAccountId: target.clientAccountId,
    displayName: target.displayName,
    adapterKey: target.adapterKey,
    enabled: target.enabled,
    isPrimary: target.isPrimary,
    isRequired: target.isRequired,
    readinessStatus: target.readinessStatus,
    configMetadata: safeMetadata,
  };
}
