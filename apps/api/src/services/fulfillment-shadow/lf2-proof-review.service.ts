import { Prisma, type LeadProofReviewActionType, type LeadProofStatus, type PrismaClient } from "@prisma/client";

import { fingerprintLeadUid, maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { prisma } from "../../lib/db.js";
import {
  createLeadProofReviewAuditEvent,
  findLatestAppliedProofApprovalForSourceLead,
  findProofReviewAuditByRequestId,
} from "../../repositories/lead-proof-review-audit.repository.js";
import {
  getLeadProofByLeadUid,
  getLeadVerificationResultByLeadUid,
  upsertLeadProof,
  upsertLeadProofArtifacts,
  upsertLeadSourceSnapshot,
} from "../../repositories/lead-proof.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import { extractLeadProofPacket } from "../lead-proof/lead-proof.service.js";
import {
  getProofRequirementPolicy,
  resolveProofPolicyKey,
} from "../lead-proof/proof-requirement-policy.registry.js";
import { buildProofExtractionPayloadFromSourceLeadEvent } from "./build-proof-extraction-payload.service.js";
import {
  LF2_PROOF_REVIEW_ALLOWED_CANONICAL_LANE,
  LF2_PROOF_REVIEW_ALLOWED_POLICY_KEY,
  LF2_PROOF_REVIEW_APPROVE_CONFIRMATION,
  LF2_PROOF_REVIEW_REJECT_CONFIRMATION,
  LF2_PROOF_REVIEW_REVOKE_CONFIRMATION,
} from "./lf2-proof-review.constants.js";
import {
  buildEvidenceSummary,
  buildLf2ProofReviewPreviewForSourceLead,
  collectProofReviewBlockers,
  type Lf2ProofReviewPreviewPayload,
} from "./lf2-proof-review-preview.service.js";
import { loadLf2ProofReviewExecutionContext } from "./lf2-proof-review-execution-context.service.js";

export type Lf2ProofReviewError =
  | "source_lead_not_found"
  | "source_lead_uid_missing"
  | "malformed_normalized_payload"
  | "client_account_missing"
  | "wrong_source_lane"
  | "wrong_proof_policy"
  | "policy_requires_artifacts"
  | "verification_missing"
  | "verification_not_passed"
  | "duplicate_not_unique"
  | "prior_external_delivery"
  | "prior_ghl_live_run"
  | "live_attempt_succeeded"
  | "live_attempt_active"
  | "live_attempt_unknown_outcome"
  | "allocation_committed"
  | "fulfilled_quantity_nonzero"
  | "proof_rejected"
  | "proof_extraction_failed"
  | "proof_already_attached"
  | "proof_not_attached"
  | "prior_approval_missing"
  | "missing_operator_note"
  | "missing_request_id"
  | "invalid_confirmation_text"
  | "request_id_action_conflict"
  | "proof_review_blocked";

type ProofReviewAction = LeadProofReviewActionType;

export type Lf2ProofReviewMutationSuccess = {
  ok: true;
  reviewStatus: "applied" | "idempotent_replay";
  action: ProofReviewAction;
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  leadProofId: string | null;
  previousProofStatus: LeadProofStatus | null;
  extractedProofStatus: LeadProofStatus | null;
  newProofStatus: LeadProofStatus | null;
  auditEventId: string;
  requestId: string;
  policyKey: string;
  postReviewEligibility: Lf2ProofReviewPreviewPayload["postReviewEligibility"];
  proofReviewPreview: Lf2ProofReviewPreviewPayload;
};

export type Lf2ProofReviewMutationResult =
  | Lf2ProofReviewMutationSuccess
  | { ok: false; error: Lf2ProofReviewError; auditEventId?: string };

export type Lf2ProofReviewMutationInput = {
  sourceLeadEventId: string;
  requestId: string;
  operatorNote: string;
  operatorConfirmationText: string;
  requestedBy?: string | null;
};

type ProofReviewDb = PrismaClient | Prisma.TransactionClient;

type ReviewContext = {
  event: NonNullable<Awaited<ReturnType<typeof findSourceLeadEventById>>>;
  leadUid: string;
  clientAccountId: string;
  canonicalSourceLane: string;
  proofPolicyKey: string;
  requiredArtifactTypes: string[];
  verification: NonNullable<Awaited<ReturnType<typeof getLeadVerificationResultByLeadUid>>>;
  leadProof: Awaited<ReturnType<typeof getLeadProofByLeadUid>>;
  execution: Awaited<ReturnType<typeof loadLf2ProofReviewExecutionContext>>;
  extracted: Extract<ReturnType<typeof extractLeadProofPacket>, { ok: true }>;
};

async function persistExtractedProof(
  extracted: ReviewContext["extracted"],
  targetProofStatus: LeadProofStatus,
  db: PrismaClient | Prisma.TransactionClient
) {
  const persistedProof = await upsertLeadProof(
    {
      ...extracted.proofPacket,
      proofStatus: targetProofStatus,
      proofMissingReasons: targetProofStatus === "PROOF_ATTACHED" ? [] : extracted.proofPacket.proofMissingReasons,
    },
    db
  );
  await upsertLeadSourceSnapshot(extracted.sourceSnapshot, db);
  if (extracted.extractedArtifacts.length > 0) {
    await upsertLeadProofArtifacts(
      extracted.extractedArtifacts.map((artifact) => ({
        leadProofId: persistedProof.id,
        provider: artifact.provider,
        artifactType: artifact.artifactType,
        status: artifact.status,
        externalReference: artifact.externalReference,
        certificateUrl: artifact.certificateUrl,
        integrityHash: artifact.integrityHash,
        signature: artifact.signature,
        algorithm: artifact.algorithm,
        keyId: artifact.keyId,
        capturedAt: artifact.capturedAt,
        issuedAt: artifact.issuedAt,
        verifiedAt: artifact.verifiedAt,
        retainedAt: artifact.retainedAt,
        expiresAt: artifact.expiresAt,
        artifactFingerprint: artifact.artifactFingerprint,
        providerMetadata: artifact.providerMetadata,
        failureReasons: artifact.failureReasons,
        rawArtifactPayload: artifact.rawArtifactPayload,
      })),
      db
    );
  }
  return persistedProof;
}

async function recordRejectedProofReviewAudit(input: {
  db: PrismaClient | Prisma.TransactionClient;
  actionType: ProofReviewAction;
  sourceLeadEventId: string;
  leadUid: string;
  clientAccountId: string;
  canonicalSourceLane: string;
  proofPolicyKey: string;
  requestId: string;
  requestedBy?: string | null;
  operatorNote?: string | null;
  error: Lf2ProofReviewError;
  previousProofStatus?: LeadProofStatus | null;
  extractedProofStatus?: LeadProofStatus | null;
  previousVerification?: {
    verificationStatus: string;
    duplicateStatus: string | null;
  } | null;
  evidenceSummaryJson?: Prisma.InputJsonValue | null;
}) {
  return createLeadProofReviewAuditEvent(
    {
      sourceLeadEventId: input.sourceLeadEventId,
      sourceLeadUidMasked: maskSourceLeadUidForAudit(input.leadUid),
      leadUidFingerprint: fingerprintLeadUid(input.leadUid),
      clientAccountId: input.clientAccountId,
      canonicalSourceLane: input.canonicalSourceLane,
      proofPolicyKey: input.proofPolicyKey,
      actionType: input.actionType,
      previousProofStatus: input.previousProofStatus ?? null,
      extractedProofStatus: input.extractedProofStatus ?? null,
      previousVerificationStatus: input.previousVerification?.verificationStatus as never,
      previousDuplicateStatus: input.previousVerification?.duplicateStatus as never,
      reviewStatus: "rejected",
      evidenceSummaryJson: input.evidenceSummaryJson ?? undefined,
      reasonsJson: { error: input.error, operatorNote: input.operatorNote ?? null },
      requestedBy: input.requestedBy ?? null,
      operatorNote: input.operatorNote ?? null,
      requestId: input.requestId,
    },
    input.db
  );
}

async function loadReviewContext(
  sourceLeadEventId: string,
  db: ProofReviewDb,
  options?: { requireVerification?: boolean }
): Promise<
  | { ok: true; ctx: ReviewContext }
  | { ok: false; error: Lf2ProofReviewError; event?: Awaited<ReturnType<typeof findSourceLeadEventById>> }
> {
  const event = await findSourceLeadEventById(sourceLeadEventId, db);
  if (!event) return { ok: false, error: "source_lead_not_found" };

  const leadUid = event.sourceLeadUid?.trim() || null;
  if (!leadUid) return { ok: false, error: "source_lead_uid_missing", event };

  if (event.normalizedPayloadJson !== null && readNormalizedLeadIdentity(event.normalizedPayloadJson) === null) {
    return { ok: false, error: "malformed_normalized_payload", event };
  }

  const clientAccountId = event.clientAccountIdResolved?.trim() || null;
  if (!clientAccountId) return { ok: false, error: "client_account_missing", event };

  const canonicalSourceLane = resolveCanonicalSourceLane(event);
  const proofPolicyKey = resolveProofPolicyKey(canonicalSourceLane);
  const proofPolicy = getProofRequirementPolicy(canonicalSourceLane);
  const requiredArtifactTypes = proofPolicy.requiredArtifacts.map((item) => item.artifactType);

  const verification = await getLeadVerificationResultByLeadUid(leadUid, db);
  const leadProof = await getLeadProofByLeadUid(leadUid, db);
  const execution = await loadLf2ProofReviewExecutionContext(event, db);

  const extractionPayload = buildProofExtractionPayloadFromSourceLeadEvent(event);
  const extracted = extractionPayload ? extractLeadProofPacket(extractionPayload) : null;
  if (!extracted?.ok) return { ok: false, error: "proof_extraction_failed", event };

  if (options?.requireVerification !== false && !verification) {
    return { ok: false, error: "verification_missing", event };
  }

  return {
    ok: true,
    ctx: {
      event,
      leadUid,
      clientAccountId,
      canonicalSourceLane,
      proofPolicyKey,
      requiredArtifactTypes,
      verification: verification ?? {
        id: "synthetic_uncheck",
        leadUid,
        verificationStatus: "UNCHECKED",
        duplicateStatus: "UNCHECKED",
        phoneStatus: null,
        emailStatus: null,
        suppressionStatus: null,
        qualityScore: null,
        reasons: null,
        checkedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      leadProof,
      execution,
      extracted,
    },
  };
}

function validateMutationInput(
  input: Lf2ProofReviewMutationInput,
  expectedConfirmation: string,
  action: ProofReviewAction
): Lf2ProofReviewError | null {
  if (!input.requestId?.trim()) return "missing_request_id";
  if (!input.operatorNote?.trim()) return "missing_operator_note";
  if (input.operatorConfirmationText.trim() !== expectedConfirmation) return "invalid_confirmation_text";
  void action;
  return null;
}

async function handleIdempotentReplay(input: {
  sourceLeadEventId: string;
  requestId: string;
  actionType: ProofReviewAction;
  db: ProofReviewDb;
}): Promise<Lf2ProofReviewMutationResult | null> {
  const prior = await findProofReviewAuditByRequestId(input.sourceLeadEventId, input.requestId, input.db);
  if (!prior) return null;

  if (prior.actionType !== input.actionType) {
    return { ok: false, error: "request_id_action_conflict", auditEventId: prior.id };
  }

  if (prior.reviewStatus === "rejected") {
    return { ok: false, error: "proof_review_blocked", auditEventId: prior.id };
  }

  const previewResult = await buildLf2ProofReviewPreviewForSourceLead(input.sourceLeadEventId, input.db);
  if (!previewResult.ok) return { ok: false, error: previewResult.error };

  return {
    ok: true,
    reviewStatus: "idempotent_replay",
    action: input.actionType,
    sourceLeadEventId: input.sourceLeadEventId,
    maskedSourceLeadUid: prior.sourceLeadUidMasked,
    leadProofId: prior.leadProofId,
    previousProofStatus: prior.previousProofStatus,
    extractedProofStatus: prior.extractedProofStatus,
    newProofStatus: prior.newProofStatus,
    auditEventId: prior.id,
    requestId: input.requestId.trim(),
    policyKey: prior.proofPolicyKey,
    postReviewEligibility: previewResult.preview.postReviewEligibility,
    proofReviewPreview: previewResult.preview,
  };
}

async function runProofReviewMutation(
  input: Lf2ProofReviewMutationInput,
  actionType: ProofReviewAction,
  expectedConfirmation: string,
  targetProofStatus: LeadProofStatus,
  db: ProofReviewDb,
  options?: {
    requireVerification?: boolean;
    extraBlockers?: (ctx: ReviewContext) => Promise<string[]>;
    collectBlockers?: (ctx: ReviewContext) => string[];
  }
): Promise<Lf2ProofReviewMutationResult> {
  const inputError = validateMutationInput(input, expectedConfirmation, actionType);
  if (inputError) return { ok: false, error: inputError };

  const replay = await handleIdempotentReplay({
    sourceLeadEventId: input.sourceLeadEventId,
    requestId: input.requestId,
    actionType,
    db,
  });
  if (replay) return replay;

  const loaded = await loadReviewContext(input.sourceLeadEventId, db, {
    requireVerification: options?.requireVerification,
  });
  if (!loaded.ok) {
    if (loaded.event) {
      const leadUid = loaded.event.sourceLeadUid?.trim();
      const clientAccountId = loaded.event.clientAccountIdResolved?.trim();
      if (leadUid && clientAccountId) {
        const lane = resolveCanonicalSourceLane(loaded.event);
        const policyKey = resolveProofPolicyKey(lane);
        const audit = await recordRejectedProofReviewAudit({
          db,
          actionType,
          sourceLeadEventId: loaded.event.id,
          leadUid,
          clientAccountId,
          canonicalSourceLane: lane,
          proofPolicyKey: policyKey,
          requestId: input.requestId,
          requestedBy: input.requestedBy,
          operatorNote: input.operatorNote,
          error: loaded.error,
        });
        return { ok: false, error: loaded.error, auditEventId: audit.id };
      }
    }
    return { ok: false, error: loaded.error };
  }

  const { ctx } = loaded;
  const blockers =
    options?.collectBlockers?.(ctx) ??
    collectProofReviewBlockers({
      leadUid: ctx.leadUid,
      clientAccountId: ctx.clientAccountId,
      canonicalSourceLane: ctx.canonicalSourceLane,
      proofPolicyKey: ctx.proofPolicyKey,
      requiredArtifactTypes: ctx.requiredArtifactTypes,
      verification: ctx.verification,
      leadProof: ctx.leadProof,
      extractionOk: true,
      execution: ctx.execution,
      malformedPayload: false,
      forAction: actionType === "APPROVE_PROOF" ? "approve" : actionType === "REVOKE_TO_REVIEW" ? "revoke" : undefined,
    });

  if (options?.extraBlockers) {
    blockers.push(...(await options.extraBlockers(ctx)));
  }

  const evidenceSummary = buildEvidenceSummary(ctx.extracted, ctx.proofPolicyKey);

  if (blockers.length > 0) {
    const audit = await recordRejectedProofReviewAudit({
      db,
      actionType,
      sourceLeadEventId: ctx.event.id,
      leadUid: ctx.leadUid,
      clientAccountId: ctx.clientAccountId,
      canonicalSourceLane: ctx.canonicalSourceLane,
      proofPolicyKey: ctx.proofPolicyKey,
      requestId: input.requestId,
      requestedBy: input.requestedBy,
      operatorNote: input.operatorNote,
      error: blockers[0] as Lf2ProofReviewError,
      previousProofStatus: ctx.leadProof?.proofStatus ?? null,
      extractedProofStatus: ctx.extracted.proofPacket.proofStatus,
      previousVerification: ctx.verification,
      evidenceSummaryJson: evidenceSummary,
    });
    return { ok: false, error: blockers[0] as Lf2ProofReviewError, auditEventId: audit.id };
  }

  try {
    return await (db as PrismaClient).$transaction(async (tx) => {
      const raceReplay = await findProofReviewAuditByRequestId(ctx.event.id, input.requestId, tx);
      if (raceReplay) {
        if (raceReplay.actionType !== actionType) {
          return { ok: false as const, error: "request_id_action_conflict" as const, auditEventId: raceReplay.id };
        }
        if (raceReplay.reviewStatus === "rejected") {
          return { ok: false as const, error: "proof_review_blocked" as const, auditEventId: raceReplay.id };
        }
        const previewResult = await buildLf2ProofReviewPreviewForSourceLead(ctx.event.id, tx);
        if (!previewResult.ok) return { ok: false as const, error: previewResult.error };
        return {
          ok: true as const,
          reviewStatus: "idempotent_replay" as const,
          action: actionType,
          sourceLeadEventId: ctx.event.id,
          maskedSourceLeadUid: raceReplay.sourceLeadUidMasked,
          leadProofId: raceReplay.leadProofId,
          previousProofStatus: raceReplay.previousProofStatus,
          extractedProofStatus: raceReplay.extractedProofStatus,
          newProofStatus: raceReplay.newProofStatus,
          auditEventId: raceReplay.id,
          requestId: input.requestId.trim(),
          policyKey: raceReplay.proofPolicyKey,
          postReviewEligibility: previewResult.preview.postReviewEligibility,
          proofReviewPreview: previewResult.preview,
        };
      }

      const previousProofStatus = ctx.leadProof?.proofStatus ?? null;
      const persistedProof = await persistExtractedProof(ctx.extracted, targetProofStatus, tx);
      const audit = await createLeadProofReviewAuditEvent(
        {
          sourceLeadEventId: ctx.event.id,
          leadProofId: persistedProof.id,
          sourceLeadUidMasked: maskSourceLeadUidForAudit(ctx.leadUid),
          leadUidFingerprint: fingerprintLeadUid(ctx.leadUid),
          clientAccountId: ctx.clientAccountId,
          canonicalSourceLane: ctx.canonicalSourceLane,
          proofPolicyKey: ctx.proofPolicyKey,
          actionType,
          previousProofStatus,
          extractedProofStatus: ctx.extracted.proofPacket.proofStatus,
          newProofStatus: targetProofStatus,
          previousVerificationStatus: ctx.verification.verificationStatus,
          previousDuplicateStatus: ctx.verification.duplicateStatus,
          reviewStatus: "applied",
          evidenceSummaryJson: evidenceSummary,
          reasonsJson: { operatorNote: input.operatorNote.trim() },
          requestedBy: input.requestedBy ?? null,
          operatorNote: input.operatorNote.trim(),
          requestId: input.requestId,
        },
        tx
      );

      const previewResult = await buildLf2ProofReviewPreviewForSourceLead(ctx.event.id, tx);
      if (!previewResult.ok) return { ok: false as const, error: previewResult.error };

      return {
        ok: true as const,
        reviewStatus: "applied" as const,
        action: actionType,
        sourceLeadEventId: ctx.event.id,
        maskedSourceLeadUid: maskSourceLeadUidForAudit(ctx.leadUid),
        leadProofId: persistedProof.id,
        previousProofStatus,
        extractedProofStatus: ctx.extracted.proofPacket.proofStatus,
        newProofStatus: targetProofStatus,
        auditEventId: audit.id,
        requestId: input.requestId.trim(),
        policyKey: ctx.proofPolicyKey,
        postReviewEligibility: previewResult.preview.postReviewEligibility,
        proofReviewPreview: previewResult.preview,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raceReplay = await findProofReviewAuditByRequestId(ctx.event.id, input.requestId, db);
      if (raceReplay) {
        return (
          (await handleIdempotentReplay({
            sourceLeadEventId: ctx.event.id,
            requestId: input.requestId,
            actionType,
            db,
          })) ?? { ok: false, error: "proof_review_blocked", auditEventId: raceReplay.id }
        );
      }
    }
    throw err;
  }
}

export async function approveLf2ProofReviewForSourceLead(
  input: Lf2ProofReviewMutationInput,
  db: ProofReviewDb = prisma
): Promise<Lf2ProofReviewMutationResult> {
  return runProofReviewMutation(
    input,
    "APPROVE_PROOF",
    LF2_PROOF_REVIEW_APPROVE_CONFIRMATION,
    "PROOF_ATTACHED",
    db,
    { requireVerification: true }
  );
}

export async function rejectLf2ProofReviewForSourceLead(
  input: Lf2ProofReviewMutationInput,
  db: ProofReviewDb = prisma
): Promise<Lf2ProofReviewMutationResult> {
  return runProofReviewMutation(
    input,
    "REJECT_PROOF",
    LF2_PROOF_REVIEW_REJECT_CONFIRMATION,
    "REJECTED",
    db,
    {
      requireVerification: false,
      collectBlockers: (ctx) => {
        const blockers: string[] = [];
        if (ctx.canonicalSourceLane !== LF2_PROOF_REVIEW_ALLOWED_CANONICAL_LANE) blockers.push("wrong_source_lane");
        if (ctx.proofPolicyKey !== LF2_PROOF_REVIEW_ALLOWED_POLICY_KEY) blockers.push("wrong_proof_policy");
        if (ctx.requiredArtifactTypes.length > 0) blockers.push("policy_requires_artifacts");
        if (ctx.execution.priorExternalDeliveryEvidence) blockers.push("prior_external_delivery");
        if (ctx.execution.hasSucceededLiveAttempt) blockers.push("live_attempt_succeeded");
        if (ctx.execution.hasActiveLiveAttempt) blockers.push("live_attempt_active");
        if (ctx.execution.hasUnknownOutcomeLiveAttempt) blockers.push("live_attempt_unknown_outcome");
        if (ctx.execution.allocationCommitted) blockers.push("allocation_committed");
        if (ctx.execution.fulfilledQuantity > 0) blockers.push("fulfilled_quantity_nonzero");
        return blockers;
      },
    }
  );
}

export async function revokeLf2ProofReviewForSourceLead(
  input: Lf2ProofReviewMutationInput,
  db: ProofReviewDb = prisma
): Promise<Lf2ProofReviewMutationResult> {
  return runProofReviewMutation(
    input,
    "REVOKE_TO_REVIEW",
    LF2_PROOF_REVIEW_REVOKE_CONFIRMATION,
    "NEEDS_REVIEW",
    db,
    {
      requireVerification: true,
      extraBlockers: async (ctx) => {
        const blockers: string[] = [];
        const priorApproval = await findLatestAppliedProofApprovalForSourceLead(ctx.event.id, db);
        if (!priorApproval) blockers.push("prior_approval_missing");
        return blockers;
      },
    }
  );
}
