/**
 * Ongoing GHL delivery for a confirmed parent-URL association.
 *
 * Intake calls this only after the lead and the Sheets schedule row have
 * committed. A failure here cannot roll that work back and cannot cause a
 * second Sheets write. Campaign-rule clients are ignored. Authorization is the
 * saved ClientGhlDestination, not an environment allowlist and not a per-lead
 * confirmation. The global runtime mode remains the kill switch.
 */

import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { logger } from "../../lib/logger.js";
import { isGhlLiveCanaryWriteAllowed } from "../../lib/ghl-delivery-adapter-mode.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findDeliveryPlanByRoutingDecisionId } from "../../repositories/lead-delivery-plan.repository.js";
import {
  createGhlLiveDeliveryRun,
  findGhlLiveDeliveryRunByIdempotencyKey,
  updateGhlLiveDeliveryRun,
} from "../../repositories/ghl-live-delivery-run.repository.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "../routing-source-association.service.js";
import { persistedCampaignRoutingRuleId } from "../association-ghl-delivery-source.js";
import { generateDirectCanaryDeliveryPlanForDecision } from "../lead-delivery-plan.service.js";
import { warmEffectiveDeliveryAdapterMode, recordLiveCanaryOutcomeAudit } from "../delivery-runtime-mode.service.js";
import {
  buildSourceEnrichmentDeliveryContext,
  parseSourceAttributeFieldMapJson,
} from "./source-enrichment.service.js";
import { loadLiveCanaryContext } from "../ghl-delivery-adapter/ghl-live-canary-gates.service.js";
import { executeLiveCanaryGhlSteps } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";
import { buildLiveCanaryIdempotencyKey } from "../ghl-delivery-adapter/ghl-live-transport.js";
import type { LiveCanaryExecutionResult } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";

const BLOCKED_PLAN_STATUSES = new Set(["blocked", "needs_config"]);

export type OngoingGhlDestinationAuth = {
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  ghlConnectionStatus: string | null;
  deliveryEnabled: boolean;
  deliveryMode: string;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  destinationWorkflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  opportunityCreationEnabled: boolean;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  sourceAttributeFieldMapJson: unknown;
};

export type OngoingDeliveryPlanRef = {
  id: string;
  status: string;
  planVersion: string;
  masterClientAccountId: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  sourceLeadUid: string | null;
  sourceEmail: string | null;
  sourcePhoneE164: string | null;
  routingDryRunDecisionId: string | null;
};

export type OngoingRunSnapshot = {
  id: string;
  status: string;
  stepRuns: Array<{ responseRedactedJson?: unknown; externalCallExecuted?: boolean }>;
};

export type OngoingAssociationDeliveryInput = {
  sourceLeadEventId: string;
  status: string;
  routing: {
    matched: boolean;
    matchedRuleId?: string | null;
    destinationClientAccountId?: string | null;
    destinationLocationIdGhl?: string | null;
    routingDryRunDecisionId?: string | null;
    routingAuthority?: string | null;
  };
  duplicateBlocksLiveDelivery: boolean;
  email: string | null;
  phone: string | null;
  attributeKeys: string[];
};

export type OngoingDeliveryResult = {
  outcome: "skipped" | "executed" | "skipped_duplicate" | "failed_uncertain";
  reason: string;
  planId: string | null;
  runId: string | null;
  runStatus: string | null;
  omittedWarnings: string[];
};

export type OngoingGhlDeliveryDeps = {
  findDestination: (clientAccountId: string) => Promise<OngoingGhlDestinationAuth | null>;
  liveWritesAllowed: () => Promise<boolean>;
  findPlan: (decisionId: string) => Promise<OngoingDeliveryPlanRef | null>;
  generatePlan: (
    decisionId: string
  ) => Promise<{ plan: OngoingDeliveryPlanRef } | { notFound: true } | { blocked: string }>;
  findRun: (idempotencyKey: string) => Promise<OngoingRunSnapshot | null>;
  createRun: (input: {
    plan: OngoingDeliveryPlanRef;
    idempotencyKey: string;
    startedAt: Date;
  }) => Promise<OngoingRunSnapshot>;
  reuseRun: (id: string) => Promise<OngoingRunSnapshot>;
  execute: (
    plan: OngoingDeliveryPlanRef,
    idempotencyKey: string
  ) => Promise<LiveCanaryExecutionResult>;
  completeRun: (
    id: string,
    startedAt: Date,
    execution: LiveCanaryExecutionResult,
    omittedWarnings: string[]
  ) => Promise<void>;
  failRun: (id: string, startedAt: Date, message: string) => Promise<void>;
  now: () => Date;
};

export function persistedGhlDestinationAuthorized(
  destination: OngoingGhlDestinationAuth | null | undefined
): boolean {
  if (!destination) return false;
  return (
    destination.deliveryEnabled === true &&
    destination.deliveryMode === "live" &&
    destination.clientCutoverApproved === true &&
    destination.internalApprovalStatus === "approved" &&
    destination.ghlConnectionStatus === "connected" &&
    Boolean(destination.destinationSubaccountIdGhl.trim()) &&
    destination.clientAccountId.trim().length > 0
  );
}

export function ongoingDeliveryPayloadBlockers(destination: OngoingGhlDestinationAuth, input: {
  email: string | null;
  phone: string | null;
}): string[] {
  const blockers: string[] = [];
  if (!input.email?.trim() && !input.phone?.trim()) blockers.push("missing_contact_channel");
  const mode = destination.workflowTriggerMode?.trim() || "tag_trigger";
  if (mode !== "none" && !destination.destinationWorkflowIdGhl?.trim()) {
    blockers.push("workflow_not_selected");
  }
  if (
    destination.opportunityCreationEnabled &&
    (!destination.destinationPipelineIdGhl?.trim() || !destination.destinationPipelineStageIdGhl?.trim())
  ) {
    blockers.push("opportunity_pipeline_incomplete");
  }
  return blockers;
}

export function ghlOmissionWarnings(mapJson: unknown, attributeKeys: string[]): string[] {
  const mapped = new Set(Object.keys(parseSourceAttributeFieldMapJson(mapJson)));
  const keys = [...new Set(attributeKeys.map((key) => key.trim()).filter(Boolean))];
  if (mapped.size === 0) {
    const listed = keys.length > 0 ? keys.join(", ") : "primary_reason";
    return [`GHL field map is empty. These answers were not written: ${listed}.`];
  }
  const omitted = keys.filter((key) => !mapped.has(key));
  if (omitted.length === 0) return [];
  return [`Omitted from GHL because no field is mapped: ${omitted.join(", ")}.`];
}

export function stepRecordedExternalCall(step: {
  responseRedactedJson?: unknown;
  externalCallExecuted?: boolean;
}): boolean {
  if (step.externalCallExecuted === true) return true;
  const json = step.responseRedactedJson;
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  return (json as Record<string, unknown>).externalCallExecuted === true;
}

/** Succeeded, partial, in-flight, or any write that may have reached GHL. */
export function ongoingRunBlocksAnotherWrite(run: OngoingRunSnapshot | null): boolean {
  if (!run) return false;
  if (run.status === "succeeded" || run.status === "partial_success" || run.status === "executing") {
    return true;
  }
  if (run.status === "failed") {
    if (run.stepRuns.length === 0) return true;
    return run.stepRuns.some(stepRecordedExternalCall);
  }
  return false;
}

export function contactChannelsFromLifecycle(payload: LifecycleEventSchema | null | undefined): {
  email: string | null;
  phone: string | null;
} {
  const contact = payload?.contact;
  const email = contact?.email?.trim() || null;
  const phone = contact?.phone_e164?.trim() || null;
  return { email, phone };
}

export function sourceAttributeKeysFromLifecycle(payload: LifecycleEventSchema | null | undefined): string[] {
  const intake = payload?.routing?.source_intake as
    | { sourceAttributes?: Record<string, unknown> }
    | undefined;
  const attributes = intake?.sourceAttributes;
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return [];
  return Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key]) => key);
}

function isConfirmedAssociation(input: OngoingAssociationDeliveryInput): boolean {
  const ruleId = input.routing.matchedRuleId?.trim() ?? "";
  return (
    input.routing.matched === true &&
    ruleId.length === 0 &&
    input.routing.routingAuthority === ROUTING_AUTHORITY_SOURCE_ASSOCIATION &&
    Boolean(input.routing.routingDryRunDecisionId?.trim()) &&
    Boolean(input.routing.destinationClientAccountId?.trim())
  );
}

function skip(reason: string, omittedWarnings: string[] = []): OngoingDeliveryResult {
  return {
    outcome: "skipped",
    reason,
    planId: null,
    runId: null,
    runStatus: null,
    omittedWarnings,
  };
}

function isUniqueConflict(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002");
}

export async function deliverOngoingAssociationLead(
  input: OngoingAssociationDeliveryInput,
  deps: OngoingGhlDeliveryDeps
): Promise<OngoingDeliveryResult> {
  if (input.status !== "routing_matched") return skip("not_routing_matched");
  if (!isConfirmedAssociation(input)) return skip("not_confirmed_association");
  if (input.duplicateBlocksLiveDelivery) return skip("duplicate_blocks_live");

  const clientAccountId = input.routing.destinationClientAccountId!.trim();
  const decisionLocation = input.routing.destinationLocationIdGhl?.trim() ?? "";
  const destination = await deps.findDestination(clientAccountId);
  if (!persistedGhlDestinationAuthorized(destination) || !destination) {
    return skip("destination_not_authorized");
  }
  if (destination.clientAccountId.trim() !== clientAccountId) return skip("client_mismatch");
  if (!decisionLocation || decisionLocation !== destination.destinationSubaccountIdGhl.trim()) {
    return skip("location_mismatch");
  }
  const payloadBlockers = ongoingDeliveryPayloadBlockers(destination, input);
  if (payloadBlockers.length > 0) return skip(payloadBlockers.join(","));
  if (!(await deps.liveWritesAllowed())) return skip("runtime_not_live");

  const omittedWarnings = ghlOmissionWarnings(
    destination.sourceAttributeFieldMapJson,
    input.attributeKeys
  );
  const decisionId = input.routing.routingDryRunDecisionId!.trim();
  let plan = await deps.findPlan(decisionId);
  if (!plan) {
    const generated = await deps.generatePlan(decisionId);
    if ("notFound" in generated) return skip("decision_not_found", omittedWarnings);
    if ("blocked" in generated) return skip(generated.blocked, omittedWarnings);
    plan = (await deps.findPlan(decisionId)) ?? generated.plan;
  }
  if (
    plan.destinationClientAccountId.trim() !== clientAccountId ||
    plan.destinationSubaccountIdGhl.trim() !== destination.destinationSubaccountIdGhl.trim()
  ) {
    return skip("plan_destination_mismatch", omittedWarnings);
  }
  if (BLOCKED_PLAN_STATUSES.has(plan.status)) return skip(`plan_${plan.status}`, omittedWarnings);

  const idempotencyKey = buildLiveCanaryIdempotencyKey({
    deliveryPlanId: plan.id,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    sourceLeadUid: plan.sourceLeadUid,
    sourceEmail: plan.sourceEmail,
    sourcePhoneE164: plan.sourcePhoneE164,
    planVersion: plan.planVersion,
  });
  const startedAt = deps.now();
  let run = await deps.findRun(idempotencyKey);
  if (ongoingRunBlocksAnotherWrite(run)) {
    return {
      outcome: "skipped_duplicate",
      reason: "prior_write",
      planId: plan.id,
      runId: run?.id ?? null,
      runStatus: run?.status ?? null,
      omittedWarnings,
    };
  }
  if (run) {
    run = await deps.reuseRun(run.id);
  } else {
    try {
      run = await deps.createRun({ plan, idempotencyKey, startedAt });
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;
      run = await deps.findRun(idempotencyKey);
      if (!run || ongoingRunBlocksAnotherWrite(run)) {
        return {
          outcome: "skipped_duplicate",
          reason: "prior_write",
          planId: plan.id,
          runId: run?.id ?? null,
          runStatus: run?.status ?? null,
          omittedWarnings,
        };
      }
      run = await deps.reuseRun(run.id);
    }
  }

  let execution: LiveCanaryExecutionResult;
  try {
    execution = await deps.execute(plan, idempotencyKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.failRun(run.id, startedAt, message);
    return {
      outcome: "failed_uncertain",
      reason: "execution_threw",
      planId: plan.id,
      runId: run.id,
      runStatus: "failed",
      omittedWarnings,
    };
  }
  await deps.completeRun(run.id, startedAt, execution, omittedWarnings);
  return {
    outcome: "executed",
    reason: execution.runStatus,
    planId: plan.id,
    runId: run.id,
    runStatus: execution.runStatus,
    omittedWarnings,
  };
}

async function auditOngoingOutcome(input: {
  eventType: "live_canary_attempted" | "live_canary_succeeded" | "live_canary_partial_success" | "live_canary_failed";
  reason?: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordLiveCanaryOutcomeAudit({
      eventType: input.eventType,
      enabledBy: "ongoing_association_delivery",
      reason: input.reason,
      metadata: input.metadata,
    });
  } catch (err) {
    logger.warn("ongoing_ghl.audit_failed", {
      eventType: input.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function destinationAuthFromClient(
  clientAccountId: string,
  destination: NonNullable<Awaited<ReturnType<typeof findClientAccountById>>>["ghlDestination"]
): OngoingGhlDestinationAuth | null {
  if (!destination) return null;
  return {
    clientAccountId,
    destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    ghlConnectionStatus: destination.ghlConnectionStatus,
    deliveryEnabled: destination.deliveryEnabled,
    deliveryMode: destination.deliveryMode,
    clientCutoverApproved: destination.clientCutoverApproved,
    internalApprovalStatus: destination.internalApprovalStatus,
    destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
    workflowTriggerMode: destination.workflowTriggerMode,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
    sourceAttributeFieldMapJson: destination.sourceAttributeFieldMapJson,
  };
}

function planRef(plan: {
  id: string;
  status: string;
  planVersion: string;
  masterClientAccountId: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  sourceLeadUid: string | null;
  sourceEmail: string | null;
  sourcePhoneE164: string | null;
  routingDryRunDecisionId: string | null;
}): OngoingDeliveryPlanRef {
  return {
    id: plan.id,
    status: plan.status,
    planVersion: plan.planVersion,
    masterClientAccountId: plan.masterClientAccountId,
    destinationClientAccountId: plan.destinationClientAccountId,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    sourceLeadUid: plan.sourceLeadUid,
    sourceEmail: plan.sourceEmail,
    sourcePhoneE164: plan.sourcePhoneE164,
    routingDryRunDecisionId: plan.routingDryRunDecisionId,
  };
}

/**
 * Production wiring. Creates a plan only after the destination is authorized
 * and the global runtime allows a live write, so inactive clients are not
 * backfilled when this hook starts running.
 */
export async function deliverOngoingAssociationFromIntake(input: {
  sourceLeadEventId: string;
  status: string;
  routing: OngoingAssociationDeliveryInput["routing"];
  duplicateBlocksLiveDelivery: boolean;
  lifecyclePayload: LifecycleEventSchema | null;
}): Promise<OngoingDeliveryResult> {
  const channels = contactChannelsFromLifecycle(input.lifecyclePayload);
  const result = await deliverOngoingAssociationLead(
    {
      sourceLeadEventId: input.sourceLeadEventId,
      status: input.status,
      routing: input.routing,
      duplicateBlocksLiveDelivery: input.duplicateBlocksLiveDelivery,
      email: channels.email,
      phone: channels.phone,
      attributeKeys: sourceAttributeKeysFromLifecycle(input.lifecyclePayload),
    },
    {
      findDestination: async (clientAccountId) => {
        const client = await findClientAccountById(clientAccountId);
        if (!client) return null;
        return destinationAuthFromClient(client.clientAccountId, client.ghlDestination);
      },
      liveWritesAllowed: async () => {
        await warmEffectiveDeliveryAdapterMode();
        return isGhlLiveCanaryWriteAllowed();
      },
      findPlan: async (decisionId) => {
        const plan = await findDeliveryPlanByRoutingDecisionId(decisionId);
        return plan ? planRef(plan) : null;
      },
      generatePlan: async (decisionId) => {
        const generated = await generateDirectCanaryDeliveryPlanForDecision(decisionId);
        if ("notFound" in generated) return { notFound: true };
        if ("blocked" in generated) return { blocked: generated.blocked };
        return { plan: planRef(generated.plan) };
      },
      findRun: async (idempotencyKey) => {
        const run = await findGhlLiveDeliveryRunByIdempotencyKey(idempotencyKey);
        if (!run) return null;
        return {
          id: run.id,
          status: run.status,
          stepRuns: run.stepRuns.map((step) => ({
            responseRedactedJson: step.responseRedactedJson,
          })),
        };
      },
      createRun: async ({ plan, idempotencyKey, startedAt }) => {
        const full = await findDeliveryPlanByRoutingDecisionId(
          plan.routingDryRunDecisionId?.trim() || ""
        );
        const rule = full ? (await loadLiveCanaryContext(full)).rule : null;
        const run = await createGhlLiveDeliveryRun({
          leadDeliveryPlan: { connect: { id: plan.id } },
          routingDryRunDecisionId: plan.routingDryRunDecisionId,
          campaignRoutingRuleId: persistedCampaignRoutingRuleId(rule),
          masterClientAccountId: plan.masterClientAccountId,
          destinationClientAccountId: plan.destinationClientAccountId,
          destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
          mode: "live_canary",
          status: "executing",
          idempotencyKey,
          operatorConfirmationText: null,
          startedAt,
          executedBy: "ongoing_association_delivery",
        });
        await auditOngoingOutcome({
          eventType: "live_canary_attempted",
          metadata: {
            deliveryPlanId: plan.id,
            destinationClientAccountId: plan.destinationClientAccountId,
            sourceLeadEventId: input.sourceLeadEventId,
          },
        });
        return { id: run.id, status: run.status, stepRuns: [] };
      },
      reuseRun: async (id) => {
        const run = await updateGhlLiveDeliveryRun(id, {
          status: "executing",
          completedAt: null,
          summary: null,
          errors: Prisma.DbNull,
          warnings: Prisma.DbNull,
          stepRuns: { deleteMany: {} },
          executedBy: "ongoing_association_delivery",
        });
        return { id: run.id, status: run.status, stepRuns: [] };
      },
      execute: async (plan, idempotencyKey) => {
        const full = await findDeliveryPlanByRoutingDecisionId(
          plan.routingDryRunDecisionId?.trim() || ""
        );
        if (!full) throw new Error("Delivery plan disappeared before the GHL write.");
        const ctx = await loadLiveCanaryContext(full);
        const client = await findClientAccountById(plan.destinationClientAccountId);
        const enrichment = input.lifecyclePayload
          ? buildSourceEnrichmentDeliveryContext(
              input.lifecyclePayload,
              client?.ghlDestination ?? null,
              ctx.rule
            )
          : null;
        return executeLiveCanaryGhlSteps(
          {
            plan: full,
            rule: ctx.rule,
            destinationFieldMapping: ctx.destinationFieldMapping,
            sourceEnrichment: enrichment
              ? {
                  sourceAttributes: enrichment.sourceAttributes,
                  enrichmentStatus: enrichment.enrichmentStatus,
                  automationReadiness: enrichment.automationReadiness,
                  unmappedSourceFieldKeys: enrichment.unmappedSourceFieldKeys,
                  sourceAttributeFieldMap: enrichment.sourceAttributeFieldMap,
                  sourceEnrichmentPolicy: enrichment.sourceEnrichmentPolicy,
                }
              : null,
          },
          idempotencyKey
        );
      },
      completeRun: async (id, startedAt, execution, omittedWarnings) => {
        const completedAt = new Date();
        const warnings = [...execution.warnings, ...omittedWarnings];
        await updateGhlLiveDeliveryRun(id, {
          status: execution.runStatus,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          summary: execution.summary,
          warnings: warnings.length ? (warnings as PrismaTypes.InputJsonValue) : undefined,
          errors: execution.errors.length
            ? (execution.errors as PrismaTypes.InputJsonValue)
            : undefined,
          stepRuns: {
            create: execution.stepOutcomes.map((step) => ({
              deliveryPlanStepId: step.deliveryPlanStepId,
              stepOrder: step.stepOrder,
              stepType: step.stepType,
              targetSystem: step.targetSystem,
              targetId: step.targetId,
              status: step.status,
              requestRedactedJson: step.requestRedactedJson ?? undefined,
              responseRedactedJson: step.responseRedactedJson ?? undefined,
              externalId: step.externalId,
              errorCode: step.errorCode,
              errorSummary: step.errorSummary,
              warnings: step.warnings.length ? (step.warnings as PrismaTypes.InputJsonValue) : undefined,
              startedAt: step.startedAt,
              completedAt: step.completedAt,
            })),
          },
        });
        const eventType =
          execution.runStatus === "succeeded"
            ? "live_canary_succeeded"
            : execution.runStatus === "partial_success"
              ? "live_canary_partial_success"
              : "live_canary_failed";
        await auditOngoingOutcome({
          eventType,
          metadata: { liveRunId: id, status: execution.runStatus },
        });
      },
      failRun: async (id, startedAt, message) => {
        const completedAt = new Date();
        await updateGhlLiveDeliveryRun(id, {
          status: "failed",
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          summary:
            "uncertain_outcome: execution threw before a step result was saved. This run will not be retried.",
          errors: [message] as PrismaTypes.InputJsonValue,
        });
        await auditOngoingOutcome({
          eventType: "live_canary_failed",
          reason: message,
          metadata: { liveRunId: id, uncertainOutcome: true },
        });
      },
      now: () => new Date(),
    }
  );
  logger.info("ongoing_ghl.result", {
    sourceLeadEventId: input.sourceLeadEventId,
    outcome: result.outcome,
    reason: result.reason,
    planId: result.planId,
    runId: result.runId,
    runStatus: result.runStatus,
    omittedWarningCount: result.omittedWarnings.length,
  });
  return result;
}
