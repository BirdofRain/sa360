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
const DELIVERY_HISTORY_CAP = 500;

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
export function classifySheetsPerson(input: {
  sourceLeadEventId: string;
  phone: string | null;
  email: string | null;
  owners: readonly SheetsPersonOwner[];
  historyIncomplete: boolean;
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
    if (!selfOwns && input.historyIncomplete) {
      return { action: "review", reason: "delivery_history_incomplete", evidence };
    }
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
  const deliveryOnly = evidence.length > 0 && evidence.every((owner) => owner.admissionId == null && owner.jobId);
  return {
    action: "block",
    reason: deliveryOnly ? "sheets_delivery_already_recorded" : "normalized_identifier_already_admitted",
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

async function blockingDeliveryOwners(
  db: SheetsPersonDb,
  clientAccountId: string,
  sourceLeadEventId: string
): Promise<{ owners: SheetsPersonOwner[]; historyIncomplete: boolean }> {
  const jobs = await db.companySheetsDeliveryJob.findMany({
    where: {
      AND: [
        { clientAccountId, kind: "lead" },
        { sourceLeadEventId: { not: null } },
        { NOT: { sourceLeadEventId } },
        { NOT: { AND: [{ status: "failed" }, { appendStartedAt: null }, { rowsWritten: 0 }] } },
      ],
    },
    select: {
      id: true,
      status: true,
      sourceLeadEventId: true,
      spreadsheetId: true,
      worksheetId: true,
      appendStartedAt: true,
      rowsWritten: true,
    },
    take: DELIVERY_HISTORY_CAP,
    orderBy: { createdAt: "asc" },
  });
  const historyIncomplete = jobs.length >= DELIVERY_HISTORY_CAP;
  const eventIds = [...new Set(jobs.map((job) => job.sourceLeadEventId).filter((id): id is string => Boolean(id)))];
  if (eventIds.length === 0) return { owners: [], historyIncomplete };
  const leads = await db.sourceLeadEvent.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, normalizedPayloadJson: true },
  });
  const byId = new Map(leads.map((lead) => [lead.id, sheetsPersonIdentifiers(lead.normalizedPayloadJson)]));
  const owners: SheetsPersonOwner[] = [];
  for (const job of jobs) {
    if (!job.sourceLeadEventId) continue;
    const identity = byId.get(job.sourceLeadEventId);
    if (!identity) continue;
    const base = {
      ownerEventId: job.sourceLeadEventId,
      historicalImportKey: null,
      admissionId: null,
      origin: "sheets_delivery_job",
      status: job.status,
      jobId: job.id,
      spreadsheetId: job.spreadsheetId,
      worksheetId: job.worksheetId,
    };
    if (identity.phone) owners.push({ ...base, kind: "phone", normalizedValue: identity.phone });
    if (identity.email) owners.push({ ...base, kind: "email", normalizedValue: identity.email });
  }
  return { owners, historyIncomplete };
}

export async function evaluateClientSheetsPersonGate(
  db: SheetsPersonDb,
  input: { clientAccountId: string; sourceLeadEventId: string }
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
      const result = hold("assessment_failed", "assessment_failed", "assessment_failed", "failed", {
        routingDryRunDecisionId: decisionId,
        errorName: failure.errorName,
      });
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
    const values = [identity.phone, identity.email].filter((value): value is string => Boolean(value));
    const admissions = values.length
      ? await tx.clientSheetsPersonAdmission.findMany({
          where: { clientAccountId, normalizedValue: { in: values } },
        })
      : [];
    const delivery = await blockingDeliveryOwners(tx, clientAccountId, sourceLeadEventId);
    const owners: SheetsPersonOwner[] = [
      ...admissions.map((row) => ({
        kind: row.kind === "email" ? ("email" as const) : ("phone" as const),
        normalizedValue: row.normalizedValue,
        ownerEventId: row.sourceLeadEventId,
        historicalImportKey: row.historicalImportKey,
        admissionId: row.id,
        origin: row.origin,
        status: row.status,
        jobId: null,
        spreadsheetId: null,
        worksheetId: null,
      })),
      ...delivery.owners,
    ];
    const classified = classifySheetsPerson({
      sourceLeadEventId,
      phone: identity.phone,
      email: identity.email,
      owners,
      historyIncomplete: delivery.historyIncomplete,
    });
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
    const priorEvidence = classified.evidence.length > 0 ? evidenceJson(classified.evidence) : null;
    const mapped = mapClassification(classified, assessmentState, priorEvidence);
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
