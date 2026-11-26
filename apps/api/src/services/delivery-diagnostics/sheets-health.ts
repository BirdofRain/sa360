/**
 * Company Google Sheets delivery health from stored jobs, rows, and intents.
 *
 * Success is `canonicalCompanySheetsDelivery`: a succeeded campaign job with
 * written rows and a finish time, plus the campaign dispatch intent. An HTTP
 * 200 from the drain or from Google is not a receipt, so it is not counted.
 * Windowed counts describe flow. Open-work counts are not windowed, because an
 * old stuck item matters more than a recent one.
 */

import type { Prisma } from "@prisma/client";

import { canonicalCompanySheetsDelivery } from "../delivery-success/canonical-delivery.js";
import { machineCode } from "../delivery-health/evidence.js";
import type { DiagnosticsDb } from "./read-only.js";
import type { DiagnosticWindow } from "./window.js";

/** Expected, intentional states. They are never a delivery failure. */
export const SHEETS_EXPECTED_HOLD_INTENT_STATUSES = [
  "awaiting_setup",
  "needs_explicit_schedule",
  "duplicate_held",
  "review_held",
  "assessment_held",
  "assessment_failed",
] as const;
const OPEN_INTENT_STATUSES = ["pending", "scheduled", "processing", "retryable"] as const;
const OPEN_JOB_STATUSES = ["queued", "running", "retryable", "uncertain"] as const;
export const SHEETS_RECEIPT_EVALUATION_CAP = 500;
const ATTENTION_CAP = 20;
const ERROR_GROUP_CAP = 50;

export type SheetsAttentionItem = {
  kind: "uncertain_job" | "retryable_job" | "missing_receipt" | "stale_intent";
  clientAccountId: string;
  sourceLeadEventId: string | null;
  id: string;
  status: string;
  code: string | null;
};

export type SheetsHealth = {
  windowFlow: {
    intendedDeliveries: number;
    intentsByStatus: Record<string, number>;
    expectedHolds: number;
    jobsByStatus: Record<string, number>;
  };
  receipts: {
    evaluated: number;
    verifiedWithDurableRows: number;
    missingProof: number;
    missingProofReasons: Record<string, number>;
    truncated: boolean;
    basis: "canonicalCompanySheetsDelivery";
  };
  openWork: {
    pendingIntents: number;
    oldestPendingIntentDueAt: string | null;
    oldestPendingIntentAgeSeconds: number | null;
    retryableIntents: number;
    retryableJobs: number;
    uncertainJobs: number;
    queuedOrRunningJobs: number;
    maxJobAttemptCount: number;
    nextRetryAvailableAt: string | null;
    oldestOpenJobUpdatedAt: string | null;
    oldestOpenJobAgeSeconds: number | null;
    errorCodes: Record<string, number>;
  };
  lastSuccessfulDeliveryAt: string | null;
  lastSuccessfulDeliveryScope: "latest_succeeded_lead_job_with_written_rows";
  failedJobsNote: string;
  attention: SheetsAttentionItem[];
  attentionTruncated: boolean;
  leadScope: { campaignFilterApplied: boolean; leadIdsCapped: boolean };
};

function ageSeconds(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

export async function resolveCampaignLeadIds(
  db: DiagnosticsDb,
  input: { window: DiagnosticWindow; clientAccountId: string | null; campaignId: string | null }
): Promise<{ ids: string[] | null; capped: boolean }> {
  if (!input.campaignId) return { ids: null, capped: false };
  const cap = 2000;
  const rows = await db.sourceLeadEvent.findMany({
    where: {
      sourceCampaignId: input.campaignId,
      receivedAt: { gte: input.window.from, lt: input.window.to },
      cleanupStatus: null,
      ...(input.clientAccountId ? { clientAccountIdResolved: input.clientAccountId } : {}),
    },
    select: { id: true },
    orderBy: { receivedAt: "desc" },
    take: cap + 1,
  });
  return { ids: rows.slice(0, cap).map((row) => row.id), capped: rows.length > cap };
}

export async function loadSheetsHealth(
  db: DiagnosticsDb,
  input: {
    window: DiagnosticWindow;
    now: Date;
    clientAccountId: string | null;
    campaignId: string | null;
    campaignLeadIds: { ids: string[] | null; capped: boolean };
  }
): Promise<SheetsHealth> {
  const { window, now } = input;
  const leadFilter = input.campaignLeadIds.ids;
  const clientFilter = input.clientAccountId ? { clientAccountId: input.clientAccountId } : {};
  const leadIdFilter = leadFilter ? { sourceLeadEventId: { in: leadFilter } } : {};
  const empty = leadFilter != null && leadFilter.length === 0;

  const flowIntentWhere: Prisma.CompanySheetsDispatchIntentWhereInput = {
    kind: "campaign_lead",
    createdAt: { gte: window.from, lt: window.to },
    ...clientFilter,
    ...leadIdFilter,
  };
  const flowJobWhere: Prisma.CompanySheetsDeliveryJobWhereInput = {
    kind: "lead",
    createdAt: { gte: window.from, lt: window.to },
    ...clientFilter,
    ...leadIdFilter,
  };

  const intentGroups = empty
    ? []
    : await db.companySheetsDispatchIntent.groupBy({ by: ["status"], where: flowIntentWhere, _count: { _all: true } });
  const jobGroups = empty
    ? []
    : await db.companySheetsDeliveryJob.groupBy({ by: ["status"], where: flowJobWhere, _count: { _all: true } });

  const intentsByStatus: Record<string, number> = {};
  let intended = 0;
  let expectedHolds = 0;
  for (const group of intentGroups) {
    intentsByStatus[group.status] = group._count._all;
    intended += group._count._all;
    if ((SHEETS_EXPECTED_HOLD_INTENT_STATUSES as readonly string[]).includes(group.status)) {
      expectedHolds += group._count._all;
    }
  }
  const jobsByStatus: Record<string, number> = {};
  for (const group of jobGroups) jobsByStatus[group.status] = group._count._all;

  const succeeded = empty
    ? []
    : await db.companySheetsDeliveryJob.findMany({
        where: { ...flowJobWhere, status: "succeeded" },
        select: {
          id: true,
          kind: true,
          status: true,
          clientAccountId: true,
          sourceLeadEventId: true,
          idempotencyKey: true,
          rowsWritten: true,
          appendStartedAt: true,
          finishedAt: true,
        },
        orderBy: { finishedAt: "desc" },
        take: SHEETS_RECEIPT_EVALUATION_CAP + 1,
      });
  const truncated = succeeded.length > SHEETS_RECEIPT_EVALUATION_CAP;
  const evaluated = succeeded.slice(0, SHEETS_RECEIPT_EVALUATION_CAP);

  const jobIds = evaluated.map((job) => job.id);
  const clientIds = [...new Set(evaluated.map((job) => job.clientAccountId))];
  const leadIds = [...new Set(evaluated.flatMap((job) => (job.sourceLeadEventId ? [job.sourceLeadEventId] : [])))];
  const [rows, destinations, intents, testKeys] = await Promise.all([
    jobIds.length
      ? db.companySheetsDeliveryRow.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, status: true } })
      : Promise.resolve([]),
    clientIds.length
      ? db.companySheetsDestination.findMany({
          where: { clientAccountId: { in: clientIds } },
          select: { clientAccountId: true, campaignDispatchNotBefore: true },
        })
      : Promise.resolve([]),
    leadIds.length
      ? db.companySheetsDispatchIntent.findMany({
          where: { kind: "campaign_lead", sourceLeadEventId: { in: leadIds }, clientAccountId: { in: clientIds } },
          select: { kind: true, clientAccountId: true, sourceLeadEventId: true, jobId: true, createdAt: true },
        })
      : Promise.resolve([]),
    evaluated.length
      ? db.clientOnboardingTestAttemptKey.findMany({
          where: { idempotencyKey: { in: evaluated.map((job) => job.idempotencyKey) } },
          select: { idempotencyKey: true },
        })
      : Promise.resolve([]),
  ]);

  const rowsByJob = new Map<string, Array<{ jobId: string; status: string }>>();
  for (const row of rows) rowsByJob.set(row.jobId, [...(rowsByJob.get(row.jobId) ?? []), row]);
  const destinationByClient = new Map(destinations.map((row) => [row.clientAccountId, row]));
  const attention: SheetsAttentionItem[] = [];
  const missingProofReasons: Record<string, number> = {};
  let verified = 0;
  let missingProof = 0;
  for (const job of evaluated) {
    const intent =
      intents.find(
        (candidate) =>
          candidate.sourceLeadEventId === job.sourceLeadEventId &&
          candidate.clientAccountId === job.clientAccountId &&
          (candidate.jobId == null || candidate.jobId === job.id)
      ) ?? null;
    const destination = destinationByClient.get(job.clientAccountId) ?? null;
    const verdict = canonicalCompanySheetsDelivery({
      evidence: "campaign_job",
      job,
      rows: rowsByJob.get(job.id) ?? [],
      destination: destination
        ? { clientAccountId: destination.clientAccountId, campaignDispatchNotBefore: destination.campaignDispatchNotBefore }
        : null,
      intent,
      onboardingTestAttemptKeys: testKeys.map((row) => row.idempotencyKey),
    });
    if (verdict.canonical) {
      verified += 1;
    } else {
      missingProof += 1;
      for (const reason of verdict.reasons) bump(missingProofReasons, reason);
      attention.push({
        kind: "missing_receipt",
        clientAccountId: job.clientAccountId,
        sourceLeadEventId: job.sourceLeadEventId,
        id: job.id,
        status: job.status,
        code: verdict.reasons[0] ?? null,
      });
    }
  }

  const openIntentWhere: Prisma.CompanySheetsDispatchIntentWhereInput = {
    kind: "campaign_lead",
    status: { in: [...OPEN_INTENT_STATUSES] },
    ...clientFilter,
    ...leadIdFilter,
  };
  const openJobWhere: Prisma.CompanySheetsDeliveryJobWhereInput = {
    kind: "lead",
    status: { in: [...OPEN_JOB_STATUSES] },
    ...clientFilter,
    ...leadIdFilter,
  };

  const [pendingIntents, retryableIntents, oldestIntent, nextRetry] = empty
    ? [0, 0, null, null]
    : await Promise.all([
        db.companySheetsDispatchIntent.count({ where: openIntentWhere }),
        db.companySheetsDispatchIntent.count({ where: { ...openIntentWhere, status: "retryable" } }),
        db.companySheetsDispatchIntent.findFirst({
          where: openIntentWhere,
          orderBy: { availableAt: "asc" },
          select: { id: true, clientAccountId: true, sourceLeadEventId: true, status: true, availableAt: true, lastError: true },
        }),
        db.companySheetsDispatchIntent.findFirst({
          where: { ...openIntentWhere, status: "retryable" },
          orderBy: { availableAt: "asc" },
          select: { availableAt: true },
        }),
      ]);

  const openJobGroups = empty
    ? []
    : await db.companySheetsDeliveryJob.groupBy({
        by: ["status"],
        where: openJobWhere,
        _count: { _all: true },
        _max: { attemptCount: true },
      });
  const oldestJob = empty
    ? null
    : await db.companySheetsDeliveryJob.findFirst({
        where: openJobWhere,
        orderBy: { updatedAt: "asc" },
        select: { id: true, clientAccountId: true, sourceLeadEventId: true, status: true, updatedAt: true, lastError: true },
      });
  const errorGroups = empty
    ? []
    : await db.companySheetsDeliveryJob.groupBy({
        by: ["lastError"],
        where: { ...openJobWhere, status: { in: ["retryable", "uncertain"] } },
        _count: { _all: true },
        orderBy: { _count: { lastError: "desc" } },
        take: ERROR_GROUP_CAP,
      });
  const errorCodes: Record<string, number> = {};
  for (const group of errorGroups) bump(errorCodes, machineCode(group.lastError) ?? (group.lastError ? "other" : "none"), group._count._all);

  const openByStatus = new Map(openJobGroups.map((group) => [group.status, group]));
  const maxAttempt = Math.max(0, ...openJobGroups.map((group) => group._max.attemptCount ?? 0));

  const atRiskJobs = empty
    ? []
    : await db.companySheetsDeliveryJob.findMany({
        where: { ...openJobWhere, status: { in: ["uncertain", "retryable"] } },
        orderBy: { updatedAt: "asc" },
        take: ATTENTION_CAP,
        select: { id: true, clientAccountId: true, sourceLeadEventId: true, status: true, lastError: true },
      });
  for (const job of atRiskJobs) {
    attention.push({
      kind: job.status === "uncertain" ? "uncertain_job" : "retryable_job",
      clientAccountId: job.clientAccountId,
      sourceLeadEventId: job.sourceLeadEventId,
      id: job.id,
      status: job.status,
      code: machineCode(job.lastError),
    });
  }

  const lastSuccess = empty
    ? null
    : await db.companySheetsDeliveryJob.findFirst({
        where: {
          kind: "lead",
          status: "succeeded",
          finishedAt: { not: null },
          rowsWritten: { gte: 1 },
          rows: { some: { status: "written" } },
          ...clientFilter,
          ...leadIdFilter,
        },
        orderBy: { updatedAt: "desc" },
        select: { finishedAt: true },
      });

  const oldestDue = oldestIntent?.availableAt ?? null;
  if (oldestIntent && oldestDue && now.getTime() - oldestDue.getTime() > 15 * 60 * 1000) {
    attention.push({
      kind: "stale_intent",
      clientAccountId: oldestIntent.clientAccountId,
      sourceLeadEventId: oldestIntent.sourceLeadEventId,
      id: oldestIntent.id,
      status: oldestIntent.status,
      code: machineCode(oldestIntent.lastError),
    });
  }

  return {
    windowFlow: { intendedDeliveries: intended, intentsByStatus, expectedHolds, jobsByStatus },
    receipts: {
      evaluated: evaluated.length,
      verifiedWithDurableRows: verified,
      missingProof,
      missingProofReasons,
      truncated,
      basis: "canonicalCompanySheetsDelivery",
    },
    openWork: {
      pendingIntents,
      oldestPendingIntentDueAt: oldestDue?.toISOString() ?? null,
      oldestPendingIntentAgeSeconds: ageSeconds(oldestDue, now),
      retryableIntents,
      retryableJobs: openByStatus.get("retryable")?._count._all ?? 0,
      uncertainJobs: openByStatus.get("uncertain")?._count._all ?? 0,
      queuedOrRunningJobs: (openByStatus.get("queued")?._count._all ?? 0) + (openByStatus.get("running")?._count._all ?? 0),
      maxJobAttemptCount: maxAttempt,
      nextRetryAvailableAt: nextRetry?.availableAt.toISOString() ?? null,
      oldestOpenJobUpdatedAt: oldestJob?.updatedAt.toISOString() ?? null,
      oldestOpenJobAgeSeconds: ageSeconds(oldestJob?.updatedAt ?? null, now),
      errorCodes,
    },
    lastSuccessfulDeliveryAt: lastSuccess?.finishedAt?.toISOString() ?? null,
    lastSuccessfulDeliveryScope: "latest_succeeded_lead_job_with_written_rows",
    failedJobsNote:
      "Delivery failure is retryable (with a code) or uncertain. A failed lead job is a person-gate hold settled before any Google call and appears only in jobsByStatus. Expected intent holds are counted separately and are not failures.",
    attention: attention.slice(0, ATTENTION_CAP),
    attentionTruncated: attention.length > ATTENTION_CAP,
    leadScope: { campaignFilterApplied: leadFilter != null, leadIdsCapped: input.campaignLeadIds.capped },
  };
}
