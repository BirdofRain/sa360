import type { CompanySheetsDispatchIntent, PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS, COMPANY_SHEETS_INTENT_BUDGET_MS } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { isCompanyGoogleSheetsDispatchEnabled, isCompanyGoogleSheetsExecutionEnabled } from "../../lib/company-google-sheets-env.js";
import { logger } from "../../lib/logger.js";
import { loadAuthorizedAgedDeliverySet } from "../company-sheets-delivery/company-sheets-aged-authority.js";
import {
  enqueueAuthorizedAgedReleaseSheetsDelivery,
  enqueueConfirmedLeadSheetsDelivery,
  executeCompanySheetsDeliveryJob,
  type CompanySheetsDeliveryDeps,
} from "../company-sheets-delivery/company-sheets-delivery.service.js";

const STALE_PROCESSING_MS = 120_000;

/**
 * Enqueue results that must not be retried automatically.
 * A later order-status change does not promote them; an operator schedules explicitly.
 */
const BLOCKED_DISPATCH_CODES = new Set([
  "order_draft",
  "order_held",
  "order_revoked",
  "release_not_authorized",
  "order_client_mismatch",
  "csv_integrity_mismatch",
  "csv_empty",
  "row_count_mismatch",
  "export_not_found",
  "lead_not_found",
  "client_not_confirmed",
  "release_mutated",
  "lead_mutated",
  "destination_not_configured",
  "package_not_released",
]);

type DispatchFailure = { ok: false; code: string; statusCode: number };

function fail(code: string, statusCode = 409): DispatchFailure {
  return { ok: false, code, statusCode };
}

async function markIntent(
  db: PrismaClient,
  id: string,
  data: {
    status: string;
    jobId?: string | null;
    reason?: string | null;
    lastError?: string | null;
    availableAt?: Date;
  }
) {
  await db.companySheetsDispatchIntent.update({
    where: { id },
    data,
  });
}

async function enqueueForIntent(
  intent: CompanySheetsDispatchIntent,
  deps: CompanySheetsDeliveryDeps
) {
  if (intent.kind === "campaign_lead" && intent.sourceLeadEventId) {
    return enqueueConfirmedLeadSheetsDelivery(intent.sourceLeadEventId, {
      ...deps,
      scheduleWithoutExecution: true,
    });
  }
  if (intent.kind === "aged_release" && intent.exportPackageId) {
    return enqueueAuthorizedAgedReleaseSheetsDelivery(intent.exportPackageId, {
      ...deps,
      scheduleWithoutExecution: true,
    });
  }
  return fail("intent_incomplete", 409);
}

function terminalHold(intent: CompanySheetsDispatchIntent, code: string): "awaiting_setup" | "needs_explicit_schedule" | null {
  const setup = code === "tab_missing" || code === "tab_incompatible" || code === "schema_mismatch";
  if (intent.kind === "campaign_lead" && (setup || code === "destination_not_configured")) return "awaiting_setup";
  if (setup || BLOCKED_DISPATCH_CODES.has(code)) return "needs_explicit_schedule";
  return null;
}

async function handleClaimedIntent(
  intent: CompanySheetsDispatchIntent,
  deps: CompanySheetsDeliveryDeps,
  env: NodeJS.ProcessEnv,
  db: PrismaClient
): Promise<{ executed: boolean }> {
  const queued = await enqueueForIntent(intent, { ...deps, env, db });
  if (!queued.ok) {
    const hold = terminalHold(intent, queued.code);
    const setup = queued.code === "tab_missing" || queued.code === "tab_incompatible" || queued.code === "schema_mismatch";
    await markIntent(db, intent.id, {
      status: hold ?? "retryable",
      reason: hold === "needs_explicit_schedule" && setup && !intent.explicit ? "release_preceded_setup" : queued.code,
      lastError: queued.code,
      availableAt: hold ? undefined : new Date(Date.now() + 30_000),
    });
    return { executed: false };
  }
  if (queued.job.status === "succeeded") {
    await markIntent(db, intent.id, { status: "completed", jobId: queued.job.id, lastError: null, reason: null });
    return { executed: false };
  }
  if (queued.job.status === "uncertain") {
    await markIntent(db, intent.id, {
      status: "scheduled",
      jobId: queued.job.id,
      lastError: "uncertain",
      reason: "append_outcome_unresolved",
    });
    return { executed: false };
  }
  await markIntent(db, intent.id, { status: "scheduled", jobId: queued.job.id, lastError: null, reason: null });
  if (!isCompanyGoogleSheetsExecutionEnabled(env)) return { executed: false };
  const executed = await executeCompanySheetsDeliveryJob(queued.job.id, { ...deps, env, db });
  if (!executed.ok) {
    if (executed.code === "already_succeeded") {
      await markIntent(db, intent.id, { status: "completed", jobId: queued.job.id, lastError: null, reason: null });
      return { executed: false };
    }
    const held = executed.code === "uncertain" || executed.code === "already_running" || executed.code === "worksheet_busy";
    await markIntent(db, intent.id, {
      status: held ? "scheduled" : "retryable",
      jobId: queued.job.id,
      lastError: executed.code,
      reason: executed.code === "uncertain" ? "append_outcome_unresolved" : executed.code,
      availableAt: held ? new Date(Date.now() + 30_000) : new Date(Date.now() + 30_000),
    });
    return { executed: executed.code === "uncertain" };
  }
  await markIntent(db, intent.id, {
    status: executed.status === "succeeded" ? "completed" : "retryable",
    jobId: queued.job.id,
    lastError: executed.status === "succeeded" ? null : executed.status,
    reason: executed.status === "succeeded" ? null : executed.status,
    availableAt: executed.status === "succeeded" ? undefined : new Date(Date.now() + 30_000),
  });
  return { executed: true };
}

export async function processDueCompanySheetsDispatches(
  deps: CompanySheetsDeliveryDeps = {},
  limit = 20,
  trace: { requestId?: string } = {}
): Promise<{
  ok: true;
  processed: number;
  executed: number;
  deferred: number;
  durationMs: number;
  stopReason: "intent_budget" | null;
}> {
  const started = Date.now();
  const env = deps.env ?? process.env;
  const finish = (
    processed: number,
    executed: number,
    deferred: number,
    stopReason: "intent_budget" | null,
    outcome: "dispatch_disabled" | "completed" | "intent_budget"
  ) => {
    const durationMs = Date.now() - started;
    logger.info("company_sheets_dispatch.drain", {
      requestId: trace.requestId,
      durationMs,
      processed,
      executed,
      deferred,
      limit,
      stopReason,
      budgetMs: COMPANY_SHEETS_INTENT_BUDGET_MS,
      outcome,
    });
    return { ok: true as const, processed, executed, deferred, durationMs, stopReason };
  };
  if (!isCompanyGoogleSheetsDispatchEnabled(env)) return finish(0, 0, 0, null, "dispatch_disabled");
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const stale = new Date(now.getTime() - STALE_PROCESSING_MS);
  const due = await db.companySheetsDispatchIntent.findMany({
    where: {
      OR: [
        { status: { in: ["pending", "scheduled", "retryable"] }, availableAt: { lte: now } },
        { status: "processing", processingAt: { lt: stale } },
        { status: "awaiting_setup", kind: "campaign_lead" },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const executionEnabled = isCompanyGoogleSheetsExecutionEnabled(env);
  let processed = 0;
  let executed = 0;
  let executionsStarted = 0;
  let deferred = 0;
  let stopReason: "intent_budget" | null = null;
  for (let index = 0; index < due.length; index += 1) {
    if (executionEnabled && executionsStarted >= COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS) {
      stopReason = "intent_budget";
      deferred = due.length - index;
      break;
    }
    const intent = due[index];
    if (!intent) break;
    const claimed = await db.companySheetsDispatchIntent.updateMany({
      where: {
        id: intent.id,
        OR: [
          { status: intent.status, ...(intent.status === "processing" ? { processingAt: { lt: stale } } : {}) },
        ],
      },
      data: { status: "processing", processingAt: now, attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    if (executionEnabled) executionsStarted += 1;
    const outcome = await handleClaimedIntent(intent, deps, env, db);
    processed += 1;
    if (outcome.executed) executed += 1;
  }
  return finish(processed, executed, deferred, stopReason, stopReason ?? "completed");
}

export async function setCompanySheetsDispatchActivation(
  clientAccountId: string,
  input: { campaignEnabled?: boolean; agedEnabled?: boolean },
  deps: CompanySheetsDeliveryDeps = {}
): Promise<
  | {
      ok: true;
      campaignDispatchEnabled: boolean;
      campaignDispatchNotBefore: string | null;
      agedDispatchEnabled: boolean;
      agedDispatchNotBefore: string | null;
    }
  | DispatchFailure
> {
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: clientAccountId.trim() },
  });
  if (!destination) return fail("destination_missing", 404);
  const data: {
    campaignDispatchEnabled?: boolean;
    campaignDispatchNotBefore?: Date;
    agedDispatchEnabled?: boolean;
    agedDispatchNotBefore?: Date;
  } = {};
  if (input.campaignEnabled === true) {
    data.campaignDispatchEnabled = true;
    if (!destination.campaignDispatchNotBefore) data.campaignDispatchNotBefore = now;
  } else if (input.campaignEnabled === false) {
    data.campaignDispatchEnabled = false;
  }
  if (input.agedEnabled === true) {
    data.agedDispatchEnabled = true;
    if (!destination.agedDispatchNotBefore) data.agedDispatchNotBefore = now;
  } else if (input.agedEnabled === false) {
    data.agedDispatchEnabled = false;
  }
  const updated = await db.companySheetsDestination.update({ where: { id: destination.id }, data });
  return {
    ok: true,
    campaignDispatchEnabled: updated.campaignDispatchEnabled,
    campaignDispatchNotBefore: updated.campaignDispatchNotBefore?.toISOString() ?? null,
    agedDispatchEnabled: updated.agedDispatchEnabled,
    agedDispatchNotBefore: updated.agedDispatchNotBefore?.toISOString() ?? null,
  };
}

export async function scheduleAgedReleaseExplicitly(
  exportPackageId: string,
  actor: string | null,
  deps: CompanySheetsDeliveryDeps = {}
): Promise<{ ok: true; jobId: string; executed: false } | DispatchFailure> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsDispatchEnabled(env)) return fail("dispatch_disabled", 404);
  const db = deps.db ?? prisma;
  const loaded = await loadAuthorizedAgedDeliverySet(db, exportPackageId);
  if (!loaded.ok) return fail(loaded.code, loaded.code === "export_not_found" ? 404 : 409);
  const idempotencyKey = `release:${loaded.packageRow.clientAccountId}:${loaded.order.id}:${loaded.packageRow.id}`;
  const intent = await db.companySheetsDispatchIntent.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      kind: "aged_release",
      status: "pending",
      clientAccountId: loaded.packageRow.clientAccountId,
      exportPackageId: loaded.packageRow.id,
      leadOrderId: loaded.order.id,
      explicit: true,
      actor,
      reason: "explicit_schedule",
    },
    update: {
      status: "pending",
      explicit: true,
      actor,
      reason: "explicit_schedule",
      lastError: null,
      availableAt: new Date(),
    },
  });
  const queued = await enqueueAuthorizedAgedReleaseSheetsDelivery(loaded.packageRow.id, {
    ...deps,
    env,
    db,
    scheduleWithoutExecution: true,
  });
  if (!queued.ok) {
    const hold = terminalHold(intent, queued.code);
    await markIntent(db, intent.id, {
      status: hold ?? "retryable",
      reason: "explicit_schedule",
      lastError: queued.code,
    });
    return queued;
  }
  await markIntent(db, intent.id, {
    status: queued.job.status === "succeeded" ? "completed" : "scheduled",
    jobId: queued.job.id,
    reason: queued.job.status === "uncertain" ? "append_outcome_unresolved" : "explicit_schedule",
    lastError: queued.job.status === "uncertain" ? "uncertain" : null,
  });
  return { ok: true, jobId: queued.job.id, executed: false };
}

export async function getCompanySheetsDispatchStatus(
  clientAccountId: string,
  deps: CompanySheetsDeliveryDeps = {}
) {
  const db = deps.db ?? prisma;
  const id = clientAccountId.trim();
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: id } });
  const intents = destination
    ? await db.companySheetsDispatchIntent.findMany({
        where: { clientAccountId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  return {
    ok: true as const,
    configured: Boolean(destination),
    dispatchFlagEnabled: isCompanyGoogleSheetsDispatchEnabled(deps.env ?? process.env),
    campaignDispatchEnabled: destination?.campaignDispatchEnabled === true,
    campaignDispatchNotBefore: destination?.campaignDispatchNotBefore?.toISOString() ?? null,
    agedDispatchEnabled: destination?.agedDispatchEnabled === true,
    agedDispatchNotBefore: destination?.agedDispatchNotBefore?.toISOString() ?? null,
    intents: intents.map((intent) => ({
      id: intent.id,
      kind: intent.kind,
      status: intent.status,
      reason: intent.reason,
      explicit: intent.explicit,
      actor: intent.actor,
      jobId: intent.jobId,
      sourceLeadEventId: intent.sourceLeadEventId,
      exportPackageId: intent.exportPackageId,
      leadOrderId: intent.leadOrderId,
      lastError: intent.lastError,
      attemptCount: intent.attemptCount,
      createdAt: intent.createdAt.toISOString(),
    })),
  };
}
