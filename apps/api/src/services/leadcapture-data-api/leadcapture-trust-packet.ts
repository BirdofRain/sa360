import { createHash } from "node:crypto";
import type { LeadCaptureTrustCorrelationClassification } from "@prisma/client";

import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { computeLeadCaptureTrustContentHash } from "./leadcapture-trust-content-hash.js";
import { extractCanonicalTrustAnswers } from "../leadcapture-trust/leadcapture-trust-payload.js";
import { LEADCAPTURE_TRUST_PILOT_SOURCE_LANE } from "../leadcapture-trust/leadcapture-trust.constants.js";
import type { LeadCaptureDataApiLeadRecord } from "./leadcapture-data-api.types.js";

export type LeadCaptureTrustCompletenessStatus =
  | "complete"
  | "incomplete"
  | "contradictory"
  | "missing_required";

export type LeadCaptureTrustPacket = {
  identity: {
    provider: "leadcapture_io";
    providerLeadId: string;
    providerSubmissionId: string | null;
    providerCampaignId: string | null;
    /** Data API `_meta.funnel_id` UUID; name retained for migration compatibility. */
    providerFormId: string | null;
    providerFormName: string | null;
  };
  correlation: {
    sourceLeadEventId: string | null;
    sourceLeadUid: string | null;
    clientAccountId: string | null;
    externalEventId: string | null;
  };
  trustEvidence: {
    disclosureText: string | null;
    disclosureVersion: string | null;
    disclosureAccepted: boolean | null;
    consentTimestamp: Date | null;
    submissionTimestamp: Date | null;
    sourceUrl: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    ipPresent: boolean;
    userAgentPresent: boolean;
    certificateId: string | null;
    certificateProvider: string | null;
    providerVerificationStatus: string | null;
    questionAnswerCount: number;
    artifactCount: number;
  };
  integrity: {
    sourceUpdatedAt: Date | null;
    fetchedAt: Date;
    contentHash: string;
    providerVersion: string | null;
    integrityHash: string | null;
  };
  assessment: {
    completenessStatus: LeadCaptureTrustCompletenessStatus;
    missingFields: string[];
    warnings: string[];
    canAttach: boolean;
    blockers: string[];
    correlationClassification: LeadCaptureTrustCorrelationClassification;
  };
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str) return str;
  }
  return null;
}

function readDate(value: unknown): Date | null {
  const raw = firstString(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "confirmed", "verified"].includes(normalized)) return true;
    if (["false", "no", "0", "unconfirmed", "unverified"].includes(normalized)) return false;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function countQuestionAnswers(record: LeadCaptureDataApiLeadRecord): number {
  return Object.keys(extractCanonicalTrustAnswers(record)).length;
}

function resolveCertificate(record: LeadCaptureDataApiLeadRecord): {
  certificateId: string | null;
  certificateProvider: string | null;
} {
  const trustedForm = firstString(
    record.trustedform_cert_url,
    record.xxTrustedFormCertUrl,
    record.trustedform_certificate_url
  );
  if (trustedForm) {
    return { certificateId: trustedForm, certificateProvider: "trustedform" };
  }
  const verfi = firstString(record.verfi_proof_url);
  if (verfi) {
    return { certificateId: verfi, certificateProvider: "verfi" };
  }
  const jornaya = firstString(record.jornaya_leadid_token, record.universal_leadid);
  if (jornaya) {
    return { certificateId: jornaya, certificateProvider: "jornaya" };
  }
  return { certificateId: null, certificateProvider: null };
}

function resolveDisclosureAccepted(record: LeadCaptureDataApiLeadRecord): boolean | null {
  const candidates = [
    record.tcpa_consent,
    record.tcpa_consent_status,
    record.consent_accepted,
    record.disclosure_accepted,
  ];
  for (const candidate of candidates) {
    const parsed = readBoolean(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolveDisclosureText(record: LeadCaptureDataApiLeadRecord): string | null {
  return firstString(
    record.disclosure_text,
    record.tcpa_disclosure_text,
    record.consent_text,
    record.tcpa_consent_text
  );
}

function resolveDisclosureVersion(record: LeadCaptureDataApiLeadRecord): string | null {
  return firstString(
    record.disclosure_version,
    record.consent_version,
    record.tcpa_consent_version,
    record.tcpa_template_version
  );
}

function resolveIntegrityHash(record: LeadCaptureDataApiLeadRecord): string | null {
  const direct = firstString(
    record.leadproof_hash,
    record.leadproof_integrity_hash,
    record.integrity_hash,
    record.lead_proof_hash
  );
  if (direct) return direct;
  // Some Data API records expose `lead_proof` as a string hash or URL.
  const leadProof = record.lead_proof;
  if (typeof leadProof === "string" && leadProof.trim()) return leadProof.trim();
  if (leadProof && typeof leadProof === "object" && !Array.isArray(leadProof)) {
    return firstString(
      (leadProof as Record<string, unknown>).hash,
      (leadProof as Record<string, unknown>).integrity_hash,
      (leadProof as Record<string, unknown>).url
    );
  }
  return null;
}

export function fingerprintProviderLeadId(providerLeadId: string): string {
  return createHash("sha256").update(`lc_provider_lead:${providerLeadId.trim()}`).digest("hex");
}

export function maskProviderLeadId(providerLeadId: string | null | undefined): string | null {
  return maskSourceLeadUidForAudit(providerLeadId);
}

export function buildLeadCaptureTrustPacketFromApiRecord(
  record: LeadCaptureDataApiLeadRecord,
  fetchedAt = new Date()
): LeadCaptureTrustPacket {
  const meta = asRecord(record._meta);
  // NextGen join key: `_meta.lead_id` UUID (same as webhook `lead_id`).
  // Never use `_meta.lead_number` or questionnaire `number` for correlation.
  const providerLeadId =
    firstString(meta?.lead_id, record.lead_id, record.ref_id, record.id) ?? "unknown";
  const providerFormId = firstString(meta?.funnel_id, meta?.form_id, record.form_id, record.funnel_id);
  const providerCampaignId = firstString(record.sa360_route_key, record.campaign_key, record.campaign_id);
  const providerFormName = firstString(record.form_name, record.funnel_name, record.lead_form);
  const providerSubmissionId = firstString(record.submission_id, record.submissionId);
  const disclosureText = resolveDisclosureText(record);
  const disclosureVersion = resolveDisclosureVersion(record);
  const disclosureAccepted = resolveDisclosureAccepted(record);
  const consentTimestamp = readDate(
    firstString(
      record.consent_timestamp,
      record.tcpa_consent_at,
      record.consent_at,
      record.consent_captured_at
    )
  );
  const submissionTimestamp = readDate(
    firstString(record.submitted_at, record.created_at, record.submission_timestamp)
  );
  const sourceUrl = firstString(
    record.source_url,
    record.landing_page_url,
    record.page_url,
    record.parent_url
  );
  const ipAddress = firstString(record.ip_address, record.ip);
  const userAgent = firstString(record.user_agent, record.userAgent);
  const certificate = resolveCertificate(record);
  const providerVerificationStatus = firstString(
    record.verification_status,
    record.anura_result,
    record.phone_verified === true ? "phone_verified" : null
  );
  const integrityHash = resolveIntegrityHash(record);
  const providerVersion = firstString(meta?.version, record.provider_version);
  const sourceUpdatedAt = readDate(firstString(meta?.updated_at, record.updated_at));
  const trustAnswers = extractCanonicalTrustAnswers(record);

  const missingFields: string[] = [];
  const warnings: string[] = [];
  if (!disclosureText) missingFields.push("disclosureText");
  if (!disclosureVersion) missingFields.push("disclosureVersion");
  if (!consentTimestamp) missingFields.push("consentTimestamp");
  if (disclosureAccepted === false) warnings.push("consent_not_accepted");
  if (disclosureAccepted === null) warnings.push("consent_acceptance_unknown");
  if (!integrityHash && !certificate.certificateId) {
    missingFields.push("artifact:CRYPTOGRAPHIC_INTEGRITY");
  }

  let completenessStatus: LeadCaptureTrustCompletenessStatus = "complete";
  if (missingFields.length > 0) {
    completenessStatus = disclosureAccepted === false ? "contradictory" : "incomplete";
  }
  if (missingFields.includes("artifact:CRYPTOGRAPHIC_INTEGRITY") && missingFields.length >= 3) {
    completenessStatus = "missing_required";
  }

  const contentHash = computeLeadCaptureTrustContentHash({
    identity: {
      providerLeadId,
      providerSubmissionId,
      providerCampaignId,
      providerFormId,
    },
    consent: {
      disclosureText,
      disclosureVersion,
      disclosureAccepted,
      consentTimestamp: consentTimestamp?.toISOString() ?? null,
      submissionTimestamp: submissionTimestamp?.toISOString() ?? null,
    },
    sourceEvidence: {
      sourceUrl,
      ipAddress,
      userAgent,
    },
    complianceEvidence: {
      certificateId: certificate.certificateId,
      certificateProvider: certificate.certificateProvider,
      integrityHash,
      providerVerificationStatus,
      providerVersion,
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
    },
    trustAnswers,
  });

  const artifactCount = (integrityHash ? 1 : 0) + (certificate.certificateId ? 1 : 0);

  return {
    identity: {
      provider: "leadcapture_io",
      providerLeadId,
      providerSubmissionId,
      providerCampaignId,
      providerFormId,
      providerFormName,
    },
    correlation: {
      sourceLeadEventId: null,
      sourceLeadUid: null,
      clientAccountId: null,
      externalEventId: firstString(record.event_uuid, record.external_event_id),
    },
    trustEvidence: {
      disclosureText,
      disclosureVersion,
      disclosureAccepted,
      consentTimestamp,
      submissionTimestamp,
      sourceUrl,
      ipAddress,
      userAgent,
      ipPresent: Boolean(ipAddress),
      userAgentPresent: Boolean(userAgent),
      certificateId: certificate.certificateId,
      certificateProvider: certificate.certificateProvider,
      providerVerificationStatus,
      questionAnswerCount: countQuestionAnswers(record),
      artifactCount,
    },
    integrity: {
      sourceUpdatedAt,
      fetchedAt,
      contentHash,
      providerVersion,
      integrityHash,
    },
    assessment: {
      completenessStatus,
      missingFields,
      warnings,
      canAttach: false,
      blockers: [],
      correlationClassification: "no_match",
    },
  };
}

export type LeadCaptureTrustPreviewSummary = {
  maskedProviderLeadId: string | null;
  providerCampaignId: string | null;
  providerFormId: string | null;
  providerFormName: string | null;
  sourceLeadEventId: string | null;
  clientAccountId: string | null;
  sourceLane: string | null;
  correlationClassification: LeadCaptureTrustCorrelationClassification;
  proofRecordPresent: boolean;
  sourceSnapshotPresent: boolean;
  artifactCount: number;
  disclosurePresent: boolean;
  disclosureVersionPresent: boolean;
  consentAccepted: "yes" | "no" | "unknown";
  consentTimestampPresent: boolean;
  submissionTimestampPresent: boolean;
  sourceUrlPresent: boolean;
  ipPresent: boolean;
  userAgentPresent: boolean;
  certificatePresent: boolean;
  providerVerificationStatus: string | null;
  contentHashPrefix: string;
  completenessStatus: LeadCaptureTrustCompletenessStatus;
  missingFields: string[];
  warnings: string[];
  canAttach: boolean;
  blockers: string[];
};

export function presentLeadCaptureTrustPreviewSummary(input: {
  packet: LeadCaptureTrustPacket;
  proofRecordPresent: boolean;
  sourceSnapshotPresent: boolean;
  artifactCount: number;
}): LeadCaptureTrustPreviewSummary {
  const consentAccepted =
    input.packet.trustEvidence.disclosureAccepted === true
      ? "yes"
      : input.packet.trustEvidence.disclosureAccepted === false
        ? "no"
        : "unknown";

  return {
    maskedProviderLeadId: maskProviderLeadId(input.packet.identity.providerLeadId),
    providerCampaignId: input.packet.identity.providerCampaignId,
    providerFormId: input.packet.identity.providerFormId,
    providerFormName: input.packet.identity.providerFormName,
    sourceLeadEventId: input.packet.correlation.sourceLeadEventId,
    clientAccountId: input.packet.correlation.clientAccountId,
    sourceLane: LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
    correlationClassification: input.packet.assessment.correlationClassification,
    proofRecordPresent: input.proofRecordPresent,
    sourceSnapshotPresent: input.sourceSnapshotPresent,
    artifactCount: input.artifactCount,
    disclosurePresent: Boolean(input.packet.trustEvidence.disclosureText),
    disclosureVersionPresent: Boolean(input.packet.trustEvidence.disclosureVersion),
    consentAccepted,
    consentTimestampPresent: Boolean(input.packet.trustEvidence.consentTimestamp),
    submissionTimestampPresent: Boolean(input.packet.trustEvidence.submissionTimestamp),
    sourceUrlPresent: Boolean(input.packet.trustEvidence.sourceUrl),
    ipPresent: input.packet.trustEvidence.ipPresent,
    userAgentPresent: input.packet.trustEvidence.userAgentPresent,
    certificatePresent: Boolean(input.packet.trustEvidence.certificateId),
    providerVerificationStatus: input.packet.trustEvidence.providerVerificationStatus,
    contentHashPrefix: input.packet.integrity.contentHash.slice(0, 12),
    completenessStatus: input.packet.assessment.completenessStatus,
    missingFields: input.packet.assessment.missingFields,
    warnings: input.packet.assessment.warnings,
    canAttach: input.packet.assessment.canAttach,
    blockers: input.packet.assessment.blockers,
  };
}

export { computeLeadCaptureTrustContentHash } from "./leadcapture-trust-content-hash.js";
