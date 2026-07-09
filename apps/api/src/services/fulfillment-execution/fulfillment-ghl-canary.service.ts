import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { GHL_LIVE_CANARY_SAFETY_MESSAGE } from "../../lib/ghl-delivery-adapter-mode.js";
import { recordLiveCanaryOutcomeAudit, warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import { executeLiveCanaryGhlSteps } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";
import { isRequiredDeliveryPathComplete } from "../ghl-delivery-adapter/ghl-live-canary-step-requirements.js";
import type { GhlLiveHttpDeps } from "../ghl-delivery-adapter/ghl-live-transport.js";
import { sanitizeAttemptPayload } from "./attempt-sanitize.service.js";
import {
  claimDeliveryAttempt,
  recordAttemptUnknownOutcome,
} from "./delivery-attempt.service.js";
import { EXECUTION_MODE_LIVE } from "./fulfillment-execution.constants.js";
import {
  evaluateLf2GhlCanaryPreflight,
  validateLf2GhlCanaryExecuteBody,
  type Lf2GhlCanaryExecuteInput,
} from "./fulfillment-ghl-canary-gates.service.js";
import {
  commitFulfillmentSuccess,
  recordRetryableAttemptFailure,
  recordTerminalPreSendFailure,
} from "./fulfillment-outcome.service.js";
import {
  buildLf2GhlAdapterContext,
  loadLf2GhlInstructionBundle,
} from "./lf2-ghl-plan-context.service.js";

export async function getLf2GhlCanaryPreflightForInstruction(deliveryInstructionId: string) {
  await warmEffectiveDeliveryAdapterMode();
  const preflight = await evaluateLf2GhlCanaryPreflight(deliveryInstructionId);
  if ("notFound" in preflight) return { notFound: true as const };
  return {
    preflight,
    safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
  };
}

export async function executeLf2GhlCanaryForInstruction(
  deliveryInstructionId: string,
  input: Lf2GhlCanaryExecuteInput,
  deps?: GhlLiveHttpDeps,
  db: PrismaClient = prisma
) {
  await warmEffectiveDeliveryAdapterMode();

  const bodyErrors = validateLf2GhlCanaryExecuteBody(input);
  if (bodyErrors.length > 0) {
    return { blocked: true as const, blockers: bodyErrors, statusCode: 400 };
  }

  const preflight = await evaluateLf2GhlCanaryPreflight(deliveryInstructionId);
  if ("notFound" in preflight) return { notFound: true as const };
  if (!preflight.canExecute) {
    return {
      blocked: true as const,
      blockers: preflight.blockers,
      preflight,
      statusCode: 409,
    };
  }

  const bundle = await loadLf2GhlInstructionBundle(deliveryInstructionId, db);
  if (!bundle?.destination) return { notFound: true as const };

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

  const inProgress = await db.deliveryAttempt.updateMany({
    where: {
      id: claim.attemptId,
      executionMode: EXECUTION_MODE_LIVE,
      status: { in: ["claimed", "in_progress"] },
    },
    data: { status: "in_progress" },
  });
  if (inProgress.count !== 1) {
    return {
      blocked: true as const,
      blockers: ["attempt_not_active"],
      preflight,
      statusCode: 409,
    };
  }

  await recordLiveCanaryOutcomeAudit({
    eventType: "live_canary_attempted",
    enabledBy: input.executedBy?.trim() || "admin_api",
    metadata: {
      deliveryInstructionId,
      attemptId: claim.attemptId,
      leadOrderId: bundle.order.id,
      allocationId: bundle.instruction.leadAllocationId,
    },
  });

  const adapterCtx = buildLf2GhlAdapterContext({
    instruction: bundle.instruction,
    client: bundle.client,
    destination: bundle.destination,
    sourceLeadEvent: bundle.sourceLeadEvent,
  });

  let execution;
  try {
    execution = await executeLiveCanaryGhlSteps(adapterCtx, claim.idempotencyKey, deps);
  } catch (err) {
    await recordAttemptUnknownOutcome(
      claim.attemptId,
      {
        errorSummary: err instanceof Error ? err.message : String(err),
        errorCode: "live_canary_exception",
      },
      db
    );
    await recordLiveCanaryOutcomeAudit({
      eventType: "live_canary_failed",
      enabledBy: input.executedBy?.trim() || "admin_api",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { deliveryInstructionId, attemptId: claim.attemptId },
    });
    return {
      ok: false as const,
      preflight,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
      attemptId: claim.attemptId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const requiredPathComplete = isRequiredDeliveryPathComplete(
    execution.stepOutcomes,
    Boolean(adapterCtx.rule?.destinationPipelineIdGhl && adapterCtx.rule?.destinationPipelineStageIdGhl)
  );
  const deliverySucceeded =
    execution.runStatus === "succeeded" ||
    (execution.runStatus === "partial_success" && requiredPathComplete);

  if (deliverySucceeded && execution.contactIdGhl) {
    const commit = await commitFulfillmentSuccess(
      deliveryInstructionId,
      {
        attemptId: claim.attemptId,
        externalReference: execution.contactIdGhl,
        sanitizedResponseJson: sanitizeAttemptPayload({
          contactIdGhl: execution.contactIdGhl,
          opportunityIdGhl: execution.opportunityIdGhl,
          workflowStarted: execution.workflowStarted,
          runStatus: execution.runStatus,
          summary: execution.summary,
          stepOutcomes: execution.stepOutcomes.map((step) => ({
            stepType: step.stepType,
            status: step.status,
            externalId: step.externalId,
          })),
        }) ?? {},
      },
      db
    );
    if (!commit.ok) {
      await recordAttemptUnknownOutcome(
        claim.attemptId,
        {
          errorSummary: `Live GHL steps succeeded but LF2 commit failed: ${commit.code}`,
          errorCode: "lf2_commit_failed",
        },
        db
      );
      return {
        ok: false as const,
        preflight,
        safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
        attemptId: claim.attemptId,
        commitCode: commit.code,
      };
    }

    await recordLiveCanaryOutcomeAudit({
      eventType: "live_canary_succeeded",
      enabledBy: input.executedBy?.trim() || "admin_api",
      metadata: {
        deliveryInstructionId,
        attemptId: claim.attemptId,
        contactIdGhl: execution.contactIdGhl,
        runStatus: execution.runStatus,
      },
    });

    return {
      ok: true as const,
      preflight,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
      attemptId: claim.attemptId,
      contactIdGhl: execution.contactIdGhl,
      opportunityIdGhl: execution.opportunityIdGhl,
      workflowStarted: execution.workflowStarted,
      runStatus: execution.runStatus,
      externalCallExecuted: execution.stepOutcomes.some((step) => step.externalCallExecuted),
      allRequiredComplete: commit.allRequiredComplete,
    };
  }

  if (!execution.contactIdGhl) {
    await recordTerminalPreSendFailure(
      claim.attemptId,
      {
        errorCode: "contact_upsert_failed",
        errorSummary: execution.summary,
        releaseReservation: false,
      },
      db
    );
  } else {
    await recordRetryableAttemptFailure(
      claim.attemptId,
      {
        errorCode: execution.runStatus,
        errorSummary: execution.summary,
      },
      db
    );
  }

  await recordLiveCanaryOutcomeAudit({
    eventType: "live_canary_failed",
    enabledBy: input.executedBy?.trim() || "admin_api",
    metadata: {
      deliveryInstructionId,
      attemptId: claim.attemptId,
      runStatus: execution.runStatus,
    },
  });

  return {
    ok: false as const,
    preflight,
    safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
    attemptId: claim.attemptId,
    runStatus: execution.runStatus,
    summary: execution.summary,
    errors: execution.errors,
  };
}
