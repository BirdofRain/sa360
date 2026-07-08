import type {
  LeadProof,
  LeadProofArtifactProvider,
  LeadProofArtifactStatus,
  LeadProofArtifactType,
  LeadVerificationResult,
} from "@prisma/client";

type LeadProofPacketArtifact = {
  provider: LeadProofArtifactProvider;
  artifactType: LeadProofArtifactType;
  status: LeadProofArtifactStatus;
};

type LeadProofPacketRecord = LeadProof & {
  proofArtifacts?: LeadProofPacketArtifact[];
};

export type LeadProofArtifactSummaryDto = {
  totalArtifacts: number;
  providers: string[];
  hasConsentCertificate: boolean;
  hasCryptographicIntegrity: boolean;
};

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
  artifactSummary: LeadProofArtifactSummaryDto | null;
  verificationStatus: string | null;
};

function summarizeProofArtifacts(
  proofArtifacts: LeadProofPacketArtifact[] | undefined
): LeadProofArtifactSummaryDto | null {
  if (!proofArtifacts || proofArtifacts.length === 0) return null;
  const capturedArtifacts = proofArtifacts.filter((artifact) => artifact.status === "CAPTURED");
  if (capturedArtifacts.length === 0) return null;
  const providers = [...new Set(capturedArtifacts.map((artifact) => artifact.provider))];
  return {
    totalArtifacts: capturedArtifacts.length,
    providers,
    hasConsentCertificate: capturedArtifacts.some(
      (artifact) => artifact.artifactType === "CONSENT_CERTIFICATE"
    ),
    hasCryptographicIntegrity: capturedArtifacts.some(
      (artifact) => artifact.artifactType === "CRYPTOGRAPHIC_INTEGRITY"
    ),
  };
}

export function presentLeadProofPacket(
  proof: LeadProofPacketRecord | null,
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
    artifactSummary: summarizeProofArtifacts(proof.proofArtifacts),
    verificationStatus: verification?.verificationStatus ?? null,
  };
}
