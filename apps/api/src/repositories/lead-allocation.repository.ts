import type { LeadAllocationStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

export async function findLeadAllocationByIdempotencyKey(
  idempotencyKey: string,
  db: PrismaClient = prisma
) {
  return db.leadAllocation.findUnique({
    where: { idempotencyKey: idempotencyKey.trim() },
    include: {
      deliveryInstructions: {
        include: { deliveryTarget: true },
        orderBy: { sequence: "asc" },
      },
      leadOrder: true,
    },
  });
}

export async function findLeadAllocationBySourceLeadEventId(
  sourceLeadEventId: string,
  db: PrismaClient = prisma
) {
  return db.leadAllocation.findFirst({
    where: { sourceLeadEventId: sourceLeadEventId.trim(), status: "shadow" },
    include: {
      deliveryInstructions: {
        include: { deliveryTarget: true },
        orderBy: { sequence: "asc" },
      },
      leadOrder: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createShadowLeadAllocation(
  input: {
    sourceLeadEventId: string;
    leadOrderId: string;
    clientAccountId: string;
    allocationPolicyVersion: string;
    decisionReasonsJson: Prisma.InputJsonValue;
    candidateCount: number;
    idempotencyKey: string;
  },
  db: PrismaClient = prisma
) {
  return db.leadAllocation.create({
    data: {
      sourceLeadEventId: input.sourceLeadEventId.trim(),
      leadOrderId: input.leadOrderId.trim(),
      clientAccountId: input.clientAccountId.trim(),
      status: "shadow",
      allocationPolicyVersion: input.allocationPolicyVersion.trim(),
      decisionReasonsJson: input.decisionReasonsJson,
      candidateCount: input.candidateCount,
      idempotencyKey: input.idempotencyKey.trim(),
      proposedAt: new Date(),
    },
    include: {
      deliveryInstructions: { include: { deliveryTarget: true } },
      leadOrder: true,
    },
  });
}

export async function listUnmatchedSourceLeads(limit = 50, db: PrismaClient = prisma) {
  return db.sourceLeadEvent.findMany({
    where: {
      leadAllocations: { none: {} },
      eligibilityAssessments: { some: { status: "eligible" } },
    },
    orderBy: { receivedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      sourceLeadUid: true,
      receivedAt: true,
      clientAccountIdResolved: true,
      status: true,
    },
  });
}
