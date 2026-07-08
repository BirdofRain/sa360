import type { LeadProof, LeadProofStatus, LeadVerificationResult, SourceLeadEvent } from "@prisma/client";

import { getProofRequirementPolicy } from "../lead-proof/proof-requirement-policy.registry.js";
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

function readNormalizedField(
  normalized: unknown,
  paths: string[]
): string | null {
  if (!normalized || typeof normalized !== "object") return null;
  const obj = normalized as Record<string, unknown>;
  for (const path of paths) {
    const value = obj[path];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readSourceLane(event: EligibilityEvaluationInput["sourceLeadEvent"]): string {
  const enrichment =
    event.enrichmentMetadataJson && typeof event.enrichmentMetadataJson === "object"
      ? (event.enrichmentMetadataJson as Record<string, unknown>)
      : {};
  const lane =
    typeof enrichment.sourceLane === "string"
      ? enrichment.sourceLane
      : `${event.sourceProvider}_${event.sourceSystem}`;
  return lane.trim().toLowerCase();
}

function proofBlocksEligibility(status: LeadProofStatus | undefined): boolean {
  return status === "REJECTED" || status === "PROOF_MISSING";
}

function proofRequiresReview(status: LeadProofStatus | undefined): boolean {
  return status === "NEEDS_REVIEW" || status === "UNREVIEWED";
}

export function evaluateLeadEligibility(input: EligibilityEvaluationInput): EligibilityEvaluationResult {
  const reasonCodes: string[] = [];
  const sourceLane = readSourceLane(input.sourceLeadEvent);
  const proofPolicy = getProofRequirementPolicy(sourceLane);

  const phone =
    input.leadProof?.phoneE164?.trim() ||
    readNormalizedField(input.sourceLeadEvent.normalizedPayloadJson, ["phone_e164", "phoneE164", "phone"]);
  const email =
    input.leadProof?.email?.trim() ||
    readNormalizedField(input.sourceLeadEvent.normalizedPayloadJson, ["email"]);
  const state =
    input.leadState?.trim() ||
    readNormalizedField(input.sourceLeadEvent.normalizedPayloadJson, ["state", "stateCode"]);

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
  };
  if (duplicateStatus === "DUPLICATE_GLOBAL" || duplicateStatus === "DUPLICATE_BUYER") {
    reasonCodes.push("duplicate_blocked");
  } else if (duplicateStatus === "POSSIBLE_MATCH" || duplicateStatus === "DUPLICATE_RECENT") {
    reasonCodes.push("duplicate_review_required");
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
