import type { LeadProof, LeadVerificationResult, SourceLeadEvent } from "@prisma/client";

import { getProofRequirementPolicy } from "../lead-proof/proof-requirement-policy.registry.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";

export type InventoryEvidenceInput = {
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "sourceProvider" | "sourceSystem" | "enrichmentMetadataJson"
  >;
  leadProof: Pick<LeadProof, "proofStatus"> | null;
  verification: Pick<LeadVerificationResult, "verificationStatus" | "duplicateStatus"> | null;
};

export type InventoryEvidenceResult = {
  sourceLane: string;
  proofPolicyKey: string;
  proofStatus: string;
  verificationStatus: string;
  duplicateStatus: string;
  blockers: string[];
  warnings: string[];
};

function proofBlocksAvailability(status: string | undefined): boolean {
  return status === "REJECTED" || status === "PROOF_MISSING";
}

function verificationPassed(status: string | null | undefined): boolean {
  return status === "PASSED";
}

function duplicateAcceptable(status: string | null | undefined): boolean {
  return status === "UNIQUE";
}

export function evaluateInventoryEvidenceReadiness(
  input: InventoryEvidenceInput
): InventoryEvidenceResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const sourceLane = resolveCanonicalSourceLane(input.sourceLeadEvent);
  const proofPolicy = getProofRequirementPolicy(sourceLane);
  const proofStatus = input.leadProof?.proofStatus ?? "UNREVIEWED";

  if (proofBlocksAvailability(proofStatus)) {
    blockers.push("proof_not_ready");
  } else if (proofStatus !== "PROOF_ATTACHED") {
    if (proofPolicy.requiredArtifacts.length > 0) {
      blockers.push("proof_not_ready");
    } else {
      warnings.push("proof_needs_review");
    }
  }

  const verificationStatus = input.verification?.verificationStatus ?? "UNCHECKED";
  const duplicateStatus = input.verification?.duplicateStatus ?? "UNCHECKED";
  if (!verificationPassed(verificationStatus)) blockers.push("verification_not_passed");
  if (!duplicateAcceptable(duplicateStatus)) blockers.push("duplicate_risk");

  return {
    sourceLane,
    proofPolicyKey: proofPolicy.sourceLane,
    proofStatus,
    verificationStatus,
    duplicateStatus,
    blockers,
    warnings,
  };
}
