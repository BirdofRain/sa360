import type { Prisma } from "@prisma/client";
import { getGhlDeliveryAdapterMode } from "../../lib/ghl-delivery-adapter-mode.js";
import { GHL_LIVE_CANARY_SAFETY_MESSAGE } from "../../lib/ghl-delivery-adapter-mode.js";
import {
  recordLiveCanaryOutcomeAudit,
  warmEffectiveDeliveryAdapterMode,
} from "../delivery-runtime-mode.service.js";
import { findDeliveryPlanById } from "../../repositories/lead-delivery-plan.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  createGhlLiveDeliveryRun,
  findGhlLiveDeliveryRunById,
  findGhlLiveDeliveryRunByIdempotencyKey,
  listGhlLiveDeliveryRuns,
  updateGhlLiveDeliveryRun,
} from "../../repositories/ghl-live-delivery-run.repository.js";
import {
  evaluateLiveCanaryPreflight,
  loadLiveCanaryContext,
  validateLiveCanaryExecuteBody,
  type LiveCanaryExecuteInput,
} from "./ghl-live-canary-gates.service.js";
import { executeLiveCanaryGhlSteps } from "./ghl-live-canary-executor.service.js";
import type { GhlLiveHttpDeps } from "./ghl-live-transport.js";
import {
  GHL_LIVE_CANARY_SAFETY_COPY,
  presentGhlLiveDeliveryRun,
} from "./ghl-live-canary.present.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { buildSourceEnrichmentDeliveryContext } from "../source-intake/source-enrichment.service.js";

export async function getLiveCanaryPreflightForPlan(planId: string) {
  await warmEffectiveDeliveryAdapterMode();
  const plan = await findDeliveryPlanById(planId);
  if (!plan) return { notFound: true as const };
  const preflight = await evaluateLiveCanaryPreflight(plan);
  return {
    preflight,
    safetyMessage: GHL_LIVE_CANARY_SAFETY_COPY,
    adapterMode: getGhlDeliveryAdapterMode(),
  };
}

export async function executeLiveCanaryForPlan(
  planId: string,
  input: LiveCanaryExecuteInput,
  deps?: GhlLiveHttpDeps
) {
  await warmEffectiveDeliveryAdapterMode();
  const plan = await findDeliveryPlanById(planId);
  if (!plan) return { notFound: true as const };

  const bodyErrors = validateLiveCanaryExecuteBody(input);
  if (bodyErrors.length > 0) {
    return { blocked: true as const, blockers: bodyErrors, statusCode: 400 };
  }

  const preflight = await evaluateLiveCanaryPreflight(plan);
  if (!preflight.canExecute) {
    return {
      blocked: true as const,
      blockers: preflight.blockers,
      preflight,
      statusCode: 409,
    };
  }

  const ctx = await loadLiveCanaryContext(plan);
  const startedAt = new Date();
  const idempotencyKey = ctx.idempotencyKey;

  const existing = await findGhlLiveDeliveryRunByIdempotencyKey(idempotencyKey);
  if (existing?.status === "succeeded") {
    return {
      skippedDuplicate: true as const,
      liveRun: presentGhlLiveDeliveryRun(existing),
      preflight,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
    };
  }

  await recordLiveCanaryOutcomeAudit({
    eventType: "live_canary_attempted",
    enabledBy: input.executedBy?.trim() || "admin_operator",
    metadata: { deliveryPlanId: plan.id },
  });

  const run = await createGhlLiveDeliveryRun({
    leadDeliveryPlan: { connect: { id: plan.id } },
    routingDryRunDecisionId: plan.routingDryRunDecisionId,
    campaignRoutingRuleId: ctx.rule?.id ?? null,
    masterClientAccountId: plan.masterClientAccountId,
    destinationClientAccountId: plan.destinationClientAccountId,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    mode: "live_canary",
    status: "executing",
    idempotencyKey,
    operatorConfirmationText: input.operatorConfirmationText.trim(),
    startedAt,
    executedBy: input.executedBy?.trim() || "admin_operator",
  });

  const sourceEnrichment = input.lifecyclePayload
    ? buildSourceEnrichmentDeliveryContext(
        input.lifecyclePayload,
        (await findClientAccountById(plan.destinationClientAccountId))?.ghlDestination ?? null,
        ctx.rule
      )
    : null;

  const adapterCtx: GhlAdapterPlanContext = {
    plan,
    rule: ctx.rule,
    destinationFieldMapping: ctx.destinationFieldMapping,
    sourceEnrichment: sourceEnrichment
      ? {
          sourceAttributes: sourceEnrichment.sourceAttributes,
          enrichmentStatus: sourceEnrichment.enrichmentStatus,
          automationReadiness: sourceEnrichment.automationReadiness,
          unmappedSourceFieldKeys: sourceEnrichment.unmappedSourceFieldKeys,
          sourceAttributeFieldMap: sourceEnrichment.sourceAttributeFieldMap,
          sourceEnrichmentPolicy: sourceEnrichment.sourceEnrichmentPolicy,
        }
      : null,
  };
  let execution;
  try {
    execution = await executeLiveCanaryGhlSteps(adapterCtx, idempotencyKey, deps);
  } catch (err) {
    const completedAt = new Date();
    const failed = await updateGhlLiveDeliveryRun(run.id, {
      status: "failed",
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      summary: "Live canary execution threw before completion.",
      errors: [err instanceof Error ? err.message : String(err)] as Prisma.InputJsonValue,
    });
    await recordLiveCanaryOutcomeAudit({
      eventType: "live_canary_failed",
      enabledBy: input.executedBy?.trim() || "admin_operator",
      reason: err instanceof Error ? err.message : String(err),
      metadata: { deliveryPlanId: plan.id, liveRunId: failed.id },
    });
    return {
      ok: false as const,
      liveRun: presentGhlLiveDeliveryRun(failed),
      preflight,
      safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
    };
  }

  const completedAt = new Date();
  const updated = await updateGhlLiveDeliveryRun(run.id, {
    status: execution.runStatus,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    summary: execution.summary,
    warnings: execution.warnings.length
      ? (execution.warnings as Prisma.InputJsonValue)
      : undefined,
    errors: execution.errors.length ? (execution.errors as Prisma.InputJsonValue) : undefined,
    stepRuns: {
      create: execution.stepOutcomes.map((s) => ({
        deliveryPlanStepId: s.deliveryPlanStepId,
        stepOrder: s.stepOrder,
        stepType: s.stepType,
        targetSystem: s.targetSystem,
        targetId: s.targetId,
        status: s.status,
        requestRedactedJson: s.requestRedactedJson ?? undefined,
        responseRedactedJson: s.responseRedactedJson ?? undefined,
        externalId: s.externalId,
        errorCode: s.errorCode,
        errorSummary: s.errorSummary,
        warnings: s.warnings.length ? (s.warnings as Prisma.InputJsonValue) : undefined,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    },
  });

  const auditEventType =
    execution.runStatus === "succeeded"
      ? "live_canary_succeeded"
      : execution.runStatus === "partial_success"
        ? "live_canary_partial_success"
        : "live_canary_failed";
  await recordLiveCanaryOutcomeAudit({
    eventType: auditEventType,
    enabledBy: input.executedBy?.trim() || "admin_operator",
    metadata: { deliveryPlanId: plan.id, liveRunId: updated.id, status: execution.runStatus },
  });

  return {
    ok: execution.runStatus === "succeeded",
    liveRun: presentGhlLiveDeliveryRun(updated),
    preflight,
    safetyMessage: GHL_LIVE_CANARY_SAFETY_MESSAGE,
    contactIdGhl: execution.contactIdGhl,
    opportunityIdGhl: execution.opportunityIdGhl,
    workflowStarted: execution.workflowStarted,
    externalCallExecuted: execution.stepOutcomes.some((s) => s.externalCallExecuted),
  };
}

export async function getGhlLiveDeliveryRunDetail(id: string) {
  const run = await findGhlLiveDeliveryRunById(id);
  if (!run) return { notFound: true as const };
  return {
    liveRun: presentGhlLiveDeliveryRun(run),
    safetyMessage: GHL_LIVE_CANARY_SAFETY_COPY,
  };
}

export async function listGhlLiveDeliveryRunsPresented(
  opts: Parameters<typeof listGhlLiveDeliveryRuns>[0]
) {
  const rows = await listGhlLiveDeliveryRuns(opts);
  return rows.map(presentGhlLiveDeliveryRun);
}

export async function markGhlLiveDeliveryRunRolledBack(
  id: string,
  notes?: string | null
) {
  const run = await findGhlLiveDeliveryRunById(id);
  if (!run) return { notFound: true as const };
  const updated = await updateGhlLiveDeliveryRun(id, {
    status: "rolled_back_manual",
    summary: notes?.trim()
      ? `Manual rollback noted: ${notes.trim()}`
      : "Operator marked manual rollback (GHL actions not undone).",
  });
  return { liveRun: presentGhlLiveDeliveryRun(updated) };
}
