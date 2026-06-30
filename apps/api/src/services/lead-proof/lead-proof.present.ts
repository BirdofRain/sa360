import type { LeadProof, LeadVerificationResult } from "@prisma/client";

export type LeadProofPacketDto = {
  leadUid: string;
  proofStatus: string;
  sourceLane: string | null;
  sourcePlatform: string | null;
  sourceType: string | null;
  formName: string | null;
  campaignName: string | null;
  submittedAt: string | null;
  consentVersion: string | null;
  consentCapturedAt: string | null;
  missingProofReasons: string[];
  verificationStatus: string | null;
};

export function presentLeadProofPacket(
  proof: LeadProof | null,
  verification: LeadVerificationResult | null
): LeadProofPacketDto | null {
  if (!proof) return null;
  return {
    leadUid: proof.leadUid,
    proofStatus: proof.proofStatus,
    sourceLane: proof.sourceLane,
    sourcePlatform: proof.sourcePlatform,
    sourceType: proof.sourceType,
    formName: proof.formName,
    campaignName: proof.campaignName,
    submittedAt: proof.submittedAt ? proof.submittedAt.toISOString() : null,
    consentVersion: proof.consentVersion,
    consentCapturedAt: proof.consentCapturedAt ? proof.consentCapturedAt.toISOString() : null,
    missingProofReasons: Array.isArray(proof.proofMissingReasons)
      ? proof.proofMissingReasons
          .filter((reason): reason is string => typeof reason === "string")
      : [],
    verificationStatus: verification?.verificationStatus ?? null,
  };
}
