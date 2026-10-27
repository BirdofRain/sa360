import type { CompanySheetsDispatchIntent, Prisma, PrismaClient } from "@prisma/client";
import {
  COMPANY_SHEETS_DRAIN_SAFETY_CAP,
  COMPANY_SHEETS_EXECUTION_LEASE_MS,
  COMPANY_SHEETS_INTENT_BUDGET_MS,
} from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { isCompanyGoogleSheetsDispatchEnabled, isCompanyGoogleSheetsExecutionEnabled } from "../../lib/company-google-sheets-env.js";
import { logger } from "../../lib/logger.js";
import { loadAuthorizedAgedDeliverySet } from "../company-sheets-delivery/company-sheets-aged-authority.js";
import {
  enqueueAuthorizedAgedReleaseSheetsDelivery,
  enqueueConfirmedLeadSheetsDelivery,
  executeCompanySheetsDeliveryJob,
  settleStaleCompanySheetsRun,
  type CompanySheetsDeliveryDeps,
} from "../company-sheets-delivery/company-sheets-delivery.service.js";

const DRAIN_ADVISORY_KEY = "company_sheets_dispatch_drain";
const CLAIM_MAX_WAIT_MS = 2_000;
const CLAIM_TIMEOUT_MS = 5_000;

type DrainStopReason = "time_budget" | "execution_in_flight" | null;

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

function campaignSetupHold(code: string): boolean {
  return (
    code === "tab_missing" ||
    code === "tab_incompatible" ||
    code === "schema_mismatch" ||
    code === "header_changed" ||
    code === "mapping_required" ||
    code === "mapping_unresolved" ||
    code === "custom_writer_disabled" ||
    code === "required_field_unmapped"
  );
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
  const setup = campaignSetupHold(code);
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
    const setup = campaignSetupHold(queued.code);
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
  if (!isCompanyGoogleSheetsExecutionEnabled(env)) {
    await markIntent(db, intent.id, { status: "scheduled", jobId: queued.job.id, lastError: null, reason: null });
    return { executed: false };
  }
  // Stay processing until execute returns so another drain sees the reservation.
  await markIntent(db, intent.id, { status: "processing", jobId: queued.job.id, lastError: null, reason: null });
  const executed = await executeCompanySheetsDeliveryJob(queued.job.id, { ...deps, env, db });
  if (!executed.ok) {
    if (executed.code === "claim_lost") return { executed: false };
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

function dueWhere(now: Date, excludeIds: string[]): Prisma.CompanySheetsDispatchIntentWhereInput {
  return {
    ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    OR: [
      { status: { in: ["pending", "scheduled", "retryable"] }, availableAt: { lte: now } },
      { status: "awaiting_setup", kind: "campaign_lead" },
    ],
  };
}

/**
 * Campaign and aged work share one drain. When both are due, the kind that
 * did not run most recently goes next, so an older aged backlog cannot take
 * every execution. A single kind uses oldest createdAt, then the intent id.
 */
async function selectFairIntent(
  tx: Prisma.TransactionClient,
  now: Date,
  excludeIds: string[]
): Promise<CompanySheetsDispatchIntent | null> {
  const where = dueWhere(now, excludeIds);
  const oldestCampaign = await tx.companySheetsDispatchIntent.findFirst({
    where: { AND: [where, { kind: "campaign_lead" }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const oldestAged = await tx.companySheetsDispatchIntent.findFirst({
    where: { AND: [where, { kind: "aged_release" }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!oldestCampaign) return oldestAged;
  if (!oldestAged) return oldestCampaign;
  const last = await tx.companySheetsDeliveryJob.findFirst({
    where: { kind: { in: ["lead", "aged_release", "canary"] } },
    orderBy: { createdAt: "desc" },
    select: { kind: true },
  });
  const lastWasCampaign = last?.kind === "lead" || last?.kind === "canary";
  return lastWasCampaign ? oldestAged : oldestCampaign;
}

async function quarantineExpiredRuns(tx: Prisma.TransactionClient, now: Date, leaseCutoff: Date) {
  const expired = await tx.companySheetsDeliveryJob.findMany({
    where: {
      status: "running",
      OR: [{ startedAt: null }, { startedAt: { lt: leaseCutoff } }],
    },
    select: { id: true, spreadsheetId: true, worksheetId: true },
  });
  for (const job of expired) {
    await settleStaleCompanySheetsRun(tx, job, now, leaseCutoff);
  }
}

async function parkExpiredProcessing(tx: Prisma.TransactionClient, now: Date, leaseCutoff: Date) {
  const staleIntents = await tx.companySheetsDispatchIntent.findMany({
    where: {
      status: "processing",
      OR: [{ processingAt: null }, { processingAt: { lt: leaseCutoff } }],
    },
  });
  const later = new Date(now.getTime() + 30_000);
  for (const intent of staleIntents) {
    const job = intent.jobId
      ? await tx.companySheetsDeliveryJob.findUnique({ where: { id: intent.jobId } })
      : null;
    if (job?.status === "running") continue;
    if (job?.status === "succeeded") {
      await tx.companySheetsDispatchIntent.update({
        where: { id: intent.id },
        data: { status: "completed", jobId: job.id, lastError: null, reason: null },
      });
      continue;
    }
    if (job?.status === "uncertain" || job?.appendStartedAt) {
      await tx.companySheetsDispatchIntent.update({
        where: { id: intent.id },
        data: {
          status: "scheduled",
          jobId: job?.id ?? intent.jobId,
          lastError: "uncertain",
          reason: "append_outcome_unresolved",
          availableAt: later,
        },
      });
      continue;
    }
    await tx.companySheetsDispatchIntent.update({
      where: { id: intent.id },
      data: { status: "retryable", lastError: null, availableAt: now },
    });
  }
}

type ClaimResult =
  | { outcome: "in_flight" }
  | { outcome: "empty" }
  | { outcome: "lost" }
  | { outcome: "claimed"; intent: CompanySheetsDispatchIntent };

/**
 * The advisory lock covers the claim decision only. It commits before Google.
 * A running job inside the lease, or a processing intent inside the lease,
 * blocks a second execution. A stale run with no append marker is returned to
 * retryable and may be claimed again. A stale run with appendStartedAt set is
 * quarantined and is not claimed for another append.
 */
async function claimNextDispatchIntent(
  db: PrismaClient,
  now: Date,
  excludeIds: string[]
): Promise<ClaimResult> {
  const leaseCutoff = new Date(now.getTime() - COMPANY_SHEETS_EXECUTION_LEASE_MS);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DRAIN_ADVISORY_KEY}))`;
      await quarantineExpiredRuns(tx, now, leaseCutoff);
      const stillRunning = await tx.companySheetsDeliveryJob.findFirst({
        where: { status: "running" },
        select: { id: true },
      });
      const processingLive = await tx.companySheetsDispatchIntent.findFirst({
        where: { status: "processing", processingAt: { gte: leaseCutoff } },
        select: { id: true },
      });
      if (stillRunning || processingLive) return { outcome: "in_flight" };
      await parkExpiredProcessing(tx, now, leaseCutoff);
      const intent = await selectFairIntent(tx, now, excludeIds);
      if (!intent) return { outcome: "empty" };
      const claimed = await tx.companySheetsDispatchIntent.updateMany({
        where: { id: intent.id, status: intent.status },
        data: { status: "processing", processingAt: now, attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) return { outcome: "lost" };
      return { outcome: "claimed", intent };
    },
    { maxWait: CLAIM_MAX_WAIT_MS, timeout: CLAIM_TIMEOUT_MS }
  );
}

export async function processDueCompanySheetsDispatches(
  deps: CompanySheetsDeliveryDeps = {},
  limit = 20,
  trace: { requestId?: string; drainBudgetMs?: number } = {}
): Promise<{
  ok: true;
  processed: number;
  executed: number;
  deferred: number;
  durationMs: number;
  stopReason: DrainStopReason;
}> {
  const started = Date.now();
  const env = deps.env ?? process.env;
  const budgetMs = trace.drainBudgetMs ?? COMPANY_SHEETS_INTENT_BUDGET_MS;
  const finish = (
    processed: number,
    executed: number,
    deferred: number,
    stopReason: DrainStopReason,
    outcome: "dispatch_disabled" | "completed" | "time_budget" | "execution_in_flight"
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
      budgetMs,
      outcome,
    });
    return { ok: true as const, processed, executed, deferred, durationMs, stopReason };
  };
  if (!isCompanyGoogleSheetsDispatchEnabled(env)) return finish(0, 0, 0, null, "dispatch_disabled");
  const db = deps.db ?? prisma;
  const clock = () => deps.now?.() ?? new Date();
  const executionEnabled = isCompanyGoogleSheetsExecutionEnabled(env);
  if (!executionEnabled) {
    const now = clock();
    const stale = new Date(now.getTime() - COMPANY_SHEETS_EXECUTION_LEASE_MS);
    const due = await db.companySheetsDispatchIntent.findMany({
      where: {
        OR: [
          { status: { in: ["pending", "scheduled", "retryable"] }, availableAt: { lte: now } },
          { status: "processing", processingAt: { lt: stale } },
          { status: "awaiting_setup", kind: "campaign_lead" },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    let processed = 0;
    for (const intent of due) {
      const claimed = await db.companySheetsDispatchIntent.updateMany({
        where: {
          id: intent.id,
          OR: [{ status: intent.status, ...(intent.status === "processing" ? { processingAt: { lt: stale } } : {}) }],
        },
        data: { status: "processing", processingAt: now, attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;
      await handleClaimedIntent(intent, deps, env, db);
      processed += 1;
    }
    return finish(processed, 0, 0, null, "completed");
  }

  const startedAt = clock();
  const excludeIds: string[] = [];
  const maxClaims = Math.min(limit, COMPANY_SHEETS_DRAIN_SAFETY_CAP);
  let processed = 0;
  let executed = 0;
  let stopReason: DrainStopReason = null;
  let spins = 0;
  while (processed < maxClaims && spins < COMPANY_SHEETS_DRAIN_SAFETY_CAP) {
    spins += 1;
    const now = clock();
    if (now.getTime() - startedAt.getTime() >= budgetMs) {
      stopReason = "time_budget";
      break;
    }
    const claim = await claimNextDispatchIntent(db, now, excludeIds);
    if (claim.outcome === "in_flight") {
      stopReason = "execution_in_flight";
      break;
    }
    if (claim.outcome === "empty") break;
    if (claim.outcome === "lost") continue;
    excludeIds.push(claim.intent.id);
    const outcome = await handleClaimedIntent(claim.intent, deps, env, db);
    processed += 1;
    if (outcome.executed) executed += 1;
  }
  const deferred = stopReason ? await db.companySheetsDispatchIntent.count({ where: dueWhere(clock(), []) }) : 0;
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
  const lastJob = destination
    ? await db.companySheetsDeliveryJob.findFirst({
        where: { clientAccountId: id, kind: "lead" },
        orderBy: { createdAt: "desc" },
      })
    : null;
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
    lastCampaignDelivery: lastJob
      ? {
          jobId: lastJob.id,
          status: lastJob.status,
          spreadsheetId: lastJob.spreadsheetId,
          worksheetId: lastJob.worksheetId,
          worksheetTitle: lastJob.worksheetTitle,
          createdAt: lastJob.createdAt.toISOString(),
          finishedAt: lastJob.finishedAt?.toISOString() ?? null,
          appendStartedAt: lastJob.appendStartedAt?.toISOString() ?? null,
          uncertainReason: lastJob.uncertainReason,
        }
      : null,
  };
}
