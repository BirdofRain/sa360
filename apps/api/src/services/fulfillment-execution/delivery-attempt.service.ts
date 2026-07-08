import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  findDeliveryAttemptByIdempotencyKey,
  findLatestDeliveryAttemptForInstruction,
  updateDeliveryAttemptById,
} from "../../repositories/delivery-attempt.repository.js";
import {
  buildDeliveryAttemptIdempotencyKey,
} from "./fulfillment-execution-keys.js";
import {
  containsPersistedSecret,
  fingerprintPayload,
  sanitizeAttemptPayload,
} from "./attempt-sanitize.service.js";
import { getExecutionAdapter } from "./execution-adapter.registry.js";

export type ClaimAttemptResult =
  | {
      ok: true;
      status: "claimed" | "already_claimed";
      attemptId: string;
      attemptNumber: number;
      idempotencyKey: string;
    }
  | { ok: false; code: string; reasons: string[] };

export type SimulateInstructionResult =
  | {
      ok: true;
      simulation: true;
      attemptId: string;
      attemptNumber: number;
      sanitizedRequest: Record<string, unknown>;
      sanitizedResponse: Record<string, unknown>;
      allocationStatus: string;
      instructionStatus: string;
    }
  | { ok: false; code: string; reasons: string[] };

async function nextAttemptNumber(deliveryInstructionId: string, db: PrismaClient) {
  const latest = await findLatestDeliveryAttemptForInstruction(deliveryInstructionId, db);
  return (latest?.attemptNumber ?? 0) + 1;
}

export async function claimDeliveryAttempt(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
): Promise<ClaimAttemptResult> {
  const instruction = await db.deliveryInstruction.findUnique({
    where: { id: deliveryInstructionId.trim() },
    include: {
      deliveryTarget: true,
      leadAllocation: { include: { leadOrder: true } },
      deliveryAttempts: {
        where: { status: { in: ["claimed", "in_progress"] } },
        take: 1,
      },
    },
  });

  if (!instruction) {
    return { ok: false, code: "instruction_not_found", reasons: ["instruction_not_found"] };
  }

  const active = instruction.deliveryAttempts[0];
  if (active) {
    return {
      ok: true,
      status: "already_claimed",
      attemptId: active.id,
      attemptNumber: active.attemptNumber,
      idempotencyKey: active.idempotencyKey,
    };
  }

  const allocation = instruction.leadAllocation;
  if (allocation.status !== "reserved" && allocation.status !== "delivering") {
    return {
      ok: false,
      code: "invalid_allocation_status",
      reasons: [`allocation_status_${allocation.status}`],
    };
  }

  const attemptNumber = await nextAttemptNumber(instruction.id, db);
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey(instruction.id, attemptNumber);
  const existingByKey = await findDeliveryAttemptByIdempotencyKey(idempotencyKey, db);
  if (existingByKey) {
    if (existingByKey.status === "claimed" || existingByKey.status === "in_progress") {
      return {
        ok: true,
        status: "already_claimed",
        attemptId: existingByKey.id,
        attemptNumber: existingByKey.attemptNumber,
        idempotencyKey: existingByKey.idempotencyKey,
      };
    }
  }

  const adapter = getExecutionAdapter(instruction.deliveryTarget.adapterKey);
  if (!adapter) {
    return {
      ok: false,
      code: "adapter_not_registered",
      reasons: [`adapter_not_registered:${instruction.deliveryTarget.adapterKey}`],
    };
  }

  const metadata =
    instruction.deliveryTarget.configMetadataJson &&
    typeof instruction.deliveryTarget.configMetadataJson === "object"
      ? (instruction.deliveryTarget.configMetadataJson as Record<string, unknown>)
      : {};
  const validation = adapter.validateTarget({ configMetadata: metadata });
  if (!validation.ok) {
    return {
      ok: false,
      code: "target_not_ready",
      reasons: [`target_not_ready:${validation.reason}`],
    };
  }

  const payload = adapter.buildPayload({
    allocationId: allocation.id,
    instructionId: instruction.id,
    configMetadata: metadata,
  });
  const sanitizedRequest = sanitizeAttemptPayload(payload) ?? {};
  if (containsPersistedSecret(sanitizedRequest).length > 0) {
    return { ok: false, code: "secret_in_payload", reasons: ["secret_in_request_snapshot"] };
  }

  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      await tx.deliveryAttempt.create({
        data: {
          deliveryInstructionId: instruction.id,
          adapterKey: adapter.adapterKey,
          attemptNumber,
          idempotencyKey,
          status: "planned",
          requestFingerprint: fingerprintPayload(payload),
          sanitizedRequestJson: sanitizedRequest as Prisma.InputJsonValue,
        },
      });

      const claimed = await tx.$executeRaw`
        UPDATE "DeliveryAttempt"
        SET
          status = 'claimed'::"DeliveryAttemptStatus",
          "startedAt" = ${now},
          "updatedAt" = ${now}
        WHERE "deliveryInstructionId" = ${instruction.id}
          AND "attemptNumber" = ${attemptNumber}
          AND status = 'planned'::"DeliveryAttemptStatus"
      `;
      if (claimed !== 1) throw new Error("claim_update_failed");

      await tx.deliveryInstruction.updateMany({
        where: { id: instruction.id, status: { in: ["planned", "queued"] } },
        data: { status: "executing" },
      });

      if (allocation.status === "reserved") {
        await tx.leadAllocation.updateMany({
          where: { id: allocation.id, status: "reserved" },
          data: { status: "delivering" },
        });
      }
    });

    const attempt = await findDeliveryAttemptByIdempotencyKey(idempotencyKey, db);
    if (!attempt) {
      return { ok: false, code: "claim_persist_failed", reasons: ["claim_persist_failed"] };
    }

    return {
      ok: true,
      status: "claimed",
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      idempotencyKey: attempt.idempotencyKey,
    };
  } catch (err) {
    if (err instanceof PrismaNamespace.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.deliveryAttempt.findFirst({
        where: {
          deliveryInstructionId: instruction.id,
          status: { in: ["claimed", "in_progress"] },
        },
      });
      if (raced) {
        return {
          ok: true,
          status: "already_claimed",
          attemptId: raced.id,
          attemptNumber: raced.attemptNumber,
          idempotencyKey: raced.idempotencyKey,
        };
      }
    }
    throw err;
  }
}

export async function simulateDeliveryInstruction(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
): Promise<SimulateInstructionResult> {
  const claim = await claimDeliveryAttempt(deliveryInstructionId, db);
  if (!claim.ok) return claim;

  const attempt = await findDeliveryAttemptByIdempotencyKey(claim.idempotencyKey, db);
  if (!attempt) {
    return { ok: false, code: "attempt_not_found", reasons: ["attempt_not_found"] };
  }

  const adapter = getExecutionAdapter(attempt.adapterKey);
  if (!adapter) {
    return { ok: false, code: "adapter_not_registered", reasons: ["adapter_not_registered"] };
  }

  const payload =
    attempt.sanitizedRequestJson && typeof attempt.sanitizedRequestJson === "object"
      ? (attempt.sanitizedRequestJson as Record<string, unknown>)
      : {};

  await updateDeliveryAttemptById(attempt.id, { status: "in_progress" }, db);

  const simulation = await adapter.simulate({ payload });
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: simulation.ok ? "succeeded" : simulation.retryable ? "retryable_failure" : "terminal_failure",
        sanitizedResponseJson: (simulation.ok
          ? simulation.sanitizedResponse
          : { simulation: true, errorCode: simulation.errorCode }) as Prisma.InputJsonValue,
        externalReference: simulation.ok ? simulation.externalReference : null,
        errorCode: simulation.ok ? null : simulation.errorCode,
        errorSummary: simulation.ok ? null : simulation.errorSummary,
        retryable: !simulation.ok && simulation.retryable,
        completedAt: now,
      },
    });

    // Simulation does not complete instruction or commit allocation.
    await tx.deliveryInstruction.updateMany({
      where: { id: attempt.deliveryInstructionId },
      data: { status: "planned" },
    });
    await tx.leadAllocation.updateMany({
      where: {
        id: attempt.deliveryInstruction.leadAllocationId,
        status: "delivering",
      },
      data: { status: "reserved" },
    });
  });

  const refreshed = await db.deliveryInstruction.findUnique({
    where: { id: attempt.deliveryInstructionId },
    include: { leadAllocation: true },
  });

  return {
    ok: true,
    simulation: true,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    sanitizedRequest: payload,
    sanitizedResponse: simulation.ok
      ? { ...simulation.sanitizedResponse, simulation: true }
      : { simulation: true, errorCode: simulation.errorCode, errorSummary: simulation.errorSummary },
    allocationStatus: refreshed?.leadAllocation.status ?? "unknown",
    instructionStatus: refreshed?.status ?? "unknown",
  };
}

export async function recordAttemptUnknownOutcome(
  attemptId: string,
  input: { errorSummary: string; errorCode?: string },
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
        status: "unknown_outcome",
        retryable: false,
        errorCode: input.errorCode ?? "unknown_outcome",
        errorSummary: input.errorSummary,
        completedAt: new Date(),
      },
    });
    await tx.leadAllocation.update({
      where: { id: attempt.deliveryInstruction.leadAllocationId },
      data: {
        status: "review_required",
        reviewReasonJson: {
          code: "unknown_outcome",
          attemptId,
          summary: input.errorSummary,
        },
      },
    });
    await tx.deliveryInstruction.updateMany({
      where: { id: attempt.deliveryInstructionId, status: { in: ["executing", "queued"] } },
      data: { status: "queued" },
    });
  });

  return { ok: true as const };
}
