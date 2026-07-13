import type { LeadProof, LeadProofStatus, LeadVerificationResult, Prisma, PrismaClient } from "@prisma/client";

import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { prisma } from "../../lib/db.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import {
  getLeadProofByLeadUid,
  getLeadProofWithArtifactsByLeadUid,
  getLeadVerificationResultByLeadUid,
} from "../../repositories/lead-proof.repository.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import {
  getProofRequirementPolicy,
  resolveProofPolicyKey,
} from "../lead-proof/proof-requirement-policy.registry.js";
import { extractLeadProofPacket, type LeadProofExtractSuccess } from "../lead-proof/lead-proof.service.js";
import { buildProofExtractionPayloadFromSourceLeadEvent } from "./build-proof-extraction-payload.service.js";
import {
  LF2_PROOF_REVIEW_ALLOWED_CANONICAL_LANE,
  LF2_PROOF_REVIEW_ALLOWED_POLICY_KEY,
} from "./lf2-proof-review.constants.js";
import { evaluateLeadEligibility } from "./eligibility.service.js";
import { loadLf2ProofReviewExecutionContext } from "./lf2-proof-review-execution-context.service.js";
import { findLatestAppliedProofApprovalForSourceLead } from "../../repositories/lead-proof-review-audit.repository.js";

export type Lf2ProofReviewPreviewError =
  | "source_lead_not_found"
  | "source_lead_uid_missing"
  | "malformed_normalized_payload";

export type Lf2ProofReviewPreviewPayload = {
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  clientAccountId: string | null;
  canonicalSourceLane: string;
  proofPolicyKey: string;
  requiredArtifactTypes: string[];
  leadProofId: string | null;
  currentProofStatus: LeadProofStatus | null;
  extractedProofStatus: LeadProofStatus | null;
  extractedMissingFieldNames: string[];
  extractedProofSignalPresence: {
    sourceLeadId: boolean;
    sourcePlatform: boolean;
    sourceType: boolean;
    consentText: boolean;
    consentVersion: boolean;
    submittedAt: boolean;
    formReference: boolean;
    phoneE164: boolean;
    email: boolean;
  };
  verificationStatus: string | null;
  duplicateStatus: string | null;
  simulationAttemptCount: number;
  liveAttemptCount: number;
  allocationStatus: string | null;
  committed: boolean;
  fulfilled: boolean;
  priorExternalDeliveryEvidence: boolean;
  canApprove: boolean;
  canReject: boolean;
  canRevoke: boolean;
  blockers: string[];
  warnings: string[];
  postReviewEligibility: {
    status: "eligible" | "review_required" | "ineligible";
    reasonCodes: string[];
  };
};

export type Lf2ProofReviewPreviewResult =
  | { ok: true; preview: Lf2ProofReviewPreviewPayload }
  | { ok: false; error: Lf2ProofReviewPreviewError };

export type Lf2ProofReviewEligibilityBlocker =
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
  | "proof_already_attached";

function buildProofSignalPresence(packet: LeadProofExtractSuccess["proofPacket"]) {
  return {
    sourceLeadId: Boolean(packet.sourceLeadId),
    sourcePlatform: Boolean(packet.sourcePlatform),
    sourceType: Boolean(packet.sourceType),
    consentText: Boolean(packet.consentText),
    consentVersion: Boolean(packet.consentVersion),
    submittedAt: Boolean(packet.submittedAt),
    formReference: Boolean(packet.formId || packet.formName),
    phoneE164: Boolean(packet.phoneE164),
    email: Boolean(packet.email),
  };
}

function buildEvidenceSummary(extracted: LeadProofExtractSuccess, policyKey: string) {
  const packet = extracted.proofPacket;
  return {
    extractionOk: true,
    extractedProofStatus: packet.proofStatus,
    extractedMissingFields: extracted.missingProofFields,
    extractedMissingReasons: packet.proofMissingReasons,
    proofSignalPresence: buildProofSignalPresence(packet),
    policyKey,
    requiredArtifactsEmpty: true,
    artifactCount: extracted.extractedArtifacts.length,
  };
}

export { buildEvidenceSummary, buildProofSignalPresence };

export function collectProofReviewBlockers(input: {
  leadUid: string | null;
  clientAccountId: string | null;
  canonicalSourceLane: string;
  proofPolicyKey: string;
  requiredArtifactTypes: string[];
  verification: Pick<LeadVerificationResult, "verificationStatus" | "duplicateStatus"> | null;
  leadProof: Pick<LeadProof, "proofStatus"> | null;
  extractionOk: boolean;
  execution: Awaited<ReturnType<typeof loadLf2ProofReviewExecutionContext>>;
  malformedPayload: boolean;
  forAction?: "approve" | "reject" | "revoke";
}): string[] {
  const blockers: string[] = [];
  if (!input.leadUid) blockers.push("source_lead_uid_missing");
  if (input.malformedPayload) blockers.push("malformed_normalized_payload");
  if (!input.clientAccountId) blockers.push("client_account_missing");
  if (input.canonicalSourceLane !== LF2_PROOF_REVIEW_ALLOWED_CANONICAL_LANE) {
    blockers.push("wrong_source_lane");
  }
  if (input.proofPolicyKey !== LF2_PROOF_REVIEW_ALLOWED_POLICY_KEY) {
    blockers.push("wrong_proof_policy");
  }
  if (input.requiredArtifactTypes.length > 0) blockers.push("policy_requires_artifacts");
  if (!input.verification) blockers.push("verification_missing");
  else {
    if (input.verification.verificationStatus !== "PASSED") blockers.push("verification_not_passed");
    if (input.verification.duplicateStatus !== "UNIQUE") blockers.push("duplicate_not_unique");
  }
  if (input.execution.priorExternalDeliveryEvidence) blockers.push("prior_external_delivery");
  if (input.execution.priorGhlLiveDeliveryRun) blockers.push("prior_ghl_live_run");
  if (input.execution.hasSucceededLiveAttempt) blockers.push("live_attempt_succeeded");
  if (input.execution.hasActiveLiveAttempt) blockers.push("live_attempt_active");
  if (input.execution.hasUnknownOutcomeLiveAttempt) blockers.push("live_attempt_unknown_outcome");
  if (input.execution.allocationCommitted) blockers.push("allocation_committed");
  if (input.execution.fulfilledQuantity > 0) blockers.push("fulfilled_quantity_nonzero");
  if (input.leadProof?.proofStatus === "REJECTED") blockers.push("proof_rejected");
  if (!input.extractionOk) blockers.push("proof_extraction_failed");

  if (input.forAction === "approve" && input.leadProof?.proofStatus === "PROOF_ATTACHED") {
    blockers.push("proof_already_attached");
  }
  if (input.forAction === "revoke") {
    if (input.leadProof?.proofStatus !== "PROOF_ATTACHED") blockers.push("proof_not_attached");
  }

  return blockers;
}

export async function buildLf2ProofReviewPreviewForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma,
  options?: { hypotheticalProofStatus?: LeadProofStatus }
): Promise<Lf2ProofReviewPreviewResult> {
  const event = await findSourceLeadEventById(sourceLeadEventId, db);
  if (!event) return { ok: false, error: "source_lead_not_found" };

  const leadUid = event.sourceLeadUid?.trim() || null;
  if (!leadUid) return { ok: false, error: "source_lead_uid_missing" };

  const malformedPayload =
    event.normalizedPayloadJson !== null && readNormalizedLeadIdentity(event.normalizedPayloadJson) === null;
  if (malformedPayload) return { ok: false, error: "malformed_normalized_payload" };

  const leadProof = await getLeadProofWithArtifactsByLeadUid(leadUid, db);
  const verification = await getLeadVerificationResultByLeadUid(leadUid, db);
  const execution = await loadLf2ProofReviewExecutionContext(event, db);

  const canonicalSourceLane = resolveCanonicalSourceLane(event);
  const proofPolicyKey = resolveProofPolicyKey(canonicalSourceLane);
  const proofPolicy = getProofRequirementPolicy(canonicalSourceLane);
  const requiredArtifactTypes = proofPolicy.requiredArtifacts.map((item) => item.artifactType);

  const extractionPayload = buildProofExtractionPayloadFromSourceLeadEvent(event);
  const extracted = extractionPayload ? extractLeadProofPacket(extractionPayload) : null;
  const extractionOk = extracted?.ok === true;

  const hypotheticalProof =
    options?.hypotheticalProofStatus && leadProof
      ? { ...leadProof, proofStatus: options.hypotheticalProofStatus }
      : options?.hypotheticalProofStatus
        ? {
            proofStatus: options.hypotheticalProofStatus,
            proofMissingReasons: [],
            phoneE164: null,
            email: null,
            consentText: null,
          }
        : leadProof;

  const eligibility = evaluateLeadEligibility({
    sourceLeadEvent: event,
    leadProof: hypotheticalProof,
    verification,
  });

  const approveBlockers = collectProofReviewBlockers({
    leadUid,
    clientAccountId: event.clientAccountIdResolved?.trim() || null,
    canonicalSourceLane,
    proofPolicyKey,
    requiredArtifactTypes,
    verification,
    leadProof,
    extractionOk,
    execution,
    malformedPayload: false,
    forAction: "approve",
  });

  const rejectBlockers: string[] = [];
  if (!leadUid) rejectBlockers.push("source_lead_uid_missing");
  if (!event.clientAccountIdResolved?.trim()) rejectBlockers.push("client_account_missing");
  if (canonicalSourceLane !== LF2_PROOF_REVIEW_ALLOWED_CANONICAL_LANE) rejectBlockers.push("wrong_source_lane");
  if (proofPolicyKey !== LF2_PROOF_REVIEW_ALLOWED_POLICY_KEY) rejectBlockers.push("wrong_proof_policy");
  if (requiredArtifactTypes.length > 0) rejectBlockers.push("policy_requires_artifacts");
  if (!extractionOk) rejectBlockers.push("proof_extraction_failed");
  if (execution.priorExternalDeliveryEvidence) rejectBlockers.push("prior_external_delivery");
  if (execution.hasSucceededLiveAttempt) rejectBlockers.push("live_attempt_succeeded");
  if (execution.hasActiveLiveAttempt) rejectBlockers.push("live_attempt_active");
  if (execution.hasUnknownOutcomeLiveAttempt) rejectBlockers.push("live_attempt_unknown_outcome");
  if (execution.allocationCommitted) rejectBlockers.push("allocation_committed");
  if (execution.fulfilledQuantity > 0) rejectBlockers.push("fulfilled_quantity_nonzero");

  const revokeBlockers = collectProofReviewBlockers({
    leadUid,
    clientAccountId: event.clientAccountIdResolved?.trim() || null,
    canonicalSourceLane,
    proofPolicyKey,
    requiredArtifactTypes,
    verification,
    leadProof,
    extractionOk,
    execution,
    malformedPayload: false,
    forAction: "revoke",
  });
  const priorApproval = await findLatestAppliedProofApprovalForSourceLead(event.id, db);
  if (!priorApproval) revokeBlockers.push("prior_approval_missing");

  const warnings: string[] = [];
  if (execution.simulationAttemptCount > 0) {
    warnings.push("simulation_attempt_present");
  }
  if (execution.allocation?.status === "reserved") {
    warnings.push("reserved_allocation_present");
  }

  return {
    ok: true,
    preview: {
      sourceLeadEventId: event.id,
      maskedSourceLeadUid: maskSourceLeadUidForAudit(leadUid),
      clientAccountId: event.clientAccountIdResolved?.trim() || null,
      canonicalSourceLane,
      proofPolicyKey,
      requiredArtifactTypes,
      leadProofId: leadProof?.id ?? null,
      currentProofStatus: leadProof?.proofStatus ?? null,
      extractedProofStatus: extractionOk ? extracted.proofPacket.proofStatus : null,
      extractedMissingFieldNames: extractionOk ? extracted.missingProofFields : [],
      extractedProofSignalPresence: extractionOk
        ? buildProofSignalPresence(extracted.proofPacket)
        : {
            sourceLeadId: false,
            sourcePlatform: false,
            sourceType: false,
            consentText: false,
            consentVersion: false,
            submittedAt: false,
            formReference: false,
            phoneE164: false,
            email: false,
          },
      verificationStatus: verification?.verificationStatus ?? null,
      duplicateStatus: verification?.duplicateStatus ?? null,
      simulationAttemptCount: execution.simulationAttemptCount,
      liveAttemptCount: execution.liveAttemptCount,
      allocationStatus: execution.allocation?.status ?? null,
      committed: execution.allocationCommitted,
      fulfilled: execution.fulfilledQuantity > 0,
      priorExternalDeliveryEvidence: execution.priorExternalDeliveryEvidence,
      canApprove: approveBlockers.length === 0,
      canReject: rejectBlockers.filter((b) => b !== "proof_already_attached").length === 0,
      canRevoke: revokeBlockers.length === 0,
      blockers: approveBlockers,
      warnings,
      postReviewEligibility: {
        status: eligibility.status,
        reasonCodes: eligibility.reasonCodes,
      },
    },
  };
}
