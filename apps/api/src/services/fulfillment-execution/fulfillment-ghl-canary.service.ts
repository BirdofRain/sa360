import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { GHL_LIVE_CANARY_SAFETY_MESSAGE } from "../../lib/ghl-delivery-adapter-mode.js";
import { recordLiveCanaryOutcomeAudit, warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import type { GhlLiveHttpDeps } from "../ghl-delivery-adapter/ghl-live-transport.js";
import { sanitizeAttemptPayload } from "./attempt-sanitize.service.js";
import { claimDeliveryAttempt, recordAttemptUnknownOutcome } from "./delivery-attempt.service.js";
import {
  assertSafeForPreSendCancellation,
} from "./delivery-execution-result.guard.js";
import { getExecutionAdapter } from "./execution-adapter.registry.js";
import { EXECUTION_MODE_LIVE } from "./fulfillment-execution.constants.js";
import type { DeliveryExecutionResult } from "./fulfillment-execution.types.js";
import {
  evaluateLf2GhlCanaryPreflight,
  evaluateLf2GhlCanaryWriteBoundaryGates,
  validateLf2GhlCanaryExecuteBody,
  type Lf2GhlCanaryExecuteInput,
} from "./fulfillment-ghl-canary-gates.service.js";
import {
  commitFulfillmentSuccess,
  recordLiveAttemptCanceledBeforeExternalCall,
  recordRetryableAttemptFailure,
  recordTerminalPreSendFailure,
} from "./fulfillment-outcome.service.js";
import { loadLf2GhlInstructionBundle } from "./lf2-ghl-plan-context.service.js";

export async function getLf2GhlCanaryPreflightForInstruction(deliveryInstructionId: string) {
  await warmEffectiveDeliveryAdapterMode();
  const preflight = await evaluateLf2GhlCanaryPreflight(deliveryInstructionId);
  if ("notFound" in preflight) return { notFound: true as const };
  return {
    preflight,
    safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
  };
}

async function activateAttemptInProgress(attemptId: string, db: PrismaClient) {
  return db.deliveryAttempt.updateMany({
    where: {
      id: attemptId,
      executionMode: EXECUTION_MODE_LIVE,
      status: { in: ["claimed", "in_progress"] },
    },
    data: { status: "in_progress" },
  });
}

async function persistExecutionResult(
  deliveryInstructionId: string,
  attemptId: string,
  result: DeliveryExecutionResult,
  db: PrismaClient
) {
  switch (result.status) {
    case "succeeded": {
      const sanitized = sanitizeAttemptPayload(result.sanitizedResponse) ?? {};
      const commit = await commitFulfillmentSuccess(
        deliveryInstructionId,
        {
          attemptId,
          externalReference: result.externalReference,
          sanitizedResponseJson: sanitized,
        },
        db
      );
      if (!commit.ok) {
        await recordAttemptUnknownOutcome(
          attemptId,
          {
            errorSummary: `Live execution succeeded but LF2 commit failed: ${commit.code}`,
            errorCode: "lf2_commit_failed",
          },
          db
        );
        return { ok: false as const, commitCode: commit.code };
      }
      return { ok: true as const, allRequiredComplete: commit.allRequiredComplete };
    }
    case "retryable_failure": {
      if (result.retryable) {
        await recordRetryableAttemptFailure(
          attemptId,
          { errorCode: result.errorCode, errorSummary: result.errorSummary },
          db
        );
      } else if (result.externalCallExecuted) {
        await recordAttemptUnknownOutcome(
          attemptId,
          { errorCode: result.errorCode, errorSummary: result.errorSummary },
          db
        );
      } else {
        assertSafeForPreSendCancellation(result);
        await recordLiveAttemptCanceledBeforeExternalCall(
          attemptId,
          {
            errorCode: result.errorCode,
            errorSummary: result.errorSummary,
            sanitizedResponseJson: sanitizeAttemptPayload(result.sanitizedResponse) ?? undefined,
            externalCallExecuted: false,
          },
          db
        );
      }
      return { ok: false as const, errorCode: result.errorCode };
    }
    case "terminal_pre_send_failure": {
      assertSafeForPreSendCancellation(result);
      await recordLiveAttemptCanceledBeforeExternalCall(
        attemptId,
        {
          errorCode: result.errorCode,
          errorSummary: result.errorSummary,
          sanitizedResponseJson: sanitizeAttemptPayload(result.sanitizedResponse ?? {}) ?? undefined,
          externalCallExecuted: false,
        },
        db
      );
      return { ok: false as const, errorCode: result.errorCode };
    }
    case "unknown_outcome": {
      await recordAttemptUnknownOutcome(
        attemptId,
        {
          errorCode: result.errorCode,
          errorSummary: result.errorSummary,
        },
        db
      );
      return { ok: false as const, errorCode: result.errorCode, unknown: true as const };
    }
    case "partial_external_success_requiring_review": {
      await recordAttemptUnknownOutcome(
        attemptId,
        {
          errorCode: result.errorCode,
          errorSummary: result.errorSummary,
        },
        db
      );
      await db.deliveryAttempt.updateMany({
        where: { id: attemptId },
        data: {
          sanitizedResponseJson: (sanitizeAttemptPayload(result.sanitizedResponse) ??
            undefined) as Prisma.InputJsonValue | undefined,
          externalReference: result.contactIdGhl,
        },
      });
      return { ok: false as const, errorCode: result.errorCode, reviewRequired: true as const };
    }
    default:
      return { ok: false as const, errorCode: "unsupported_execution_result" };
  }
}

export async function executeLf2GhlCanaryForInstruction(
  deliveryInstructionId: string,
  input: Lf2GhlCanaryExecuteInput,
  deps?: GhlLiveHttpDeps,
  db: PrismaClient = prisma,
  hooks?: {
    recordAudit?: typeof recordLiveCanaryOutcomeAudit;
  }
) {
  await warmEffectiveDeliveryAdapterMode();
  const recordAudit = hooks?.recordAudit ?? recordLiveCanaryOutcomeAudit;

  const bodyErrors = validateLf2GhlCanaryExecuteBody(input);
  if (bodyErrors.length > 0) {
    return { blocked: true as const, blockers: bodyErrors, statusCode: 400 };
  }

  const preflight = await evaluateLf2GhlCanaryPreflight(deliveryInstructionId, db);
  if ("notFound" in preflight) return { notFound: true as const };
  if (!preflight.canExecute) {
    return {
      blocked: true as const,
      blockers: preflight.blockers,
      preflight,
      statusCode: 409,
    };
  }

  const claim = await claimDeliveryAttempt(
    deliveryInstructionId,
    { executionMode: EXECUTION_MODE_LIVE },
    db
  );
  if (!claim.ok) {
    return {
      blocked: true as const,
      blockers: claim.reasons,
      preflight,
      statusCode: 409,
    };
  }

  if (claim.status === "already_claimed") {
    const existing = await db.deliveryAttempt.findUnique({
      where: { id: claim.attemptId },
      select: { id: true, status: true, attemptNumber: true, executionMode: true },
    });
    const statusCode =
      existing?.status === "claimed" || existing?.status === "in_progress" ? 409 : 202;
    return {
      alreadyActive: true as const,
      preflight,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
      attemptId: claim.attemptId,
      attemptStatus: existing?.status ?? "unknown",
      attemptNumber: claim.attemptNumber,
      message:
        existing?.status === "unknown_outcome"
          ? "A live attempt requires reconciliation before any replay."
          : existing?.status === "succeeded"
            ? "A succeeded live attempt already exists; replay is blocked."
            : "Live execution is already active or awaiting reconciliation.",
      statusCode,
    };
  }

  let attemptActivated = false;
  let externalCallStarted = false;
  try {
    const inProgress = await activateAttemptInProgress(claim.attemptId, db);
    if (inProgress.count !== 1) {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        {
          errorCode: "attempt_activation_failed",
          errorSummary: "Attempt could not be activated for live execution.",
          externalCallExecuted: false,
        },
        db
      );
      return {
        blocked: true as const,
        blockers: ["attempt_not_active"],
        preflight,
        statusCode: 409,
      };
    }
    attemptActivated = true;

    const writeBoundary = await evaluateLf2GhlCanaryWriteBoundaryGates(deliveryInstructionId, db);
    if ("notFound" in writeBoundary) {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        {
          errorCode: "instruction_not_found",
          errorSummary: "Instruction disappeared before write-boundary gate evaluation.",
          externalCallExecuted: false,
        },
        db
      );
      return { notFound: true as const };
    }
    if (!writeBoundary.canExecute) {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        {
          errorCode: "write_boundary_gate_closed",
          errorSummary: writeBoundary.blockers.join("; "),
          sanitizedResponseJson: { blockers: writeBoundary.blockers },
          externalCallExecuted: false,
        },
        db
      );
      return {
        blocked: true as const,
        blockers: writeBoundary.blockers,
        preflight: writeBoundary,
        statusCode: 409,
      };
    }

    const bundle = await loadLf2GhlInstructionBundle(deliveryInstructionId, db);
    if (!bundle?.destination || !bundle.client || !writeBoundary.authoritativeLocationId) {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        {
          errorCode: "bundle_resolution_failed",
          errorSummary: "Instruction bundle could not be resolved before external execution.",
          externalCallExecuted: false,
        },
        db
      );
      return { notFound: true as const };
    }

    const adapter = getExecutionAdapter(bundle.instruction.deliveryTarget.adapterKey);
    if (!adapter?.deliverLive) {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        {
          errorCode: "adapter_live_execution_unavailable",
          errorSummary: `Adapter ${bundle.instruction.deliveryTarget.adapterKey} does not support live delivery.`,
          externalCallExecuted: false,
        },
        db
      );
      return {
        blocked: true as const,
        blockers: ["adapter_live_execution_unavailable"],
        preflight,
        statusCode: 409,
      };
    }

    await recordAudit({
      eventType: "live_canary_attempted",
      enabledBy: input.executedBy?.trim() || "admin_api",
      metadata: {
        deliveryInstructionId,
        attemptId: claim.attemptId,
        leadOrderId: bundle.order.id,
        allocationId: bundle.instruction.leadAllocationId,
        authoritativeLocationId: writeBoundary.authoritativeLocationId,
        canonicalSourceLane: writeBoundary.canonicalSourceLane,
      },
    });

    externalCallStarted = true;
    const executionResult = await adapter.deliverLive({
      idempotencyKey: claim.idempotencyKey,
      authoritativeLocationId: writeBoundary.authoritativeLocationId,
      instructionId: bundle.instruction.id,
      allocationId: bundle.instruction.leadAllocationId,
      clientAccountId: bundle.client.clientAccountId,
      clientDisplayName: bundle.client.clientDisplayName,
      destinationConfig: bundle.destination,
      sourceLeadEvent: bundle.sourceLeadEvent,
      deps,
    });

    const persisted = await persistExecutionResult(
      deliveryInstructionId,
      claim.attemptId,
      executionResult,
      db
    );

    if (persisted.ok) {
      await recordAudit({
        eventType: "live_canary_succeeded",
        enabledBy: input.executedBy?.trim() || "admin_api",
        metadata: {
          deliveryInstructionId,
          attemptId: claim.attemptId,
          contactIdGhl:
            executionResult.status === "succeeded" ? executionResult.contactIdGhl : undefined,
        },
      });
      return {
        ok: true as const,
        preflight: writeBoundary,
        safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
        attemptId: claim.attemptId,
        contactIdGhl:
          executionResult.status === "succeeded" ? executionResult.contactIdGhl : undefined,
        opportunityIdGhl:
          executionResult.status === "succeeded" ? executionResult.opportunityIdGhl : undefined,
        workflowStarted:
          executionResult.status === "succeeded" ? executionResult.workflowStarted : undefined,
        externalCallExecuted:
          executionResult.status === "succeeded" ||
          executionResult.status === "partial_external_success_requiring_review" ||
          executionResult.status === "unknown_outcome",
        allRequiredComplete:
          executionResult.status === "succeeded" ? executionResult.allRequiredComplete : undefined,
        executionStatus: executionResult.status,
      };
    }

    await recordAudit({
      eventType: "live_canary_failed",
      enabledBy: input.executedBy?.trim() || "admin_api",
      metadata: {
        deliveryInstructionId,
        attemptId: claim.attemptId,
        errorCode: persisted.errorCode,
      },
    });

    return {
      ok: false as const,
      preflight: writeBoundary,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
      attemptId: claim.attemptId,
      errorCode: persisted.errorCode,
      commitCode: "commitCode" in persisted ? persisted.commitCode : undefined,
      executionStatus: executionResult.status,
      sanitizedResponse:
        "sanitizedResponse" in executionResult ? executionResult.sanitizedResponse : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (externalCallStarted) {
      await recordAttemptUnknownOutcome(
        claim.attemptId,
        { errorCode: "live_canary_exception", errorSummary: message },
        db
      );
    } else if (attemptActivated) {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        { errorCode: "pre_send_exception", errorSummary: message, externalCallExecuted: false },
        db
      );
    } else {
      await recordLiveAttemptCanceledBeforeExternalCall(
        claim.attemptId,
        { errorCode: "pre_send_exception", errorSummary: message, externalCallExecuted: false },
        db
      );
    }
    await recordAudit({
      eventType: "live_canary_failed",
      enabledBy: input.executedBy?.trim() || "admin_api",
      reason: message,
      metadata: { deliveryInstructionId, attemptId: claim.attemptId },
    }).catch(() => undefined);
    return {
      ok: false as const,
      preflight,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
      attemptId: claim.attemptId,
      error: message,
    };
  }
}
