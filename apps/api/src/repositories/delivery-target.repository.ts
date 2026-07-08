import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

const SECRET_FIELD_PATTERN =
  /token|secret|password|apikey|api_key|credential|authorization|refresh/i;

export function sanitizeDeliveryTargetMetadata(
  value: unknown
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_PATTERN.test(key)) continue;
    if (typeof raw === "string" && raw.length > 500) {
      out[key] = `${raw.slice(0, 120)}…`;
      continue;
    }
    out[key] = raw;
  }
  return out;
}

export async function listEnabledDeliveryTargetsForClient(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.deliveryTarget.findMany({
    where: { clientAccountId: clientAccountId.trim(), enabled: true },
    orderBy: [{ isPrimary: "desc" }, { isRequired: "desc" }, { displayName: "asc" }],
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
  return {
    id: target.id,
    clientAccountId: target.clientAccountId,
    displayName: target.displayName,
    adapterKey: target.adapterKey,
    enabled: target.enabled,
    isPrimary: target.isPrimary,
    isRequired: target.isRequired,
    readinessStatus: target.readinessStatus,
    configMetadata: sanitizeDeliveryTargetMetadata(target.configMetadataJson),
  };
}
