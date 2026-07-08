import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";

export async function commitFulfillmentSuccess(
  deliveryInstructionId: string,
  input: {
    attemptId: string;
    externalReference?: string | null;
    sanitizedResponseJson?: Record<string, unknown>;
  },
  db: PrismaClient = prisma
) {
  const instruction = await db.deliveryInstruction.findUnique({
    where: { id: deliveryInstructionId.trim() },
    include: {
      leadAllocation: {
        include: {
          leadOrder: true,
          deliveryInstructions: { where: { isRequired: true } },
        },
      },
      deliveryAttempts: { where: { id: input.attemptId } },
    },
  });

  if (!instruction) return { ok: false as const, code: "instruction_not_found" };
  const attempt = instruction.deliveryAttempts[0];
  if (!attempt) return { ok: false as const, code: "attempt_not_found" };
  if (attempt.status === "succeeded") {
    return { ok: true as const, status: "already_committed" as const, allocationId: instruction.leadAllocationId };
  }

  const allocation = instruction.leadAllocation;
  const order = allocation.leadOrder;
  const now = new Date();

  const requiredIncomplete = allocation.deliveryInstructions.filter(
    (row) => row.isRequired && row.id !== instruction.id && row.status !== "completed"
  );
  const allRequiredComplete = requiredIncomplete.length === 0;

  try {
    await db.$transaction(async (tx) => {
      const attemptUpdated = await tx.deliveryAttempt.updateMany({
        where: { id: attempt.id, status: { in: ["claimed", "in_progress"] } },
        data: {
          status: "succeeded",
          externalReference: input.externalReference ?? null,
          sanitizedResponseJson: (input.sanitizedResponseJson ?? undefined) as Prisma.InputJsonValue,
          retryable: false,
          completedAt: now,
        },
      });
      if (attemptUpdated.count !== 1) throw new Error("attempt_not_committable");

      await tx.deliveryInstruction.updateMany({
        where: { id: instruction.id, status: { in: ["executing", "queued", "planned"] } },
        data: { status: "completed" },
      });

      if (allRequiredComplete) {
        const allocationUpdated = await tx.leadAllocation.updateMany({
          where: {
            id: allocation.id,
            status: { in: ["reserved", "delivering"] },
          },
          data: { status: "committed", committedAt: now },
        });
        if (allocationUpdated.count !== 1) throw new Error("allocation_not_committable");

        const orderUpdated = await tx.$executeRaw`
          UPDATE "LeadOrder"
          SET
            "reservedQuantity" = "reservedQuantity" - 1,
            "fulfilledQuantity" = "fulfilledQuantity" + 1,
            "updatedAt" = ${now}
          WHERE id = ${order.id}
            AND "reservedQuantity" > 0
            AND status = 'active'::"LeadOrderStatus"
        `;
        if (orderUpdated !== 1) throw new Error("order_counter_transition_failed");
      }
    });

    return {
      ok: true as const,
      status: "committed" as const,
      allocationId: allocation.id,
      allRequiredComplete,
    };
  } catch (err) {
    if (err instanceof Error && err.message === "order_counter_transition_failed") {
      return { ok: false as const, code: "counter_transition_failed" };
    }
    throw err;
  }
}

export async function safeReleaseReservation(
  allocationId: string,
  input: { reasonCode: string; detail?: string },
  db: PrismaClient = prisma
) {
  const allocation = await db.leadAllocation.findUnique({
    where: { id: allocationId.trim() },
    include: {
      leadOrder: true,
      deliveryInstructions: {
        include: { deliveryAttempts: { where: { status: { in: ["claimed", "in_progress", "unknown_outcome"] } } } },
      },
    },
  });

  if (!allocation) return { ok: false as const, code: "allocation_not_found" };
  if (allocation.status !== "reserved") {
    return { ok: false as const, code: "invalid_allocation_status" };
  }

  const hasActiveAttempts = allocation.deliveryInstructions.some(
    (row) => row.deliveryAttempts.length > 0
  );
  if (hasActiveAttempts) {
    return { ok: false as const, code: "active_attempt_blocks_release" };
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    const released = await tx.leadAllocation.updateMany({
      where: { id: allocation.id, status: "reserved" },
      data: {
        status: "released",
        releasedAt: now,
        releaseReasonJson: { code: input.reasonCode, detail: input.detail ?? null },
      },
    });
    if (released.count !== 1) throw new Error("release_transition_failed");

    const orderUpdated = await tx.$executeRaw`
      UPDATE "LeadOrder"
      SET
        "reservedQuantity" = "reservedQuantity" - 1,
        "updatedAt" = ${now}
      WHERE id = ${allocation.leadOrderId}
        AND "reservedQuantity" > 0
    `;
    if (orderUpdated !== 1) throw new Error("release_counter_failed");
  });

  return { ok: true as const };
}

export async function recordTerminalPreSendFailure(
  attemptId: string,
  input: { errorCode: string; errorSummary: string; releaseReservation?: boolean },
  db: PrismaClient = prisma
) {
  const attempt = await db.deliveryAttempt.findUnique({
    where: { id: attemptId },
    include: { deliveryInstruction: { include: { leadAllocation: true } } },
  });
  if (!attempt) return { ok: false as const, code: "attempt_not_found" };

  await db.$transaction(async (tx) => {
    await tx.deliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status: "terminal_failure",
        retryable: false,
        errorCode: input.errorCode,
        errorSummary: input.errorSummary,
        completedAt: new Date(),
      },
    });
    await tx.deliveryInstruction.updateMany({
      where: { id: attempt.deliveryInstructionId },
      data: { status: "failed" },
    });
  });

  if (input.releaseReservation) {
    await safeReleaseReservation(attempt.deliveryInstruction.leadAllocationId, {
      reasonCode: input.errorCode,
      detail: input.errorSummary,
    }, db);
  }

  return { ok: true as const };
}

export async function recordRetryableAttemptFailure(
  attemptId: string,
  input: { errorCode: string; errorSummary: string; nextRetryAt?: Date },
  db: PrismaClient = prisma
) {
  await db.deliveryAttempt.update({
    where: { id: attemptId },
    data: {
      status: "retryable_failure",
      retryable: true,
      errorCode: input.errorCode,
      errorSummary: input.errorSummary,
      nextRetryAt: input.nextRetryAt ?? null,
      completedAt: new Date(),
    },
  });
  return { ok: true as const };
}
