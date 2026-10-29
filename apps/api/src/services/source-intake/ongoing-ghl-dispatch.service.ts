/**
 * Drains OngoingGhlDispatchIntent rows. HTTP happens here, never inside the
 * intake transaction. Runtime off leaves rows pending. A processing lease
 * that expires before a live run exists is retried. A run that may have
 * called GHL becomes uncertain and is not retried.
 */

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { isGhlLiveCanaryWriteAllowed } from "../../lib/ghl-delivery-adapter-mode.js";
import { warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import { activationSnapshotMatches } from "../ongoing-ghl-activation-rules.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  deliverOngoingAssociationFromIntake,
  ongoingRunBlocksAnotherWrite,
  ongoingThrowClass,
  type OngoingDeliveryResult,
  type OngoingRunSnapshot,
} from "./ongoing-ghl-delivery.service.js";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";

export const ONGOING_GHL_EXECUTION_LEASE_MS = 120_000;
const RETRY_DELAY_MS = 30_000;

export type OngoingIntentRow = {
  id: string;
  status: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  routingDryRunDecisionId: string | null;
  destinationLocationIdGhl: string;
  activationLocationIdGhl: string;
  activationWorkflowIdGhl: string | null;
  activationPipelineIdGhl: string | null;
  activationStageIdGhl: string | null;
  leadDeliveryPlanId: string | null;
  liveRunId: string | null;
  availableAt: Date;
  attemptCount: number;
  lastError: string | null;
  outcomeClass: string | null;
  processingAt: Date | null;
  createdAt: Date;
};

export type OngoingIntentPatch = Partial<
  Pick<
    OngoingIntentRow,
    | "status"
    | "leadDeliveryPlanId"
    | "liveRunId"
    | "availableAt"
    | "lastError"
    | "outcomeClass"
    | "processingAt"
    | "attemptCount"
  >
>;

export type OngoingDrainDeps = {
  now: () => Date;
  liveWritesAllowed: () => Promise<boolean>;
  listProcessing: (leaseCutoff: Date) => Promise<OngoingIntentRow[]>;
  listDue: (now: Date) => Promise<OngoingIntentRow[]>;
  claim: (id: string, now: Date) => Promise<boolean>;
  save: (id: string, patch: OngoingIntentPatch) => Promise<void>;
  loadRun: (liveRunId: string) => Promise<OngoingRunSnapshot | null>;
  activationStillMatches: (intent: OngoingIntentRow) => Promise<boolean>;
  executeIntent: (intent: OngoingIntentRow) => Promise<OngoingDeliveryResult>;
};

function settlement(result: OngoingDeliveryResult, now: Date): OngoingIntentPatch {
  const linked = {
    liveRunId: result.runId,
    leadDeliveryPlanId: result.planId,
  };
  if (result.outcome === "skipped" && result.reason === "runtime_not_live") {
    return { status: "pending", outcomeClass: null, lastError: "runtime_not_live", availableAt: now, ...linked };
  }
  if (
    (result.outcome === "executed" || result.outcome === "skipped_duplicate") &&
    result.outcomeClass === "delivered"
  ) {
    return { status: "completed", outcomeClass: "delivered", lastError: null, ...linked };
  }
  if (result.outcomeClass === "uncertain" || result.outcome === "failed_uncertain") {
    return { status: "uncertain", outcomeClass: "uncertain", lastError: result.reason, ...linked };
  }
  if (result.outcome === "skipped") {
    return { status: "blocked", outcomeClass: "pre_send", lastError: result.reason, ...linked };
  }
  return {
    status: "retryable",
    outcomeClass: "pre_send",
    lastError: result.reason,
    availableAt: new Date(now.getTime() + RETRY_DELAY_MS),
    ...linked,
  };
}

async function recoverExpired(deps: OngoingDrainDeps, now: Date): Promise<void> {
  const leaseCutoff = new Date(now.getTime() - ONGOING_GHL_EXECUTION_LEASE_MS);
  const stale = await deps.listProcessing(leaseCutoff);
  for (const intent of stale) {
    if (!intent.liveRunId) {
      await deps.save(intent.id, {
        status: "retryable",
        outcomeClass: "pre_send",
        lastError: "lease_expired_before_send",
        availableAt: now,
      });
      continue;
    }
    const run = await deps.loadRun(intent.liveRunId);
    if (run?.status === "succeeded") {
      await deps.save(intent.id, { status: "completed", outcomeClass: "delivered", lastError: null, liveRunId: run.id });
      continue;
    }
    if (run && !ongoingRunBlocksAnotherWrite(run) && run.status !== "executing") {
      await deps.save(intent.id, {
        status: "retryable",
        outcomeClass: "pre_send",
        lastError: "lease_expired_before_send",
        availableAt: now,
        liveRunId: run.id,
      });
      continue;
    }
    await deps.save(intent.id, {
      status: "uncertain",
      outcomeClass: "uncertain",
      lastError: "lease_expired_after_send_started",
      liveRunId: intent.liveRunId,
    });
  }
}

export async function processDueOngoingGhlDispatches(
  deps: OngoingDrainDeps,
  limit = 5
): Promise<{ ok: true; processed: number; executed: number; runtime: "live" | "off" }> {
  if (!(await deps.liveWritesAllowed())) {
    return { ok: true, processed: 0, executed: 0, runtime: "off" };
  }
  let processed = 0;
  let executed = 0;
  for (let index = 0; index < limit; index += 1) {
    const now = deps.now();
    await recoverExpired(deps, now);
    const due = await deps.listDue(deps.now());
    const next = due[0];
    if (!next) break;
    const claimed = await deps.claim(next.id, deps.now());
    if (!claimed) continue;
    processed += 1;
    try {
      if (!(await deps.activationStillMatches(next))) {
        await deps.save(next.id, {
          status: "blocked",
          outcomeClass: "pre_send",
          lastError: "stale_activation",
        });
        continue;
      }
      const result = await deps.executeIntent(next);
      if (result.outcome === "executed" || result.outcome === "failed_uncertain" || result.outcome === "failed_pre_send") {
        executed += 1;
      }
      await deps.save(next.id, settlement(result, deps.now()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcomeClass = ongoingThrowClass(message);
      await deps.save(
        next.id,
        outcomeClass === "pre_send"
          ? {
              status: "retryable",
              outcomeClass: "pre_send",
              lastError: message.slice(0, 500),
              availableAt: new Date(deps.now().getTime() + RETRY_DELAY_MS),
            }
          : { status: "uncertain", outcomeClass: "uncertain", lastError: message.slice(0, 500) }
      );
    }
  }
  return { ok: true, processed, executed, runtime: "live" };
}

function routingFromJson(value: unknown): {
  matched: boolean;
  matchedRuleId: string | null;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  routingDryRunDecisionId: string | null;
  routingAuthority: string | null;
} {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    matched: row.matched === true,
    matchedRuleId: text("matchedRuleId"),
    destinationClientAccountId: text("destinationClientAccountId"),
    destinationLocationIdGhl: text("destinationLocationIdGhl"),
    routingDryRunDecisionId: text("routingDryRunDecisionId"),
    routingAuthority: text("routingAuthority"),
  };
}

async function productionExecute(intent: OngoingIntentRow): Promise<OngoingDeliveryResult> {
  const lead = await prisma.sourceLeadEvent.findUnique({ where: { id: intent.sourceLeadEventId } });
  if (!lead) {
    return {
      outcome: "skipped",
      outcomeClass: null,
      reason: "lead_missing",
      planId: null,
      runId: null,
      runStatus: null,
      omittedWarnings: [],
    };
  }
  const duplicate = Boolean(
    lead.duplicateRiskJson &&
      typeof lead.duplicateRiskJson === "object" &&
      (lead.duplicateRiskJson as { blocksLiveDelivery?: unknown }).blocksLiveDelivery === true
  );
  return deliverOngoingAssociationFromIntake({
    sourceLeadEventId: lead.id,
    status: lead.status,
    routing: routingFromJson(lead.routingResultJson),
    duplicateBlocksLiveDelivery: duplicate,
    lifecyclePayload: (lead.normalizedPayloadJson ?? null) as LifecycleEventSchema | null,
  });
}

async function productionActivationMatches(intent: OngoingIntentRow): Promise<boolean> {
  const client = await findClientAccountById(intent.clientAccountId);
  const destination = client?.ghlDestination;
  if (!destination) return false;
  if (destination.destinationSubaccountIdGhl.trim() !== intent.destinationLocationIdGhl) return false;
  if ((destination.activationLocationIdGhl ?? "") !== intent.activationLocationIdGhl) return false;
  if ((destination.activationWorkflowIdGhl ?? null) !== intent.activationWorkflowIdGhl) return false;
  if ((destination.activationPipelineIdGhl ?? null) !== intent.activationPipelineIdGhl) return false;
  if ((destination.activationStageIdGhl ?? null) !== intent.activationStageIdGhl) return false;
  return activationSnapshotMatches({
    destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
    workflowTriggerMode: destination.workflowTriggerMode,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
    activationLocationIdGhl: destination.activationLocationIdGhl,
    activationWorkflowIdGhl: destination.activationWorkflowIdGhl,
    activationPipelineIdGhl: destination.activationPipelineIdGhl,
    activationStageIdGhl: destination.activationStageIdGhl,
    ongoingDeliveryNotBefore: destination.ongoingDeliveryNotBefore,
  });
}

function rowFromDb(row: {
  id: string;
  status: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  routingDryRunDecisionId: string | null;
  destinationLocationIdGhl: string;
  activationLocationIdGhl: string;
  activationWorkflowIdGhl: string | null;
  activationPipelineIdGhl: string | null;
  activationStageIdGhl: string | null;
  leadDeliveryPlanId: string | null;
  liveRunId: string | null;
  availableAt: Date;
  attemptCount: number;
  lastError: string | null;
  outcomeClass: string | null;
  processingAt: Date | null;
  createdAt: Date;
}): OngoingIntentRow {
  return row;
}

export function productionOngoingDrainDeps(): OngoingDrainDeps {
  return {
    now: () => new Date(),
    liveWritesAllowed: async () => {
      await warmEffectiveDeliveryAdapterMode();
      return isGhlLiveCanaryWriteAllowed();
    },
    listProcessing: async (leaseCutoff) => {
      const rows = await prisma.ongoingGhlDispatchIntent.findMany({
        where: {
          status: "processing",
          OR: [{ processingAt: null }, { processingAt: { lt: leaseCutoff } }],
        },
      });
      return rows.map(rowFromDb);
    },
    listDue: async (now) => {
      const rows = await prisma.ongoingGhlDispatchIntent.findMany({
        where: { status: { in: ["pending", "retryable"] }, availableAt: { lte: now } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
      });
      return rows.map(rowFromDb);
    },
    claim: async (id, now) => {
      const claimed = await prisma.ongoingGhlDispatchIntent.updateMany({
        where: { id, status: { in: ["pending", "retryable"] } },
        data: { status: "processing", processingAt: now, attemptCount: { increment: 1 } },
      });
      return claimed.count === 1;
    },
    save: async (id, patch) => {
      await prisma.ongoingGhlDispatchIntent.update({ where: { id }, data: patch });
    },
    loadRun: async (liveRunId) => {
      const run = await prisma.ghlLiveDeliveryRun.findUnique({
        where: { id: liveRunId },
        include: { stepRuns: true },
      });
      if (!run) return null;
      return {
        id: run.id,
        status: run.status,
        stepRuns: run.stepRuns.map((step) => ({ responseRedactedJson: step.responseRedactedJson })),
      };
    },
    activationStillMatches: productionActivationMatches,
    executeIntent: productionExecute,
  };
}

export async function processDueOngoingGhlDispatchesFromDb(limit = 5) {
  return processDueOngoingGhlDispatches(productionOngoingDrainDeps(), limit);
}

export type ReconcileOngoingResult =
  | {
      ok: true;
      requeued: number;
      staleSkipped: number;
      uncertainLeft: number;
      reviewed: number;
    }
  | { notFound: true }
  | { ok: false; code: "CONFIRMATION_REQUIRED" | "DESTINATION_NOT_AUTHORIZED"; error: string };

export async function reconcileOngoingGhlDelivery(input: {
  clientAccountId: string;
  confirmLiveDeliveryRisk: boolean;
  action: "requeue_pre_send" | "mark_reviewed";
  actorLabel?: string | null;
}): Promise<ReconcileOngoingResult> {
  if (input.confirmLiveDeliveryRisk !== true) {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      error: "confirmLiveDeliveryRisk must be true. Reconciliation does not send a lead by itself.",
    };
  }
  const clientAccountId = input.clientAccountId.trim();
  const client = await findClientAccountById(clientAccountId);
  if (!client?.ghlDestination) return { notFound: true };
  const destination = client.ghlDestination;
  const uncertainLeft = await prisma.ongoingGhlDispatchIntent.count({
    where: { clientAccountId, status: "uncertain" },
  });
  if (input.action === "mark_reviewed") {
    await prisma.clientOnboardingV2AuditEvent.create({
      data: {
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        requestId: `ghl-ongoing-review:${randomUUID()}`,
        action: "ghl_ongoing_uncertain_reviewed",
        actorLabel: input.actorLabel?.trim() || null,
        auth: "admin_api_key",
        destinations: [],
        metadataJson: { uncertainLeft, sendsLead: false },
      },
    });
    return { ok: true, requeued: 0, staleSkipped: 0, uncertainLeft, reviewed: uncertainLeft };
  }
  const authorized =
    destination.deliveryEnabled === true &&
    destination.ongoingDeliveryNotBefore != null &&
    activationSnapshotMatches({
      destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
      destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
      workflowTriggerMode: destination.workflowTriggerMode,
      opportunityCreationEnabled: destination.opportunityCreationEnabled,
      destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
      destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
      activationLocationIdGhl: destination.activationLocationIdGhl,
      activationWorkflowIdGhl: destination.activationWorkflowIdGhl,
      activationPipelineIdGhl: destination.activationPipelineIdGhl,
      activationStageIdGhl: destination.activationStageIdGhl,
      ongoingDeliveryNotBefore: destination.ongoingDeliveryNotBefore,
    });
  if (!authorized || !destination.ongoingDeliveryNotBefore) {
    return {
      ok: false,
      code: "DESTINATION_NOT_AUTHORIZED",
      error: "Requeue is available only while this destination's activation still matches.",
    };
  }
  const rows = await prisma.ongoingGhlDispatchIntent.findMany({
    where: {
      clientAccountId,
      status: { in: ["retryable", "blocked"] },
      outcomeClass: "pre_send",
      createdAt: { gte: destination.ongoingDeliveryNotBefore },
    },
  });
  let requeued = 0;
  let staleSkipped = 0;
  const now = new Date();
  for (const row of rows) {
    const sameActivation =
      row.activationLocationIdGhl === (destination.activationLocationIdGhl ?? "") &&
      row.activationWorkflowIdGhl === destination.activationWorkflowIdGhl &&
      row.activationPipelineIdGhl === destination.activationPipelineIdGhl &&
      row.activationStageIdGhl === destination.activationStageIdGhl;
    if (!sameActivation) {
      staleSkipped += 1;
      continue;
    }
    await prisma.ongoingGhlDispatchIntent.update({
      where: { id: row.id },
      data: { status: "pending", availableAt: now, outcomeClass: "pre_send" },
    });
    requeued += 1;
  }
  await prisma.clientOnboardingV2AuditEvent.create({
    data: {
      clientAccountId,
      historicalClientAccountId: clientAccountId,
        requestId: `ghl-ongoing-requeue:${randomUUID()}`,
      action: "ghl_ongoing_pre_send_requeued",
      actorLabel: input.actorLabel?.trim() || null,
      auth: "admin_api_key",
      destinations: [],
      metadataJson: { requeued, staleSkipped, uncertainLeft, sendsLead: false } as Prisma.InputJsonObject,
    },
  });
  return { ok: true, requeued, staleSkipped, uncertainLeft, reviewed: 0 };
}
