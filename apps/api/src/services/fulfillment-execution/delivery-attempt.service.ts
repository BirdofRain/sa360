import type { DeliveryAttemptMode, Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  findDeliveryAttemptByIdempotencyKey,
  findLatestDeliveryAttemptForInstruction,
  updateDeliveryAttemptById,
} from "../../repositories/delivery-attempt.repository.js";
import { buildDeliveryAttemptIdempotencyKey } from "./fulfillment-execution-keys.js";
import {
  ACTIVE_ATTEMPT_STATUSES,
  CLAIMABLE_INSTRUCTION_STATUSES,
  EXECUTION_MODE_SIMULATION,
} from "./fulfillment-execution.constants.js";
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
      executionMode: DeliveryAttemptMode;
    }
  | { ok: false; code: string; reasons: string[] };

export type SimulateInstructionResult =
  | {
      ok: true;
      simulation: true;
      attemptId: string;
      attemptNumber: number;
      executionMode: DeliveryAttemptMode;
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

function isInstructionClaimable(status: string): boolean {
  return (CLAIMABLE_INSTRUCTION_STATUSES as readonly string[]).includes(status);
}

export async function claimDeliveryAttempt(
  deliveryInstructionId: string,
  input: { executionMode: DeliveryAttemptMode },
  db: PrismaClient = prisma
): Promise<ClaimAttemptResult> {
  const instruction = await db.deliveryInstruction.findUnique({
    where: { id: deliveryInstructionId.trim() },
    include: {
      deliveryTarget: true,
      leadAllocation: { include: { leadOrder: true } },
      deliveryAttempts: {
        where: { status: { in: [...ACTIVE_ATTEMPT_STATUSES] } },
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
      executionMode: active.executionMode,
    };
  }

  if (!isInstructionClaimable(instruction.status)) {
    return {
      ok: false,
      code: "instruction_not_claimable",
      reasons: [`instruction_status_${instruction.status}`],
    };
  }

  const allocation = instruction.leadAllocation;
  if (allocation.status === "released" || allocation.status === "committed" || allocation.status === "shadow") {
    return {
      ok: false,
      code: "invalid_allocation_status",
      reasons: [`allocation_status_${allocation.status}`],
    };
  }
  if (allocation.status === "review_required") {
    return {
      ok: false,
      code: "allocation_review_required",
      reasons: ["allocation_review_required"],
    };
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

  const attemptNumber = await nextAttemptNumber(instruction.id, db);
  const idempotencyKey = buildDeliveryAttemptIdempotencyKey(
    instruction.id,
    attemptNumber,
    input.executionMode
  );
  const existingByKey = await findDeliveryAttemptByIdempotencyKey(idempotencyKey, db);
  if (existingByKey && (existingByKey.status === "claimed" || existingByKey.status === "in_progress")) {
    return {
      ok: true,
      status: "already_claimed",
      attemptId: existingByKey.id,
      attemptNumber: existingByKey.attemptNumber,
      idempotencyKey: existingByKey.idempotencyKey,
      executionMode: existingByKey.executionMode,
    };
  }

  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status::text AS status
        FROM "LeadAllocation"
        WHERE id = ${allocation.id}
        FOR UPDATE
      `;
      const lockedRow = locked[0];
      if (!lockedRow || (lockedRow.status !== "reserved" && lockedRow.status !== "delivering")) {
        throw new Error("allocation_not_executable");
      }

      if (lockedRow.status === "reserved") {
        const transitioned = await tx.$executeRaw`
          UPDATE "LeadAllocation"
          SET status = 'delivering'::"LeadAllocationStatus", "updatedAt" = ${now}
          WHERE id = ${allocation.id} AND status = 'reserved'::"LeadAllocationStatus"
        `;
        if (transitioned !== 1) throw new Error("allocation_transition_failed");
      }

      const instructionClaimed = await tx.$executeRaw`
        UPDATE "DeliveryInstruction"
        SET status = 'executing'::"DeliveryInstructionStatus", "updatedAt" = ${now}
        WHERE id = ${instruction.id}
          AND status IN ('planned'::"DeliveryInstructionStatus", 'queued'::"DeliveryInstructionStatus")
      `;
      if (instructionClaimed !== 1) throw new Error("instruction_not_claimable");

      const activeAttempts = await tx.deliveryAttempt.findFirst({
        where: {
          deliveryInstructionId: instruction.id,
          status: { in: [...ACTIVE_ATTEMPT_STATUSES] },
        },
      });
      if (activeAttempts) throw new Error("active_attempt_exists");

      await tx.deliveryAttempt.create({
        data: {
          deliveryInstructionId: instruction.id,
          adapterKey: adapter.adapterKey,
          attemptNumber,
          idempotencyKey,
          executionMode: input.executionMode,
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
          AND "executionMode" = ${input.executionMode}::"DeliveryAttemptMode"
          AND status = 'planned'::"DeliveryAttemptStatus"
      `;
      if (claimed !== 1) throw new Error("claim_update_failed");
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
      executionMode: attempt.executionMode,
    };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "allocation_not_executable") {
        return {
          ok: false,
          code: "invalid_allocation_status",
          reasons: ["allocation_not_executable"],
        };
      }
      if (err.message === "allocation_transition_failed" || err.message === "instruction_not_claimable") {
        return {
          ok: false,
          code: "claim_race_lost",
          reasons: [err.message],
        };
      }
      if (err.message === "active_attempt_exists") {
        const raced = await db.deliveryAttempt.findFirst({
          where: {
            deliveryInstructionId: instruction.id,
            status: { in: [...ACTIVE_ATTEMPT_STATUSES] },
          },
        });
        if (raced) {
          return {
            ok: true,
            status: "already_claimed",
            attemptId: raced.id,
            attemptNumber: raced.attemptNumber,
            idempotencyKey: raced.idempotencyKey,
            executionMode: raced.executionMode,
          };
        }
      }
    }
    if (err instanceof PrismaNamespace.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.deliveryAttempt.findFirst({
        where: {
          deliveryInstructionId: instruction.id,
          status: { in: [...ACTIVE_ATTEMPT_STATUSES] },
        },
      });
      if (raced) {
        return {
          ok: true,
          status: "already_claimed",
          attemptId: raced.id,
          attemptNumber: raced.attemptNumber,
          idempotencyKey: raced.idempotencyKey,
          executionMode: raced.executionMode,
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
  const claim = await claimDeliveryAttempt(
    deliveryInstructionId,
    { executionMode: EXECUTION_MODE_SIMULATION },
    db
  );
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

  const inProgress = await db.deliveryAttempt.updateMany({
    where: {
      id: attempt.id,
      executionMode: EXECUTION_MODE_SIMULATION,
      status: { in: ["claimed", "in_progress"] },
    },
    data: { status: "in_progress" },
  });
  if (inProgress.count !== 1) {
    return { ok: false, code: "attempt_not_active", reasons: ["attempt_not_active"] };
  }

  const simulation = await adapter.simulate({ payload });
  const now = new Date();

  await db.$transaction(async (tx) => {
    const succeeded = await tx.deliveryAttempt.updateMany({
      where: {
        id: attempt.id,
        executionMode: EXECUTION_MODE_SIMULATION,
        status: { in: ["claimed", "in_progress"] },
      },
      data: {
        status: simulation.ok ? "succeeded" : simulation.retryable ? "retryable_failure" : "terminal_failure",
        sanitizedResponseJson: (simulation.ok
          ? { ...simulation.sanitizedResponse, simulation: true }
          : { simulation: true, errorCode: simulation.errorCode }) as Prisma.InputJsonValue,
        externalReference: simulation.ok ? simulation.externalReference : null,
        errorCode: simulation.ok ? null : simulation.errorCode,
        errorSummary: simulation.ok ? null : simulation.errorSummary,
        retryable: !simulation.ok && simulation.retryable,
        completedAt: now,
      },
    });
    if (succeeded.count !== 1) throw new Error("simulation_finalize_failed");

    await tx.deliveryInstruction.updateMany({
      where: { id: attempt.deliveryInstructionId, status: "executing" },
      data: { status: "planned" },
    });
    await tx.leadAllocation.updateMany({
      where: { id: attempt.deliveryInstruction.leadAllocationId, status: "delivering" },
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
    executionMode: EXECUTION_MODE_SIMULATION,
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
  if (attempt.executionMode !== "live") {
    return { ok: false as const, code: "simulation_attempt_not_eligible" };
  }
  if (attempt.status === "succeeded" || attempt.status === "terminal_failure" || attempt.status === "unknown_outcome") {
    return { ok: false as const, code: "attempt_not_active" };
  }

  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const attemptUpdated = await tx.deliveryAttempt.updateMany({
        where: {
          id: attemptId,
          executionMode: "live",
          status: { in: ["claimed", "in_progress"] },
        },
        data: {
          status: "unknown_outcome",
          retryable: false,
          errorCode: input.errorCode ?? "unknown_outcome",
          errorSummary: input.errorSummary,
          completedAt: now,
        },
      });
      if (attemptUpdated.count !== 1) throw new Error("attempt_not_active");

      const allocationUpdated = await tx.leadAllocation.updateMany({
        where: {
          id: attempt.deliveryInstruction.leadAllocationId,
          status: { in: ["reserved", "delivering"] },
        },
        data: {
          status: "review_required",
          reviewReasonJson: {
            code: "unknown_outcome",
            attemptId,
            summary: input.errorSummary,
          },
        },
      });
      if (allocationUpdated.count !== 1) throw new Error("allocation_not_reviewable");

      await tx.deliveryInstruction.updateMany({
        where: {
          id: attempt.deliveryInstructionId,
          status: { in: ["executing", "queued", "planned"] },
        },
        data: { status: "review_required" },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "allocation_not_reviewable") {
      return { ok: false as const, code: "allocation_not_reviewable" };
    }
    if (err instanceof Error && err.message === "attempt_not_active") {
      return { ok: false as const, code: "attempt_not_active" };
    }
    throw err;
  }

  return { ok: true as const };
}
