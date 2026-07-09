import type { DeliveryAttemptMode, Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaValue } from "@prisma/client";

import { prisma } from "../lib/db.js";

export async function findDeliveryAttemptByIdempotencyKey(
  idempotencyKey: string,
  db: PrismaClient = prisma
) {
  return db.deliveryAttempt.findUnique({
    where: { idempotencyKey: idempotencyKey.trim() },
    include: {
      deliveryInstruction: {
        include: {
          deliveryTarget: true,
          leadAllocation: { include: { leadOrder: true } },
        },
      },
    },
  });
}

export async function findLatestDeliveryAttemptForInstruction(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
) {
  return db.deliveryAttempt.findFirst({
    where: { deliveryInstructionId: deliveryInstructionId.trim() },
    orderBy: { attemptNumber: "desc" },
  });
}

export async function listDeliveryAttemptsForInstruction(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
) {
  return db.deliveryAttempt.findMany({
    where: { deliveryInstructionId: deliveryInstructionId.trim() },
    orderBy: { attemptNumber: "asc" },
  });
}

export async function createDeliveryAttemptPlanned(
  input: {
    deliveryInstructionId: string;
    adapterKey: string;
    attemptNumber: number;
    idempotencyKey: string;
    executionMode: DeliveryAttemptMode;
    requestFingerprint?: string | null;
    sanitizedRequestJson?: Prisma.InputJsonValue;
  },
  db: PrismaClient = prisma
) {
  return db.deliveryAttempt.create({
    data: {
      deliveryInstructionId: input.deliveryInstructionId.trim(),
      adapterKey: input.adapterKey.trim(),
      attemptNumber: input.attemptNumber,
      idempotencyKey: input.idempotencyKey.trim(),
      executionMode: input.executionMode,
      status: "planned",
      requestFingerprint: input.requestFingerprint ?? null,
      sanitizedRequestJson: input.sanitizedRequestJson ?? PrismaValue.JsonNull,
    },
  });
}

export async function updateDeliveryAttemptById(
  id: string,
  data: Prisma.DeliveryAttemptUpdateInput,
  db: PrismaClient = prisma
) {
  return db.deliveryAttempt.update({ where: { id }, data });
}

export type ActiveAttemptStatuses = "claimed" | "in_progress";
