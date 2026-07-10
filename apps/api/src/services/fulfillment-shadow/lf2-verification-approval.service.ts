import type { LeadDuplicateStatus, LeadVerificationStatus, PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue, maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { prisma } from "../../lib/db.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  createLeadVerificationApprovalAuditEvent,
  findAppliedVerificationApprovalByRequestId,
} from "../../repositories/lead-verification-approval-audit.repository.js";
import {
  getLeadVerificationResultByLeadUid,
  upsertLeadVerificationResult,
} from "../../repositories/lead-proof.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import {
  buildEligibilityPreviewForSourceLead,
  type EligibilityPreviewPayload,
} from "./eligibility-preview.service.js";
import {
  runLf2GhlDuplicateSearchForSourceLead,
  type Lf2GhlDuplicateSearchSummary,
} from "./lf2-ghl-duplicate-search.service.js";

export type Lf2VerificationApprovalError =
  | "source_lead_not_found"
  | "source_lead_uid_missing"
  | "malformed_normalized_payload"
  | "client_account_missing"
  | "destination_missing"
  | "destination_mismatch"
  | "identity_missing"
  | "identity_incomplete"
  | "prior_delivery_evidence"
  | "verification_blocked"
  | "duplicate_search_not_clear";

export type Lf2VerificationApprovalSuccess = {
  approvalStatus: "applied" | "idempotent_replay";
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  action: "APPROVE_UNIQUE";
  duplicateSearchClassification: string;
  duplicateSearchReasonCode: string | null;
  previousVerificationStatus: LeadVerificationStatus | null;
  previousDuplicateStatus: LeadDuplicateStatus | null;
  newVerificationStatus: LeadVerificationStatus;
  newDuplicateStatus: LeadDuplicateStatus | null;
  auditEventId: string;
  postApprovalEligibilityPreview: EligibilityPreviewPayload;
};

export type Lf2VerificationApprovalResult =
  | { ok: true } & Lf2VerificationApprovalSuccess
  | {
      ok: false;
      error: Lf2VerificationApprovalError;
      auditEventId?: string;
      duplicateSearchClassification?: string | null;
      duplicateSearchReasonCode?: string | null;
    };

export type ApproveLf2DuplicateVerificationInput = {
  sourceLeadEventId: string;
  requestedBy?: string | null;
  requestId?: string | null;
  operatorNote?: string | null;
};

export type Lf2VerificationApprovalDeps = {
  findSourceLeadEventById?: typeof findSourceLeadEventById;
  findClientAccountById?: typeof findClientAccountById;
  runGhlDuplicateSearch?: typeof runLf2GhlDuplicateSearchForSourceLead;
  buildEligibilityPreview?: typeof buildEligibilityPreviewForSourceLead;
};

const BLOCKED_DUPLICATE_STATUSES = new Set<LeadDuplicateStatus>([
  "DUPLICATE_GLOBAL",
  "DUPLICATE_BUYER",
  "DUPLICATE_RECENT",
  "POSSIBLE_MATCH",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasPriorDeliveryEvidence(event: {
  deliveredAt: Date | null;
  deliveryResultJson: unknown;
  routingDryRunDecisionId: string | null;
  sourceLeadUid: string | null;
}): boolean {
  if (event.deliveredAt) return true;
  const delivery = asRecord(event.deliveryResultJson);
  if (delivery) {
    if (delivery.externalCallExecuted === true) return true;
    const mode = typeof delivery.mode === "string" ? delivery.mode.trim().toLowerCase() : "";
    if (mode === "live_canary" || mode === "live") return true;
    if (typeof delivery.contactIdGhl === "string" && delivery.contactIdGhl.trim()) return true;
  }
  return false;
}

async function hasPriorLf2OrLiveRunEvidence(
  event: {
    id: string;
    routingDryRunDecisionId: string | null;
    sourceLeadUid: string | null;
  },
  db: PrismaClient
): Promise<boolean> {
  const allocationCount = await db.leadAllocation.count({
    where: { sourceLeadEventId: event.id },
  });
  if (allocationCount > 0) return true;

  const attemptCount = await db.deliveryAttempt.count({
    where: { deliveryInstruction: { leadAllocation: { sourceLeadEventId: event.id } } },
  });
  if (attemptCount > 0) return true;

  if (event.routingDryRunDecisionId) {
    const liveRunCount = await db.ghlLiveDeliveryRun.count({
      where: { routingDryRunDecisionId: event.routingDryRunDecisionId },
    });
    if (liveRunCount > 0) return true;
  }

  if (event.sourceLeadUid) {
    const planLiveRunCount = await db.ghlLiveDeliveryRun.count({
      where: { leadDeliveryPlan: { sourceLeadUid: event.sourceLeadUid } },
    });
    if (planLiveRunCount > 0) return true;
  }

  return false;
}

async function recordRejectedAudit(input: {
  db: PrismaClient;
  sourceLeadEventId: string;
  leadUid: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  requestedBy?: string | null;
  requestId?: string | null;
  operatorNote?: string | null;
  error: Lf2VerificationApprovalError;
  previousVerification?: {
    verificationStatus: LeadVerificationStatus;
    duplicateStatus: LeadDuplicateStatus | null;
  } | null;
  phoneFingerprint?: string | null;
  emailFingerprint?: string | null;
  duplicateSearch?: Lf2GhlDuplicateSearchSummary | null;
}) {
  return createLeadVerificationApprovalAuditEvent(
    {
      sourceLeadEventId: input.sourceLeadEventId,
      sourceLeadUidMasked: maskSourceLeadUidForAudit(input.leadUid),
      leadUid: input.leadUid,
      clientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
      actionType: "APPROVE_UNIQUE",
      previousVerificationStatus: input.previousVerification?.verificationStatus ?? null,
      previousDuplicateStatus: input.previousVerification?.duplicateStatus ?? null,
      phoneFingerprint: input.phoneFingerprint ?? null,
      emailFingerprint: input.emailFingerprint ?? null,
      duplicateSearchClassification: input.duplicateSearch?.classification ?? null,
      duplicateSearchReasonCode: input.duplicateSearch?.reasonCode ?? null,
      phoneSearchOutcome: input.duplicateSearch?.phoneSearchOutcome ?? null,
      emailSearchOutcome: input.duplicateSearch?.emailSearchOutcome ?? null,
      matchedContactIdGhl: input.duplicateSearch?.matchedContactIdGhl ?? null,
      approvalStatus: "rejected",
      reasonsJson: {
        error: input.error,
        operatorNote: input.operatorNote ?? null,
      },
      metadataJson: {
        rejectedAt: new Date().toISOString(),
      },
      requestedBy: input.requestedBy ?? null,
      requestId: input.requestId ?? null,
    },
    input.db
  );
}

export async function approveLf2DuplicateVerificationForSourceLead(
  input: ApproveLf2DuplicateVerificationInput,
  db: PrismaClient = prisma,
  deps: Lf2VerificationApprovalDeps = {}
): Promise<Lf2VerificationApprovalResult> {
  const loadSourceLead = deps.findSourceLeadEventById ?? findSourceLeadEventById;
  const loadClientAccount = deps.findClientAccountById ?? findClientAccountById;
  const runDuplicateSearch = deps.runGhlDuplicateSearch ?? runLf2GhlDuplicateSearchForSourceLead;
  const buildPreview = deps.buildEligibilityPreview ?? buildEligibilityPreviewForSourceLead;

  const event = await loadSourceLead(input.sourceLeadEventId, db);
  if (!event) {
    return { ok: false, error: "source_lead_not_found" };
  }

  const leadUid = event.sourceLeadUid?.trim() || null;
  if (!leadUid) {
    return { ok: false, error: "source_lead_uid_missing" };
  }

  if (event.normalizedPayloadJson !== null && readNormalizedLeadIdentity(event.normalizedPayloadJson) === null) {
    return { ok: false, error: "malformed_normalized_payload" };
  }

  const clientAccountId = event.clientAccountIdResolved?.trim() || null;
  if (!clientAccountId) {
    return { ok: false, error: "client_account_missing" };
  }

  const client = await loadClientAccount(clientAccountId, db);
  const destinationSubaccountIdGhl = client?.ghlDestination?.destinationSubaccountIdGhl?.trim() || null;
  if (!destinationSubaccountIdGhl) {
    return { ok: false, error: "destination_missing" };
  }

  const resolvedDestination = event.destinationLocationIdResolved?.trim() || null;
  if (resolvedDestination && resolvedDestination !== destinationSubaccountIdGhl) {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "destination_mismatch",
    });
    return { ok: false, error: "destination_mismatch", auditEventId: audit.id };
  }

  const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
  const phone = identity?.phoneE164 ?? null;
  const email = identity?.email ?? null;
  const phoneFingerprint = phone ? fingerprintIdentityValue("phone", phone) : null;
  const emailFingerprint = email ? fingerprintIdentityValue("email", email) : null;

  if (!phone && !email) {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "identity_missing",
      phoneFingerprint,
      emailFingerprint,
    });
    return { ok: false, error: "identity_missing", auditEventId: audit.id };
  }

  if (!phone || !email) {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "identity_incomplete",
      phoneFingerprint,
      emailFingerprint,
    });
    return { ok: false, error: "identity_incomplete", auditEventId: audit.id };
  }

  const existingVerification = await getLeadVerificationResultByLeadUid(leadUid, db);
  if (
    existingVerification?.duplicateStatus &&
    BLOCKED_DUPLICATE_STATUSES.has(existingVerification.duplicateStatus)
  ) {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "verification_blocked",
      previousVerification: existingVerification,
      phoneFingerprint,
      emailFingerprint,
    });
    return { ok: false, error: "verification_blocked", auditEventId: audit.id };
  }

  if (hasPriorDeliveryEvidence(event)) {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "prior_delivery_evidence",
      previousVerification: existingVerification,
      phoneFingerprint,
      emailFingerprint,
    });
    return { ok: false, error: "prior_delivery_evidence", auditEventId: audit.id };
  }

  if (await hasPriorLf2OrLiveRunEvidence(event, db)) {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "prior_delivery_evidence",
      previousVerification: existingVerification,
      phoneFingerprint,
      emailFingerprint,
    });
    return { ok: false, error: "prior_delivery_evidence", auditEventId: audit.id };
  }

  const requestId = input.requestId?.trim() || null;
  if (requestId) {
    const priorAudit = await findAppliedVerificationApprovalByRequestId(requestId, db);
    if (priorAudit && priorAudit.leadUid === leadUid) {
      const previewResult = await buildPreview(event.id, db);
      const verification = await getLeadVerificationResultByLeadUid(leadUid, db);
      if (!previewResult.ok || !verification) {
        return { ok: false, error: "duplicate_search_not_clear" };
      }
      return {
        ok: true,
        approvalStatus: "idempotent_replay",
        sourceLeadEventId: event.id,
        maskedSourceLeadUid: maskSourceLeadUidForAudit(leadUid),
        clientAccountId: priorAudit.clientAccountId,
        destinationSubaccountIdGhl: priorAudit.destinationSubaccountIdGhl,
        action: "APPROVE_UNIQUE",
        duplicateSearchClassification: priorAudit.duplicateSearchClassification ?? "no_duplicate_found",
        duplicateSearchReasonCode: priorAudit.duplicateSearchReasonCode,
        previousVerificationStatus: priorAudit.previousVerificationStatus,
        previousDuplicateStatus: priorAudit.previousDuplicateStatus,
        newVerificationStatus: verification.verificationStatus,
        newDuplicateStatus: verification.duplicateStatus,
        auditEventId: priorAudit.id,
        postApprovalEligibilityPreview: previewResult.preview,
      };
    }
  }

  const duplicateSearchResult = await runDuplicateSearch(event.id, db);
  if (!duplicateSearchResult.ok) {
    return { ok: false, error: "source_lead_not_found" };
  }

  const duplicateSearch = duplicateSearchResult.summary;
  if (duplicateSearch.classification !== "no_duplicate_found") {
    const audit = await recordRejectedAudit({
      db,
      sourceLeadEventId: event.id,
      leadUid,
      clientAccountId,
      destinationSubaccountIdGhl,
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      operatorNote: input.operatorNote,
      error: "duplicate_search_not_clear",
      previousVerification: existingVerification,
      phoneFingerprint,
      emailFingerprint,
      duplicateSearch,
    });
    return {
      ok: false,
      error: "duplicate_search_not_clear",
      auditEventId: audit.id,
      duplicateSearchClassification: duplicateSearch.classification,
      duplicateSearchReasonCode: duplicateSearch.reasonCode,
    };
  }

  const checkedAt = new Date();
  const alreadyApproved =
    existingVerification?.duplicateStatus === "UNIQUE" &&
    existingVerification.verificationStatus === "PASSED";
  const approvalStatus = alreadyApproved ? "idempotent_replay" : "applied";

  const reasons = {
    source: "lf2_authoritative_ghl_duplicate_search",
    sourceLeadEventId: event.id,
    clientAccountId,
    destinationSubaccountIdGhl,
    classification: duplicateSearch.classification,
    reasonCode: duplicateSearch.reasonCode,
    phoneSearchOutcome: duplicateSearch.phoneSearchOutcome,
    emailSearchOutcome: duplicateSearch.emailSearchOutcome,
    phoneFingerprint,
    emailFingerprint,
    operatorNote: input.operatorNote ?? null,
    requestedBy: input.requestedBy ?? null,
    requestId,
  };

  const result = await db.$transaction(async (tx) => {
    const verification = await upsertLeadVerificationResult(
      {
        leadUid,
        verificationStatus: "PASSED",
        duplicateStatus: "UNIQUE",
        phoneStatus: "verified_unique",
        emailStatus: "verified_unique",
        reasons,
        checkedAt,
      },
      tx
    );

    const audit = await createLeadVerificationApprovalAuditEvent(
      {
        sourceLeadEventId: event.id,
        sourceLeadUidMasked: maskSourceLeadUidForAudit(leadUid),
        leadUid,
        clientAccountId,
        destinationSubaccountIdGhl,
        actionType: "APPROVE_UNIQUE",
        previousVerificationStatus: existingVerification?.verificationStatus ?? null,
        previousDuplicateStatus: existingVerification?.duplicateStatus ?? null,
        newVerificationStatus: verification.verificationStatus,
        newDuplicateStatus: verification.duplicateStatus,
        phoneFingerprint,
        emailFingerprint,
        duplicateSearchClassification: duplicateSearch.classification,
        duplicateSearchReasonCode: duplicateSearch.reasonCode,
        phoneSearchOutcome: duplicateSearch.phoneSearchOutcome,
        emailSearchOutcome: duplicateSearch.emailSearchOutcome,
        matchedContactIdGhl: duplicateSearch.matchedContactIdGhl,
        approvalStatus,
        reasonsJson: reasons,
        metadataJson: {
          approvedAt: checkedAt.toISOString(),
          operatorNote: input.operatorNote ?? null,
        },
        requestedBy: input.requestedBy ?? null,
        requestId,
      },
      tx
    );

    return { verification, audit };
  });

  const previewResult = await buildPreview(event.id, db);
  if (!previewResult.ok) {
    return { ok: false, error: previewResult.error === "malformed_normalized_payload" ? "malformed_normalized_payload" : "source_lead_not_found" };
  }

  return {
    ok: true,
    approvalStatus,
    sourceLeadEventId: event.id,
    maskedSourceLeadUid: maskSourceLeadUidForAudit(leadUid),
    clientAccountId,
    destinationSubaccountIdGhl,
    action: "APPROVE_UNIQUE",
    duplicateSearchClassification: duplicateSearch.classification,
    duplicateSearchReasonCode: duplicateSearch.reasonCode,
    previousVerificationStatus: existingVerification?.verificationStatus ?? null,
    previousDuplicateStatus: existingVerification?.duplicateStatus ?? null,
    newVerificationStatus: result.verification.verificationStatus,
    newDuplicateStatus: result.verification.duplicateStatus,
    auditEventId: result.audit.id,
    postApprovalEligibilityPreview: previewResult.preview,
  };
}
