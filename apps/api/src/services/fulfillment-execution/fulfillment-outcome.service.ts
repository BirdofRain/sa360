import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { EXECUTION_MODE_LIVE } from "./fulfillment-execution.constants.js";

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
      leadAllocation: { include: { leadOrder: true } },
      deliveryAttempts: { where: { id: input.attemptId } },
    },
  });

  if (!instruction) return { ok: false as const, code: "instruction_not_found" };
  const attempt = instruction.deliveryAttempts[0];
  if (!attempt) return { ok: false as const, code: "attempt_not_found" };

  if (attempt.executionMode !== EXECUTION_MODE_LIVE) {
    return { ok: false as const, code: "simulation_attempt_not_committable" };
  }

  if (attempt.status === "succeeded") {
    return {
      ok: true as const,
      status: "already_committed" as const,
      allocationId: instruction.leadAllocationId,
    };
  }

  const allocationId = instruction.leadAllocationId;
  const orderId = instruction.leadAllocation.leadOrder.id;
  const now = new Date();

  try {
    const result = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status::text AS status
        FROM "LeadAllocation"
        WHERE id = ${allocationId}
        FOR UPDATE
      `;
      const allocationRow = locked[0];
      if (!allocationRow) throw new Error("allocation_not_found");

      const attemptUpdated = await tx.deliveryAttempt.updateMany({
        where: {
          id: attempt.id,
          deliveryInstructionId: instruction.id,
          executionMode: EXECUTION_MODE_LIVE,
          status: { in: ["claimed", "in_progress"] },
        },
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
        where: {
          id: instruction.id,
          status: { in: ["executing", "queued", "planned"] },
        },
        data: { status: "completed" },
      });

      const requiredIncomplete = await tx.deliveryInstruction.count({
        where: {
          leadAllocationId: allocationId,
          isRequired: true,
          status: { not: "completed" },
        },
      });

      if (requiredIncomplete > 0) {
        return { allRequiredComplete: false as const };
      }

      const allocationUpdated = await tx.leadAllocation.updateMany({
        where: {
          id: allocationId,
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
        WHERE id = ${orderId}
          AND "reservedQuantity" > 0
          AND status = 'active'::"LeadOrderStatus"
      `;
      if (orderUpdated !== 1) throw new Error("order_counter_transition_failed");

      return { allRequiredComplete: true as const };
    });

    return {
      ok: true as const,
      status: "committed" as const,
      allocationId,
      allRequiredComplete: result.allRequiredComplete,
    };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "order_counter_transition_failed") {
        return { ok: false as const, code: "counter_transition_failed" };
      }
      if (err.message === "attempt_not_committable") {
        return { ok: false as const, code: "attempt_not_committable" };
      }
    }
    throw err;
  }
}

export async function safeReleaseReservation(
  allocationId: string,
  input: { reasonCode: string; detail?: string },
  db: PrismaClient = prisma
) {
  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string; leadOrderId: string }>>`
        SELECT id, status::text AS status, "leadOrderId"
        FROM "LeadAllocation"
        WHERE id = ${allocationId.trim()}
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row) throw new Error("allocation_not_found");
      if (
        row.status === "released" ||
        row.status === "committed" ||
        row.status === "shadow" ||
        row.status === "review_required"
      ) {
        throw new Error("invalid_allocation_status");
      }
      if (row.status !== "reserved" && row.status !== "delivering") {
        throw new Error("invalid_allocation_status");
      }

      const activeAttempts = await tx.deliveryAttempt.count({
        where: {
          deliveryInstruction: { leadAllocationId: row.id },
          status: { in: ["claimed", "in_progress"] },
        },
      });
      if (activeAttempts > 0) throw new Error("active_attempt_blocks_release");

      const released = await tx.leadAllocation.updateMany({
        where: { id: row.id, status: { in: ["reserved", "delivering"] } },
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
        WHERE id = ${row.leadOrderId}
          AND "reservedQuantity" > 0
      `;
      if (orderUpdated !== 1) throw new Error("release_counter_failed");
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "allocation_not_found") {
        return { ok: false as const, code: "allocation_not_found" };
      }
      if (err.message === "invalid_allocation_status") {
        return { ok: false as const, code: "invalid_allocation_status" };
      }
      if (err.message === "active_attempt_blocks_release") {
        return { ok: false as const, code: "active_attempt_blocks_release" };
      }
    }
    throw err;
  }

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

  const now = new Date();
  const terminalUpdated = await db.$transaction(async (tx) => {
    const updated = await tx.deliveryAttempt.updateMany({
      where: {
        id: attemptId,
        status: { in: ["claimed", "in_progress", "planned"] },
      },
      data: {
        status: "terminal_failure",
        retryable: false,
        errorCode: input.errorCode,
        errorSummary: input.errorSummary,
        completedAt: now,
      },
    });
    if (updated.count !== 1) return false;

    await tx.deliveryInstruction.updateMany({
      where: {
        id: attempt.deliveryInstructionId,
        status: { in: ["executing", "queued", "planned"] },
      },
      data: { status: "failed" },
    });
    return true;
  });

  if (!terminalUpdated) {
    return { ok: false as const, code: "attempt_not_active" };
  }

  if (input.releaseReservation) {
    const release = await safeReleaseReservation(attempt.deliveryInstruction.leadAllocationId, {
      reasonCode: input.errorCode,
      detail: input.errorSummary,
    }, db);
    if (!release.ok) {
      return { ok: false as const, code: "release_failed", releaseCode: release.code };
    }
  }

  return { ok: true as const };
}

export async function recordRetryableAttemptFailure(
  attemptId: string,
  input: { errorCode: string; errorSummary: string; nextRetryAt?: Date },
  db: PrismaClient = prisma
) {
  const attempt = await db.deliveryAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, deliveryInstructionId: true, deliveryInstruction: { select: { leadAllocationId: true } } },
  });
  if (!attempt) return { ok: false as const, code: "attempt_not_found" };

  const allocationId = attempt.deliveryInstruction.leadAllocationId;
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const attemptUpdated = await tx.deliveryAttempt.updateMany({
      where: {
        id: attemptId,
        status: { in: ["claimed", "in_progress"] },
      },
      data: {
        status: "retryable_failure",
        retryable: true,
        errorCode: input.errorCode,
        errorSummary: input.errorSummary,
        nextRetryAt: input.nextRetryAt ?? null,
        completedAt: now,
      },
    });
    if (attemptUpdated.count !== 1) return false;

    await tx.deliveryInstruction.updateMany({
      where: {
        id: attempt.deliveryInstructionId,
        status: { in: ["executing", "queued"] },
      },
      data: { status: "planned" },
    });
    await tx.leadAllocation.updateMany({
      where: { id: allocationId, status: "delivering" },
      data: { status: "reserved" },
    });
    return true;
  });

  if (!updated) return { ok: false as const, code: "attempt_not_active" };
  return { ok: true as const };
}
