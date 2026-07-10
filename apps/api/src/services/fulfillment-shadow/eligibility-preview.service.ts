import type { PrismaClient } from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { getLeadProofByLeadUid, getLeadVerificationResultByLeadUid } from "../../repositories/lead-proof.repository.js";
import { prisma } from "../../lib/db.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import { getProofRequirementPolicy } from "../lead-proof/proof-requirement-policy.registry.js";
import { maskPhoneForAdmin } from "../lead-delivery/lead-delivery-redact.js";
import { evaluateLeadEligibility } from "./eligibility.service.js";

export type EligibilityPreviewResult =
  | { ok: true; preview: EligibilityPreviewPayload }
  | { ok: false; error: "source_lead_not_found" | "malformed_normalized_payload" };

export type EligibilityPreviewPayload = {
  sourceLeadEventId: string;
  sourceLeadUid: string | null;
  resolvedSourceLane: string;
  resolvedProofPolicy: string;
  proofStatus: string | null;
  phonePresent: boolean;
  emailPresent: boolean;
  statePresent: boolean;
  state: string | null;
  maskedPhone: string | null;
  maskedEmail: string | null;
  consentPresent: boolean;
  duplicateStatus: string | null;
  verificationStatus: string | null;
  verificationPresent: boolean;
  predictedEligibilityStatus: "eligible" | "review_required" | "ineligible";
  predictedReasonCodes: string[];
  policyKey: string;
  policyVersion: string;
  summaries: {
    proofBlocksEligibility: boolean;
    proofRequiresReview: boolean;
    duplicateBlocked: boolean;
    duplicateRequiresReview: boolean;
    duplicateUnchecked: boolean;
    consentReviewRequired: boolean;
    requiredFieldsComplete: boolean;
  };
};

function maskEmailSafe(value: string | null): string | null {
  if (!value?.trim()) return null;
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function buildEligibilityPreviewForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient = prisma
): Promise<EligibilityPreviewResult> {
  const event = await findSourceLeadEventById(sourceLeadEventId, db);
  if (!event) {
    return { ok: false, error: "source_lead_not_found" };
  }

  if (event.normalizedPayloadJson !== null && readNormalizedLeadIdentity(event.normalizedPayloadJson) === null) {
    return { ok: false, error: "malformed_normalized_payload" };
  }

  const leadUid = event.sourceLeadUid?.trim() || null;
  const leadProof = leadUid ? await getLeadProofByLeadUid(leadUid, db) : null;
  const verification = leadUid ? await getLeadVerificationResultByLeadUid(leadUid, db) : null;
  const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
  const resolvedSourceLane = resolveCanonicalSourceLane(event);
  const proofPolicy = getProofRequirementPolicy(resolvedSourceLane);

  const evaluation = evaluateLeadEligibility({
    sourceLeadEvent: event,
    leadProof,
    verification,
    leadState: identity?.state ?? null,
  });

  const phone = leadProof?.phoneE164?.trim() || identity?.phoneE164 || null;
  const email = leadProof?.email?.trim() || identity?.email || null;
  const state = identity?.state ?? null;
  const reasonCodes = evaluation.reasonCodes;

  return {
    ok: true,
    preview: {
      sourceLeadEventId: event.id,
      sourceLeadUid: leadUid,
      resolvedSourceLane,
      resolvedProofPolicy: proofPolicy.sourceLane,
      proofStatus: leadProof?.proofStatus ?? null,
      phonePresent: Boolean(phone),
      emailPresent: Boolean(email),
      statePresent: Boolean(state),
      state,
      maskedPhone: maskPhoneForAdmin(phone),
      maskedEmail: maskEmailSafe(email),
      consentPresent: Boolean(leadProof?.consentText?.trim()),
      duplicateStatus: verification?.duplicateStatus ?? null,
      verificationStatus: verification?.verificationStatus ?? null,
      verificationPresent: Boolean(verification),
      predictedEligibilityStatus: evaluation.status,
      predictedReasonCodes: reasonCodes,
      policyKey: evaluation.policyKey,
      policyVersion: evaluation.policyVersion,
      summaries: {
        proofBlocksEligibility: reasonCodes.includes("proof_incomplete"),
        proofRequiresReview: reasonCodes.includes("proof_review_required"),
        duplicateBlocked: reasonCodes.includes("duplicate_blocked"),
        duplicateRequiresReview: reasonCodes.includes("duplicate_review_required"),
        duplicateUnchecked: reasonCodes.includes("duplicate_unchecked"),
        consentReviewRequired: reasonCodes.includes("consent_review_required"),
        requiredFieldsComplete:
          !reasonCodes.includes("missing_phone") &&
          !reasonCodes.includes("missing_email") &&
          !reasonCodes.includes("missing_state"),
      },
    },
  };
}
