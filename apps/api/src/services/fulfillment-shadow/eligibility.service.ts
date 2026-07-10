import type {
  LeadDuplicateStatus,
  LeadProof,
  LeadProofStatus,
  LeadVerificationResult,
  SourceLeadEvent,
} from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { getProofRequirementPolicy } from "../lead-proof/proof-requirement-policy.registry.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import {
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
} from "./fulfillment-keys.js";

export type EligibilityEvaluationInput = {
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "id" | "sourceLeadUid" | "sourceProvider" | "sourceSystem" | "normalizedPayloadJson" | "enrichmentMetadataJson"
  >;
  leadProof: Pick<
    LeadProof,
    "proofStatus" | "proofMissingReasons" | "phoneE164" | "email" | "consentText"
  > | null;
  verification: Pick<LeadVerificationResult, "duplicateStatus" | "verificationStatus"> | null;
  leadState?: string | null;
};

export type EligibilityEvaluationResult = {
  policyKey: string;
  policyVersion: string;
  status: "eligible" | "review_required" | "ineligible";
  reasonCodes: string[];
  proofResult: Record<string, unknown>;
  duplicateResult: Record<string, unknown>;
  requiredFieldResult: Record<string, unknown>;
  geographyResult: Record<string, unknown>;
  consentResult: Record<string, unknown>;
};

/** Only explicitly verified-unique leads may pass duplicate gating for LF2 eligibility. */
export const ELIGIBLE_DUPLICATE_STATUSES: readonly LeadDuplicateStatus[] = ["UNIQUE"];

const KNOWN_DUPLICATE_STATUSES = new Set<LeadDuplicateStatus>([
  "UNCHECKED",
  "UNIQUE",
  "DUPLICATE_GLOBAL",
  "DUPLICATE_BUYER",
  "DUPLICATE_RECENT",
  "POSSIBLE_MATCH",
]);

function proofBlocksEligibility(status: LeadProofStatus | undefined): boolean {
  return status === "REJECTED" || status === "PROOF_MISSING";
}

function proofRequiresReview(status: LeadProofStatus | undefined): boolean {
  return status === "NEEDS_REVIEW" || status === "UNREVIEWED";
}

function isAcceptableDuplicateStatus(status: LeadDuplicateStatus | null | undefined): boolean {
  return status === "UNIQUE";
}

function duplicateStatusRequiresUncheckedReview(
  verification: EligibilityEvaluationInput["verification"]
): boolean {
  if (!verification) return true;
  const status = verification.duplicateStatus;
  if (status === null || status === undefined || status === "UNCHECKED") return true;
  if (!KNOWN_DUPLICATE_STATUSES.has(status)) return true;
  return !isAcceptableDuplicateStatus(status);
}

export function evaluateLeadEligibility(input: EligibilityEvaluationInput): EligibilityEvaluationResult {
  const reasonCodes: string[] = [];
  const sourceLane = resolveCanonicalSourceLane(input.sourceLeadEvent);
  const proofPolicy = getProofRequirementPolicy(sourceLane);
  const normalizedIdentity = readNormalizedLeadIdentity(input.sourceLeadEvent.normalizedPayloadJson);

  const phone = input.leadProof?.phoneE164?.trim() || normalizedIdentity?.phoneE164 || null;
  const email = input.leadProof?.email?.trim() || normalizedIdentity?.email || null;
  const state = input.leadState?.trim() || normalizedIdentity?.state || null;

  const requiredFieldResult = {
    phonePresent: Boolean(phone),
    emailPresent: Boolean(email),
    statePresent: Boolean(state),
    missingFields: [
      ...(phone ? [] : ["phone"]),
      ...(email ? [] : ["email"]),
      ...(state ? [] : ["state"]),
    ],
  };

  if (!phone) reasonCodes.push("missing_phone");
  if (!email) reasonCodes.push("missing_email");
  if (!state) reasonCodes.push("missing_state");

  const proofStatus = input.leadProof?.proofStatus;
  const proofResult = {
    sourceLane,
    proofPolicyKey: proofPolicy.sourceLane,
    proofStatus: proofStatus ?? "UNREVIEWED",
    requiredArtifacts: proofPolicy.requiredArtifacts.map((item) => item.artifactType),
    proofMissingReasons: input.leadProof?.proofMissingReasons ?? [],
  };

  if (proofBlocksEligibility(proofStatus)) {
    reasonCodes.push("proof_incomplete");
  } else if (proofRequiresReview(proofStatus)) {
    reasonCodes.push("proof_review_required");
  }

  const duplicateStatus = input.verification?.duplicateStatus ?? "UNCHECKED";
  const duplicateResult = {
    duplicateStatus,
    verificationStatus: input.verification?.verificationStatus ?? "UNCHECKED",
    verificationPresent: Boolean(input.verification),
  };

  if (duplicateStatus === "DUPLICATE_GLOBAL" || duplicateStatus === "DUPLICATE_BUYER") {
    reasonCodes.push("duplicate_blocked");
  } else if (duplicateStatus === "POSSIBLE_MATCH" || duplicateStatus === "DUPLICATE_RECENT") {
    reasonCodes.push("duplicate_review_required");
  } else if (duplicateStatusRequiresUncheckedReview(input.verification)) {
    reasonCodes.push("duplicate_unchecked");
  }

  const consentResult = {
    consentCaptured: Boolean(input.leadProof?.consentText?.trim()),
    consentTextPresent: Boolean(input.leadProof?.consentText?.trim()),
  };
  if (!consentResult.consentCaptured && proofPolicy.requiredArtifacts.length > 0) {
    reasonCodes.push("consent_review_required");
  }

  const geographyResult = {
    state: state ?? null,
    evaluated: Boolean(state),
  };

  let status: EligibilityEvaluationResult["status"] = "eligible";
  if (
    reasonCodes.includes("missing_phone") ||
    reasonCodes.includes("missing_email") ||
    reasonCodes.includes("proof_incomplete") ||
    reasonCodes.includes("duplicate_blocked")
  ) {
    status = "ineligible";
  } else if (
    reasonCodes.includes("proof_review_required") ||
    reasonCodes.includes("duplicate_review_required") ||
    reasonCodes.includes("duplicate_unchecked") ||
    reasonCodes.includes("consent_review_required") ||
    reasonCodes.includes("missing_state")
  ) {
    status = "review_required";
  }

  return {
    policyKey: FULFILLMENT_ELIGIBILITY_POLICY_KEY,
    policyVersion: FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
    status,
    reasonCodes,
    proofResult,
    duplicateResult,
    requiredFieldResult,
    geographyResult,
    consentResult,
  };
}
