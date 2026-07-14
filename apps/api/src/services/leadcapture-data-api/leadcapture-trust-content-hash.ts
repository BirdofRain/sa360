import { createHash } from "node:crypto";

export type LeadCaptureTrustContentHashBasis = {
  identity: {
    providerLeadId: string;
    providerSubmissionId: string | null;
    providerCampaignId: string | null;
    providerFormId: string | null;
  };
  consent: {
    disclosureText: string | null;
    disclosureVersion: string | null;
    disclosureAccepted: boolean | null;
    consentTimestamp: string | null;
    submissionTimestamp: string | null;
  };
  sourceEvidence: {
    sourceUrl: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  };
  complianceEvidence: {
    certificateId: string | null;
    certificateProvider: string | null;
    integrityHash: string | null;
    providerVerificationStatus: string | null;
    providerVersion: string | null;
    sourceUpdatedAt: string | null;
  };
  trustAnswers: Record<string, string>;
};

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function computeLeadCaptureTrustContentHash(basis: LeadCaptureTrustContentHashBasis): string {
  const canonical = {
    identity: {
      providerLeadId: basis.identity.providerLeadId.trim(),
      providerSubmissionId: basis.identity.providerSubmissionId,
      providerCampaignId: basis.identity.providerCampaignId,
      providerFormId: basis.identity.providerFormId,
    },
    consent: {
      disclosureText: basis.consent.disclosureText,
      disclosureVersion: basis.consent.disclosureVersion,
      disclosureAccepted: basis.consent.disclosureAccepted,
      consentTimestamp: basis.consent.consentTimestamp,
      submissionTimestamp: basis.consent.submissionTimestamp,
    },
    sourceEvidence: {
      sourceUrl: basis.sourceEvidence.sourceUrl,
      ipAddress: basis.sourceEvidence.ipAddress,
      userAgent: basis.sourceEvidence.userAgent,
    },
    complianceEvidence: {
      certificateId: basis.complianceEvidence.certificateId,
      certificateProvider: basis.complianceEvidence.certificateProvider,
      integrityHash: basis.complianceEvidence.integrityHash,
      providerVerificationStatus: basis.complianceEvidence.providerVerificationStatus,
      providerVersion: basis.complianceEvidence.providerVersion,
      sourceUpdatedAt: basis.complianceEvidence.sourceUpdatedAt,
    },
    trustAnswers: Object.fromEntries(
      Object.entries(basis.trustAnswers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value])
    ),
  };

  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}
