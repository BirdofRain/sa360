import type { Prisma, PrismaClient } from "@prisma/client";
import { isCompanySheetsInternalPilotLead } from "@sa360/shared";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { campaignLeadIdentityFromPayload } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import { applyOperatorOverrideToLiveBlock } from "../lead-identity/duplicate-risk.service.js";
import { normalizeEmail } from "../lead-identity/lead-identity-extract.js";
import type { DuplicateRiskLevel } from "../lead-identity/lead-identity.types.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";

/**
 * Client-scoped person gate for Sheets delivery.
 *
 * Event identity stays on CompanySheetsDispatchIntent / CompanySheetsDeliveryJob
 * idempotency keys. This module reserves a person (normalized phone or email)
 * for one client before a campaign lead job is created. A Sheets job and a GHL
 * outbox row stay separate receipts: admitting or appending a sheet does not
 * write GhlAssociationDispatchOutbox or BuyerDeliveredIdentity.
 *
 * InboundContactIndex is not read or written. A sheets-only client has no GHL
 * history and is still covered by admission rows plus lead delivery jobs.
 *
 * Writers of ClientSheetsPersonAdmission:
 * - evaluateClientSheetsPersonGate (live reservation)
 * - importVerifiedZapSheetsBaseline (verified historical baseline only)
 * - noteSheetsPersonDelivery (status/evidence after a lead job outcome)
 *
 * Readers: the same gate, the import conflict check, and noteSheetsPersonDelivery.
 *
 * Not called from aged release, canary, captured onboarding test, Zapier
 * webhooks, or the GHL association outbox.
 */
export const SHEETS_PERSON_POLICY = "client_normalized_phone_email_v1";
export const SHEETS_PERSON_CHANNEL = "sheets";
/**
 * One history pass reads at most this many eligible lead jobs.
 * A client with more than this many still-unindexed jobs is partial, not complete.
 * The next pass resumes after the cursor. 500 is the batch size, not proof of coverage.
 */
export const SHEETS_HISTORY_BATCH_LIMIT = 500;

export type HistoryCoverageStatus = "unavailable" | "partial" | "complete";
export type HistoryCompletenessProof = "cursor_exhausted" | "no_eligible_jobs" | "cursor_open" | "not_started";

export type HistoryCoverageSnapshot = {
  status: HistoryCoverageStatus;
  completenessProof: HistoryCompletenessProof;
  indexedCount: number;
  observedJobCount: number;
  /** Counts describe the pass. Only status plus completenessProof say whether history was exhausted. */
  countsAreNotProof: true;
};

export type SheetsPersonDb = PrismaClient | Prisma.TransactionClient;

export type SheetsPersonGateCode =
  | "admitted"
  | "replay_allowed"
  | "exempt_synthetic_pilot"
  | "person_duplicate"
  | "person_review"
  | "assessment_missing"
  | "assessment_failed";

export type SheetsPersonGateResult = {
  ok: boolean;
  code: SheetsPersonGateCode;
  /** Intent status when the gate does not allow dispatch. */
  intentStatus: "duplicate_held" | "review_held" | "assessment_held" | "assessment_failed" | null;
  reason: string;
  policy: string;
  assessmentState: "present" | "missing" | "failed" | "not_applicable" | "exempt";
  historyCoverage: HistoryCoverageStatus | null;
  priorEvidence: Prisma.InputJsonValue | null;
};

export type SheetsPersonOwner = {
  kind: "phone" | "email";
  normalizedValue: string;
  ownerEventId: string | null;
  historicalImportKey: string | null;
  admissionId: string | null;
  origin: string;
  status: string;
  jobId: string | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
};

export type SheetsPersonClassification = {
  action: "admit" | "replay" | "block" | "review";
  reason: string;
  evidence: SheetsPersonOwner[];
};

export function normalizeSheetsPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const verified = tryNormalizeToVerifiedE164(raw);
  return verified.ok ? verified.e164 : null;
}

export function sheetsPersonIdentifiers(normalizedPayload: unknown): {
  phone: string | null;
  email: string | null;
  fullName: string;
} {
  const identity = campaignLeadIdentityFromPayload(normalizedPayload);
  return {
    phone: normalizeSheetsPhone(identity.phone),
    email: normalizeEmail(identity.email),
    fullName: identity.fullName,
  };
}

function ownerKey(owner: SheetsPersonOwner): string {
  if (owner.ownerEventId) return `event:${owner.ownerEventId}`;
  if (owner.historicalImportKey) return `import:${owner.historicalImportKey}`;
  return `job:${owner.jobId ?? "unknown"}`;
}

/**
 * Name is intentionally unused. Two people who share a name and no phone or
 * email are not the same person. A phone owned by one admission and an email
 * owned by another is a review, not an automatic block against either owner.
 */
/**
 * A new person is held when one batch cannot exhaust prior eligible jobs.
 * With the production batch of 500, 501 prior jobs hold them. A matched identifier
 * is a duplicate decision, not a coverage hold. The next batch can finish coverage.
 */
export function newPersonHeldForUnindexedHistory(input: {
  batchLimit: number;
  priorEligibleJobs: number;
  identifierMatched: boolean;
}): { held: boolean; status: HistoryCoverageStatus; reason: string | null } {
  const after = historyCoverageAfterBatch({
    batchLimit: input.batchLimit,
    jobsReturned: Math.min(input.priorEligibleJobs, input.batchLimit),
    moreRemain: input.priorEligibleJobs > input.batchLimit,
  });
  if (input.identifierMatched) return { held: false, status: after.status, reason: null };
  if (after.status !== "complete") {
    return { held: true, status: after.status, reason: `history_coverage_${after.status}` };
  }
  return { held: false, status: "complete", reason: null };
}

export function historyCoverageAfterBatch(input: {
  batchLimit: number;
  jobsReturned: number;
  moreRemain: boolean;
}): { status: "partial" | "complete"; completenessProof: HistoryCompletenessProof } {
  if (input.jobsReturned === 0) return { status: "complete", completenessProof: "no_eligible_jobs" };
  if (input.jobsReturned < input.batchLimit || !input.moreRemain) {
    return { status: "complete", completenessProof: "cursor_exhausted" };
  }
  return { status: "partial", completenessProof: "cursor_open" };
}

export function classifySheetsPerson(input: {
  sourceLeadEventId: string;
  phone: string | null;
  email: string | null;
  owners: readonly SheetsPersonOwner[];
}): SheetsPersonClassification {
  if (!input.phone && !input.email) {
    return { action: "review", reason: "no_normalized_phone_or_email", evidence: [] };
  }
  const self = `event:${input.sourceLeadEventId}`;
  const phoneOwners = input.owners.filter((owner) => input.phone && owner.kind === "phone" && owner.normalizedValue === input.phone);
  const emailOwners = input.owners.filter((owner) => input.email && owner.kind === "email" && owner.normalizedValue === input.email);
  const phoneKeys = [...new Set(phoneOwners.map(ownerKey))];
  const emailKeys = [...new Set(emailOwners.map(ownerKey))];
  const phoneForeign = phoneKeys.filter((key) => key !== self);
  const emailForeign = emailKeys.filter((key) => key !== self);
  const evidence = [...phoneOwners, ...emailOwners];
  const selfOwns = phoneKeys.includes(self) || emailKeys.includes(self);

  if (phoneForeign.length === 0 && emailForeign.length === 0) {
    if (selfOwns) return { action: "replay", reason: "same_event_reservation", evidence };
    return { action: "admit", reason: "identifiers_reserved", evidence };
  }

  const foreign = [...new Set([...phoneForeign, ...emailForeign])];
  const selfSplit =
    (phoneKeys.includes(self) && emailForeign.length > 0) ||
    (emailKeys.includes(self) && phoneForeign.length > 0);
  if (foreign.length > 1 || selfSplit) {
    return { action: "review", reason: "shared_identifier_conflict", evidence };
  }
  const recordedDelivery =
    evidence.length > 0 &&
    evidence.every((owner) => owner.origin === "delivery_index" || owner.origin === "sheets_delivery_job");
  return {
    action: "block",
    reason: recordedDelivery ? "sheets_delivery_already_recorded" : "normalized_identifier_already_admitted",
    evidence,
  };
}

function isRootClient(db: SheetsPersonDb): db is PrismaClient {
  return typeof (db as PrismaClient).$transaction === "function";
}

async function inClientLock<T>(
  db: SheetsPersonDb,
  clientAccountId: string,
  fn: (tx: SheetsPersonDb) => Promise<T>
): Promise<T> {
  const run = async (tx: SheetsPersonDb) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`client_sheets_person:${clientAccountId}`}, 0))`;
    return fn(tx);
  };
  if (isRootClient(db)) return db.$transaction((tx) => run(tx));
  return run(db);
}

export function sheetsPersonDecisionKey(clientAccountId: string, sourceLeadEventId: string): string {
  return `sheets:${clientAccountId}:${sourceLeadEventId}`;
}

function decisionKey(clientAccountId: string, sourceLeadEventId: string): string {
  return sheetsPersonDecisionKey(clientAccountId, sourceLeadEventId);
}

async function writeDecision(
  db: SheetsPersonDb,
  input: {
    clientAccountId: string;
    sourceLeadEventId: string | null;
    idempotencyKey: string;
    outcome: string;
    reason: string;
    assessmentState: SheetsPersonGateResult["assessmentState"];
    phone: string | null;
    email: string | null;
    priorEvidence: Prisma.InputJsonValue | null;
  }
) {
  await db.clientSheetsDedupeDecision.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      idempotencyKey: input.idempotencyKey,
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      channel: SHEETS_PERSON_CHANNEL,
      outcome: input.outcome,
      policy: SHEETS_PERSON_POLICY,
      reason: input.reason,
      normalizedPhone: input.phone,
      normalizedEmail: input.email,
      assessmentState: input.assessmentState,
      priorEvidenceJson: input.priorEvidence ?? undefined,
    },
    update: {
      outcome: input.outcome,
      reason: input.reason,
      normalizedPhone: input.phone,
      normalizedEmail: input.email,
      assessmentState: input.assessmentState,
      priorEvidenceJson: input.priorEvidence ?? undefined,
    },
  });
}

function hold(
  code: SheetsPersonGateCode,
  intentStatus: SheetsPersonGateResult["intentStatus"],
  reason: string,
  assessmentState: SheetsPersonGateResult["assessmentState"],
  priorEvidence: Prisma.InputJsonValue | null = null
): SheetsPersonGateResult {
  return {
    ok: false,
    code,
    intentStatus,
    reason,
    policy: SHEETS_PERSON_POLICY,
    assessmentState,
    historyCoverage: null,
    priorEvidence,
  };
}

function allow(
  code: "admitted" | "replay_allowed" | "exempt_synthetic_pilot",
  reason: string,
  assessmentState: SheetsPersonGateResult["assessmentState"]
): SheetsPersonGateResult {
  return {
    ok: true,
    code,
    intentStatus: null,
    reason,
    policy: SHEETS_PERSON_POLICY,
    assessmentState,
    historyCoverage: null,
    priorEvidence: null,
  };
}

function assessmentBlocksLive(row: {
  riskLevel: string;
  identityStatus: string;
  operatorOverrideStatus: string | null;
}): boolean {
  const blocksLiveDelivery =
    row.riskLevel === "likely_duplicate" ||
    row.riskLevel === "source_duplicate" ||
    row.identityStatus === "orphan_appointment";
  return applyOperatorOverrideToLiveBlock(
    { riskLevel: row.riskLevel as DuplicateRiskLevel, blocksLiveDelivery },
    row.operatorOverrideStatus
  );
}

function evidenceJson(owners: readonly SheetsPersonOwner[]): Prisma.InputJsonValue {
  return {
    policy: SHEETS_PERSON_POLICY,
    matches: owners.map((owner) => ({
      kind: owner.kind,
      normalizedValue: owner.normalizedValue,
      ownerEventId: owner.ownerEventId,
      historicalImportKey: owner.historicalImportKey,
      admissionId: owner.admissionId,
      origin: owner.origin,
      status: owner.status,
      jobId: owner.jobId,
      spreadsheetId: owner.spreadsheetId,
      worksheetId: owner.worksheetId,
    })),
  };
}

function eligibleLeadJobWhere(clientAccountId: string): Prisma.CompanySheetsDeliveryJobWhereInput {
  return {
    clientAccountId,
    kind: "lead",
    sourceLeadEventId: { not: null },
    NOT: { AND: [{ status: "failed" }, { appendStartedAt: null }, { rowsWritten: 0 }] },
  };
}

function afterCursor(
  cursor: { createdAt: Date; jobId: string } | null
): Prisma.CompanySheetsDeliveryJobWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.jobId } }] },
    ],
  };
}

function coverageSnapshot(
  status: HistoryCoverageStatus,
  completenessProof: HistoryCompletenessProof,
  indexedCount: number,
  observedJobCount: number
): HistoryCoverageSnapshot {
  return { status, completenessProof, indexedCount, observedJobCount, countsAreNotProof: true };
}

function evidenceRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function advanceHistoryBaseline(
  db: SheetsPersonDb,
  clientAccountId: string,
  batchSize: number
): Promise<HistoryCoverageSnapshot> {
  const limit = Math.min(Math.max(batchSize, 1), SHEETS_HISTORY_BATCH_LIMIT);
  const existing = await db.clientSheetsHistoryCoverage.findUnique({ where: { clientAccountId } });
  const cursor =
    existing?.cursorCreatedAt && existing.cursorJobId
      ? { createdAt: existing.cursorCreatedAt, jobId: existing.cursorJobId }
      : null;
  const jobs = await db.companySheetsDeliveryJob.findMany({
    where: { AND: [eligibleLeadJobWhere(clientAccountId), afterCursor(cursor)] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      createdAt: true,
      status: true,
      sourceLeadEventId: true,
      spreadsheetId: true,
      worksheetId: true,
    },
  });
  const eventIds = [...new Set(jobs.map((job) => job.sourceLeadEventId).filter((id): id is string => Boolean(id)))];
  const leads = eventIds.length
    ? await db.sourceLeadEvent.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, normalizedPayloadJson: true },
      })
    : [];
  const byId = new Map(leads.map((lead) => [lead.id, sheetsPersonIdentifiers(lead.normalizedPayloadJson)]));
  const wanted: Array<{ kind: "phone" | "email"; normalizedValue: string; sourceLeadEventId: string; job: (typeof jobs)[number] }> = [];
  for (const job of jobs) {
    if (!job.sourceLeadEventId) continue;
    const identity = byId.get(job.sourceLeadEventId);
    if (!identity) continue;
    if (identity.phone) wanted.push({ kind: "phone", normalizedValue: identity.phone, sourceLeadEventId: job.sourceLeadEventId, job });
    if (identity.email) wanted.push({ kind: "email", normalizedValue: identity.email, sourceLeadEventId: job.sourceLeadEventId, job });
  }
  const values = [...new Set(wanted.map((row) => row.normalizedValue))];
  const occupied = values.length
    ? await db.clientSheetsPersonAdmission.findMany({
        where: { clientAccountId, normalizedValue: { in: values } },
        select: { kind: true, normalizedValue: true },
      })
    : [];
  const taken = new Set(occupied.map((row) => `${row.kind}:${row.normalizedValue}`));
  const fresh = wanted.filter((row) => !taken.has(`${row.kind}:${row.normalizedValue}`));
  const uniqueFresh: typeof fresh = [];
  for (const row of fresh) {
    const key = `${row.kind}:${row.normalizedValue}`;
    if (taken.has(key)) continue;
    taken.add(key);
    uniqueFresh.push(row);
  }
  if (uniqueFresh.length > 0) {
    await db.clientSheetsPersonAdmission.createMany({
      data: uniqueFresh.map((row) => ({
        clientAccountId,
        kind: row.kind,
        normalizedValue: row.normalizedValue,
        fingerprint: fingerprintIdentityValue(row.kind, row.normalizedValue),
        sourceLeadEventId: row.sourceLeadEventId,
        status: row.job.status === "succeeded" ? "admitted" : "reserved",
        policy: SHEETS_PERSON_POLICY,
        origin: "delivery_index",
        evidenceJson: {
          jobId: row.job.id,
          spreadsheetId: row.job.spreadsheetId,
          worksheetId: row.job.worksheetId,
          jobStatus: row.job.status,
        },
      })),
    });
  }
  const last = jobs.at(-1) ?? null;
  const more = last
    ? await db.companySheetsDeliveryJob.findFirst({
        where: {
          AND: [eligibleLeadJobWhere(clientAccountId), afterCursor({ createdAt: last.createdAt, jobId: last.id })],
        },
        select: { id: true },
      })
    : null;
  const after =
    jobs.length === 0 && cursor
      ? { status: "complete" as const, completenessProof: "cursor_exhausted" as const }
      : historyCoverageAfterBatch({
          batchLimit: limit,
          jobsReturned: jobs.length,
          moreRemain: Boolean(more),
        });
  const indexedCount = (existing?.indexedCount ?? 0) + uniqueFresh.length;
  const observedJobCount = (existing?.observedJobCount ?? 0) + jobs.length;
  await db.clientSheetsHistoryCoverage.upsert({
    where: { clientAccountId },
    create: {
      clientAccountId,
      status: after.status,
      completenessProof: after.completenessProof,
      cursorCreatedAt: last?.createdAt,
      cursorJobId: last?.id,
      indexedCount,
      observedJobCount,
    },
    update: {
      status: after.status,
      completenessProof: after.completenessProof,
      cursorCreatedAt: last?.createdAt ?? existing?.cursorCreatedAt,
      cursorJobId: last?.id ?? existing?.cursorJobId,
      indexedCount,
      observedJobCount,
    },
  });
  return coverageSnapshot(after.status, after.completenessProof, indexedCount, observedJobCount);
}

export async function readClientSheetsHistoryCoverage(
  db: SheetsPersonDb,
  clientAccountId: string
): Promise<HistoryCoverageSnapshot> {
  const row = await db.clientSheetsHistoryCoverage.findUnique({ where: { clientAccountId } });
  if (!row) {
    const pending = await db.companySheetsDeliveryJob.findFirst({
      where: eligibleLeadJobWhere(clientAccountId),
      select: { id: true },
    });
    if (!pending) return coverageSnapshot("complete", "no_eligible_jobs", 0, 0);
    return coverageSnapshot("unavailable", "not_started", 0, 0);
  }
  const cursor =
    row.cursorCreatedAt && row.cursorJobId ? { createdAt: row.cursorCreatedAt, jobId: row.cursorJobId } : null;
  const remaining = await db.companySheetsDeliveryJob.findFirst({
    where: { AND: [eligibleLeadJobWhere(clientAccountId), afterCursor(cursor)] },
    select: { id: true },
  });
  if (remaining) {
    return coverageSnapshot(
      row.status === "unavailable" ? "unavailable" : "partial",
      row.status === "unavailable" ? "not_started" : "cursor_open",
      row.indexedCount,
      row.observedJobCount
    );
  }
  return coverageSnapshot("complete", row.observedJobCount === 0 ? "no_eligible_jobs" : "cursor_exhausted", row.indexedCount, row.observedJobCount);
}

export async function prepareClientSheetsHistoryBaseline(
  db: PrismaClient,
  input: { clientAccountId: string; batchSize?: number }
): Promise<HistoryCoverageSnapshot> {
  const clientAccountId = input.clientAccountId.trim();
  return inClientLock(db, clientAccountId, (tx) =>
    advanceHistoryBaseline(tx, clientAccountId, input.batchSize ?? SHEETS_HISTORY_BATCH_LIMIT)
  );
}

export async function evaluateClientSheetsPersonGate(
  db: SheetsPersonDb,
  input: { clientAccountId: string; sourceLeadEventId: string; historyBatchSize?: number }
): Promise<SheetsPersonGateResult> {
  const clientAccountId = input.clientAccountId.trim();
  const sourceLeadEventId = input.sourceLeadEventId.trim();
  const lead = await db.sourceLeadEvent.findUnique({ where: { id: sourceLeadEventId } });
  if (!lead) {
    const result = hold("person_review", "review_held", "lead_not_found", "not_applicable");
    await writeDecision(db, {
      clientAccountId,
      sourceLeadEventId,
      idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
      outcome: "review_held",
      reason: result.reason,
      assessmentState: "not_applicable",
      phone: null,
      email: null,
      priorEvidence: null,
    });
    return result;
  }
  if (isCompanySheetsInternalPilotLead(lead)) {
    await writeDecision(db, {
      clientAccountId,
      sourceLeadEventId,
      idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
      outcome: "exempt",
      reason: "synthetic_pilot_exempt",
      assessmentState: "exempt",
      phone: null,
      email: null,
      priorEvidence: null,
    });
    return allow("exempt_synthetic_pilot", "synthetic_pilot_exempt", "exempt");
  }
  const resolved = lead.clientAccountIdResolved?.trim() ?? "";
  if (resolved && resolved !== clientAccountId) {
    const result = hold("person_review", "review_held", "client_mismatch", "not_applicable");
    await writeDecision(db, {
      clientAccountId,
      sourceLeadEventId,
      idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
      outcome: "review_held",
      reason: result.reason,
      assessmentState: "not_applicable",
      phone: null,
      email: null,
      priorEvidence: null,
    });
    return result;
  }
  const identity = sheetsPersonIdentifiers(lead.normalizedPayloadJson);
  const decisionId = lead.routingDryRunDecisionId?.trim() || null;
  let assessmentState: SheetsPersonGateResult["assessmentState"] = decisionId ? "missing" : "not_applicable";
  if (decisionId) {
    const [assessment, failure] = await Promise.all([
      db.leadDuplicateRiskAssessment.findUnique({ where: { routingDryRunDecisionId: decisionId } }),
      db.duplicateRiskAssessmentFailure.findUnique({ where: { routingDryRunDecisionId: decisionId } }),
    ]);
    if (!assessment && failure) {
      const failureClass = failure.failureClass === "transient" ? "transient" : "review";
      const result = hold(
        "assessment_failed",
        "assessment_failed",
        failureClass === "transient" ? "assessment_failed_transient" : "assessment_needs_review",
        "failed",
        {
          routingDryRunDecisionId: decisionId,
          errorName: failure.errorName,
          failureClass,
        }
      );
      await writeDecision(db, {
        clientAccountId,
        sourceLeadEventId,
        idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
        outcome: "assessment_failed",
        reason: result.reason,
        assessmentState: "failed",
        phone: identity.phone,
        email: identity.email,
        priorEvidence: result.priorEvidence,
      });
      return result;
    }
    if (!assessment) {
      const result = hold("assessment_missing", "assessment_held", "assessment_missing", "missing", {
        routingDryRunDecisionId: decisionId,
      });
      await writeDecision(db, {
        clientAccountId,
        sourceLeadEventId,
        idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
        outcome: "assessment_held",
        reason: result.reason,
        assessmentState: "missing",
        phone: identity.phone,
        email: identity.email,
        priorEvidence: result.priorEvidence,
      });
      return result;
    }
    assessmentState = "present";
    if (assessmentBlocksLive(assessment)) {
      const priorEvidence: Prisma.InputJsonValue = {
        policy: SHEETS_PERSON_POLICY,
        routingDryRunDecisionId: decisionId,
        riskLevel: assessment.riskLevel,
        identityStatus: assessment.identityStatus,
        operatorOverrideStatus: assessment.operatorOverrideStatus,
      };
      const result = hold(
        "person_duplicate",
        "duplicate_held",
        "assessment_blocks_live_delivery",
        "present",
        priorEvidence
      );
      await writeDecision(db, {
        clientAccountId,
        sourceLeadEventId,
        idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
        outcome: "duplicate_blocked",
        reason: result.reason,
        assessmentState: "present",
        phone: identity.phone,
        email: identity.email,
        priorEvidence,
      });
      return result;
    }
  }

  return inClientLock(db, clientAccountId, async (tx) => {
    const coverage = await advanceHistoryBaseline(tx, clientAccountId, input.historyBatchSize ?? SHEETS_HISTORY_BATCH_LIMIT);
    const values = [identity.phone, identity.email].filter((value): value is string => Boolean(value));
    const admissions = values.length
      ? await tx.clientSheetsPersonAdmission.findMany({
          where: { clientAccountId, normalizedValue: { in: values } },
        })
      : [];
    const owners: SheetsPersonOwner[] = admissions.map((row) => {
      const stored = evidenceRecord(row.evidenceJson);
      return {
        kind: row.kind === "email" ? ("email" as const) : ("phone" as const),
        normalizedValue: row.normalizedValue,
        ownerEventId: row.sourceLeadEventId,
        historicalImportKey: row.historicalImportKey,
        admissionId: row.id,
        origin: row.origin,
        status: row.status,
        jobId: typeof stored?.jobId === "string" ? stored.jobId : null,
        spreadsheetId: typeof stored?.spreadsheetId === "string" ? stored.spreadsheetId : null,
        worksheetId: typeof stored?.worksheetId === "number" ? stored.worksheetId : null,
      };
    });
    const classified = classifySheetsPerson({
      sourceLeadEventId,
      phone: identity.phone,
      email: identity.email,
      owners,
    });
    const coverageEvidence: Prisma.InputJsonObject = {
      policy: SHEETS_PERSON_POLICY,
      historyCoverage: coverage.status,
      completenessProof: coverage.completenessProof,
      indexedCount: coverage.indexedCount,
      observedJobCount: coverage.observedJobCount,
      countsAreNotProof: true,
    };
    if (classified.action === "admit" && coverage.status !== "complete") {
      const result = hold(
        "person_review",
        "review_held",
        coverage.status === "partial" ? "history_coverage_partial" : "history_coverage_unavailable",
        assessmentState,
        coverageEvidence
      );
      result.historyCoverage = coverage.status;
      await writeDecision(tx, {
        clientAccountId,
        sourceLeadEventId,
        idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
        outcome: "review_held",
        reason: result.reason,
        assessmentState,
        phone: identity.phone,
        email: identity.email,
        priorEvidence: coverageEvidence,
      });
      return result;
    }
    if (classified.action === "admit" || classified.action === "replay") {
      const owned = new Set(
        admissions
          .filter((row) => row.sourceLeadEventId === sourceLeadEventId)
          .map((row) => `${row.kind}:${row.normalizedValue}`)
      );
      const inserts = [
        identity.phone ? { kind: "phone" as const, normalizedValue: identity.phone } : null,
        identity.email ? { kind: "email" as const, normalizedValue: identity.email } : null,
      ].filter((row): row is { kind: "phone" | "email"; normalizedValue: string } => row != null && !owned.has(`${row.kind}:${row.normalizedValue}`));
      if (classified.action === "admit" || inserts.length > 0) {
        const fresh = inserts.filter((row) => !admissions.some((existing) => existing.kind === row.kind && existing.normalizedValue === row.normalizedValue));
        if (fresh.length > 0) {
          await tx.clientSheetsPersonAdmission.createMany({
            data: fresh.map((row) => ({
              clientAccountId,
              kind: row.kind,
              normalizedValue: row.normalizedValue,
              fingerprint: fingerprintIdentityValue(row.kind, row.normalizedValue),
              sourceLeadEventId,
              status: "reserved",
              policy: SHEETS_PERSON_POLICY,
              origin: "live_reservation",
            })),
          });
        }
      }
    }
    const matchEvidence = classified.evidence.length > 0 ? evidenceJson(classified.evidence) : null;
    const priorEvidence: Prisma.InputJsonObject = {
      ...coverageEvidence,
      ...(matchEvidence && typeof matchEvidence === "object" && !Array.isArray(matchEvidence)
        ? (matchEvidence as Prisma.InputJsonObject)
        : {}),
    };
    const mapped = mapClassification(classified, assessmentState, priorEvidence);
    mapped.historyCoverage = coverage.status;
    await writeDecision(tx, {
      clientAccountId,
      sourceLeadEventId,
      idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
      outcome: mapped.ok ? (mapped.code === "replay_allowed" ? "replay_allowed" : "admitted") : mapped.intentStatus === "review_held" ? "review_held" : "duplicate_blocked",
      reason: mapped.reason,
      assessmentState,
      phone: identity.phone,
      email: identity.email,
      priorEvidence,
    });
    return mapped;
  });
}

function mapClassification(
  classified: SheetsPersonClassification,
  assessmentState: SheetsPersonGateResult["assessmentState"],
  priorEvidence: Prisma.InputJsonValue | null
): SheetsPersonGateResult {
  if (classified.action === "admit") return allow("admitted", classified.reason, assessmentState);
  if (classified.action === "replay") return allow("replay_allowed", classified.reason, assessmentState);
  if (classified.action === "review") {
    return hold("person_review", "review_held", classified.reason, assessmentState, priorEvidence);
  }
  return hold("person_duplicate", "duplicate_held", classified.reason, assessmentState, priorEvidence);
}

export async function noteSheetsPersonDelivery(
  db: SheetsPersonDb,
  input: {
    clientAccountId: string;
    sourceLeadEventId: string;
    jobId: string;
    outcome: "succeeded" | "uncertain";
    spreadsheetId: string;
    worksheetId: number;
  }
): Promise<void> {
  const evidence = {
    policy: SHEETS_PERSON_POLICY,
    channel: SHEETS_PERSON_CHANNEL,
    jobId: input.jobId,
    outcome: input.outcome,
    spreadsheetId: input.spreadsheetId,
    worksheetId: input.worksheetId,
    notedAt: new Date().toISOString(),
  };
  if (input.outcome === "succeeded") {
    await db.clientSheetsPersonAdmission.updateMany({
      where: {
        clientAccountId: input.clientAccountId,
        sourceLeadEventId: input.sourceLeadEventId,
        origin: "live_reservation",
      },
      data: { status: "admitted", evidenceJson: evidence },
    });
    return;
  }
  await db.clientSheetsPersonAdmission.updateMany({
    where: {
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      status: "reserved",
    },
    data: { evidenceJson: evidence },
  });
}

function preSendFailure(job: { status: string; appendStartedAt: Date | null; rowsWritten: number }): boolean {
  return job.status === "failed" && job.appendStartedAt == null && job.rowsWritten === 0;
}

export async function releaseKnownDeadSheetsPersonReservation(
  db: SheetsPersonDb,
  input: { clientAccountId: string; sourceLeadEventId: string; actor?: string | null }
): Promise<{ ok: true; released: number } | { ok: false; code: "reservation_not_releasable" | "uncertain_append_held" | "delivery_not_conclusively_unsent" }> {
  const clientAccountId = input.clientAccountId.trim();
  const sourceLeadEventId = input.sourceLeadEventId.trim();
  return inClientLock(db, clientAccountId, async (tx) => {
    const admissions = await tx.clientSheetsPersonAdmission.findMany({
      where: { clientAccountId, sourceLeadEventId, origin: "live_reservation", status: "reserved" },
    });
    if (admissions.length === 0) return { ok: false, code: "reservation_not_releasable" };
    const jobs = await tx.companySheetsDeliveryJob.findMany({
      where: { clientAccountId, sourceLeadEventId },
      select: { id: true, status: true, appendStartedAt: true, rowsWritten: true, kind: true },
    });
    if (jobs.some((job) => job.status === "uncertain" || job.appendStartedAt != null || job.rowsWritten > 0)) {
      return { ok: false, code: "uncertain_append_held" };
    }
    if (jobs.some((job) => !preSendFailure(job))) return { ok: false, code: "delivery_not_conclusively_unsent" };
    await tx.clientSheetsPersonRelease.createMany({
      data: admissions.map((row) => ({
        clientAccountId,
        kind: row.kind,
        normalizedValue: row.normalizedValue,
        fingerprint: row.fingerprint,
        sourceLeadEventId,
        admissionId: row.id,
        policy: row.policy,
        reason: "known_dead_presend_released",
        actor: input.actor ?? null,
        evidenceJson: row.evidenceJson ?? undefined,
      })),
    });
    await tx.clientSheetsPersonAdmission.deleteMany({ where: { id: { in: admissions.map((row) => row.id) } } });
    await writeDecision(tx, {
      clientAccountId,
      sourceLeadEventId,
      idempotencyKey: decisionKey(clientAccountId, sourceLeadEventId),
      outcome: "reservation_released",
      reason: "known_dead_presend_released",
      assessmentState: "not_applicable",
      phone: admissions.find((row) => row.kind === "phone")?.normalizedValue ?? null,
      email: admissions.find((row) => row.kind === "email")?.normalizedValue ?? null,
      priorEvidence: {
        policy: SHEETS_PERSON_POLICY,
        releasedAdmissionIds: admissions.map((row) => row.id),
        actor: input.actor ?? null,
      },
    });
    return { ok: true, released: admissions.length };
  });
}

/**
 * Lists lead jobs created before person admission that execution would still send.
 * This does not update jobs, claim them, or call Google.
 */
export async function planPreMigrationLeadJobQuarantine(
  db: SheetsPersonDb,
  clientAccountId: string
): Promise<{
  strategy: "quarantine_until_reconciled";
  ran: false;
  jobs: Array<{ jobId: string; sourceLeadEventId: string; status: string; reason: "no_person_admission" }>;
}> {
  const id = clientAccountId.trim();
  const jobs = await db.companySheetsDeliveryJob.findMany({
    where: { clientAccountId: id, kind: "lead", status: { in: ["queued", "retryable", "running"] } },
    select: { id: true, sourceLeadEventId: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  const eventIds = [...new Set(jobs.map((job) => job.sourceLeadEventId).filter((value): value is string => Boolean(value)))];
  const covered = eventIds.length
    ? await db.clientSheetsPersonAdmission.findMany({
        where: { clientAccountId: id, sourceLeadEventId: { in: eventIds } },
        select: { sourceLeadEventId: true },
      })
    : [];
  const admitted = new Set(covered.map((row) => row.sourceLeadEventId));
  return {
    strategy: "quarantine_until_reconciled",
    ran: false,
    jobs: jobs
      .filter((job) => job.sourceLeadEventId && !admitted.has(job.sourceLeadEventId))
      .map((job) => ({
        jobId: job.id,
        sourceLeadEventId: job.sourceLeadEventId as string,
        status: job.status,
        reason: "no_person_admission" as const,
      })),
  };
}

export type VerifiedZapBaselineRecord = {
  importKey: string;
  phone?: string | null;
  email?: string | null;
  verifiedAt: string;
  evidenceRef: string;
  name?: string | null;
};

export type ZapBaselineCoverage = {
  ok: true;
  policy: typeof SHEETS_PERSON_POLICY;
  records: number;
  withPhone: number;
  withEmail: number;
  withEitherIdentifier: number;
  skippedNameOnly: number;
  skippedUnverified: number;
  imported: number;
  alreadyPresent: number;
  conflicts: number;
  identifiersAdmitted: number;
};

function zapImportKey(clientAccountId: string, importKey: string): string {
  return `zap:${clientAccountId}:${importKey.trim()}`;
}

function verified(record: VerifiedZapBaselineRecord): boolean {
  if (!record.importKey?.trim() || record.importKey.trim().length > 160) return false;
  if (!record.evidenceRef?.trim() || record.evidenceRef.trim().length < 3) return false;
  const when = Date.parse(record.verifiedAt);
  return Number.isFinite(when);
}

/**
 * Imports an operator-verified Zapier delivery export as an idempotent person
 * baseline. It does not call Zapier, does not read live Zaps, and is not
 * invoked from intake, dispatch, or process startup. Callers pass records they
 * have already verified outside SA360.
 */
export async function importVerifiedZapSheetsBaseline(
  db: PrismaClient,
  input: { clientAccountId: string; records: readonly VerifiedZapBaselineRecord[] }
): Promise<ZapBaselineCoverage | { ok: false; code: "client_required" }> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_required" };
  const coverage: ZapBaselineCoverage = {
    ok: true,
    policy: SHEETS_PERSON_POLICY,
    records: input.records.length,
    withPhone: 0,
    withEmail: 0,
    withEitherIdentifier: 0,
    skippedNameOnly: 0,
    skippedUnverified: 0,
    imported: 0,
    alreadyPresent: 0,
    conflicts: 0,
    identifiersAdmitted: 0,
  };
  await inClientLock(db, clientAccountId, async (tx) => {
    for (const record of input.records) {
      const phone = normalizeSheetsPhone(record.phone);
      const email = normalizeEmail(record.email);
      if (phone) coverage.withPhone += 1;
      if (email) coverage.withEmail += 1;
      if (phone || email) coverage.withEitherIdentifier += 1;
      const importKey = zapImportKey(clientAccountId, record.importKey ?? "");
      const decisionId = `zap-decision:${importKey}`;
      if (!verified(record)) {
        coverage.skippedUnverified += 1;
        await writeDecision(tx, {
          clientAccountId,
          sourceLeadEventId: null,
          idempotencyKey: decisionId,
          outcome: "historical_skipped",
          reason: "unverified_zap_baseline",
          assessmentState: "not_applicable",
          phone,
          email,
          priorEvidence: { importKey: record.importKey ?? "", evidenceRef: record.evidenceRef ?? "" },
        });
        continue;
      }
      if (!phone && !email) {
        coverage.skippedNameOnly += 1;
        await writeDecision(tx, {
          clientAccountId,
          sourceLeadEventId: null,
          idempotencyKey: decisionId,
          outcome: "historical_skipped",
          reason: "name_only_not_an_identifier",
          assessmentState: "not_applicable",
          phone: null,
          email: null,
          priorEvidence: { importKey: record.importKey, name: record.name ?? null },
        });
        continue;
      }
      const wanted = [
        phone ? { kind: "phone" as const, normalizedValue: phone } : null,
        email ? { kind: "email" as const, normalizedValue: email } : null,
      ].filter((row): row is { kind: "phone" | "email"; normalizedValue: string } => row != null);
      const existing = await tx.clientSheetsPersonAdmission.findMany({
        where: {
          clientAccountId,
          OR: [
            { historicalImportKey: importKey },
            ...wanted.map((row) => ({ kind: row.kind, normalizedValue: row.normalizedValue })),
          ],
        },
      });
      const ownedByKey = existing.filter((row) => row.historicalImportKey === importKey);
      const sameSet =
        ownedByKey.length === wanted.length &&
        wanted.every((row) => ownedByKey.some((owned) => owned.kind === row.kind && owned.normalizedValue === row.normalizedValue));
      if (sameSet && ownedByKey.length > 0) {
        coverage.alreadyPresent += 1;
        continue;
      }
      const conflict = wanted.some((row) =>
        existing.some(
          (owned) =>
            owned.kind === row.kind &&
            owned.normalizedValue === row.normalizedValue &&
            owned.historicalImportKey !== importKey
        )
      );
      const keyDrift = ownedByKey.length > 0 && !sameSet;
      if (conflict || keyDrift) {
        coverage.conflicts += 1;
        await writeDecision(tx, {
          clientAccountId,
          sourceLeadEventId: null,
          idempotencyKey: decisionId,
          outcome: "historical_conflict",
          reason: "zap_baseline_conflict",
          assessmentState: "not_applicable",
          phone,
          email,
          priorEvidence: {
            importKey: record.importKey,
            existingAdmissionIds: existing.map((row) => row.id),
          },
        });
        continue;
      }
      await tx.clientSheetsPersonAdmission.createMany({
        data: wanted.map((row) => ({
          clientAccountId,
          kind: row.kind,
          normalizedValue: row.normalizedValue,
          fingerprint: fingerprintIdentityValue(row.kind, row.normalizedValue),
          historicalImportKey: importKey,
          status: "admitted",
          policy: SHEETS_PERSON_POLICY,
          origin: "historical_baseline",
          evidenceJson: {
            importKey: record.importKey.trim(),
            verifiedAt: record.verifiedAt,
            evidenceRef: record.evidenceRef.trim(),
          },
        })),
      });
      coverage.imported += 1;
      coverage.identifiersAdmitted += wanted.length;
      await writeDecision(tx, {
        clientAccountId,
        sourceLeadEventId: null,
        idempotencyKey: decisionId,
        outcome: "historical_baseline",
        reason: "verified_zap_baseline_imported",
        assessmentState: "not_applicable",
        phone,
        email,
        priorEvidence: { importKey: record.importKey.trim(), evidenceRef: record.evidenceRef.trim() },
      });
    }
  });
  return coverage;
}
