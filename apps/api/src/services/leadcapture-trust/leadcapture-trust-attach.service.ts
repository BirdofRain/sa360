import { Prisma, type LeadProofStatus } from "@prisma/client";

import { collectLeadCaptureTrustSyncBlockers } from "../../lib/leadcapture-data-api-env.js";
import { prisma } from "../../lib/db.js";
import {
  createLeadCaptureTrustSyncAuditEvent,
  findLeadCaptureTrustSyncAuditByRequestId,
} from "../../repositories/leadcapture-trust-sync-audit.repository.js";
import {
  getLeadProofWithArtifactsByLeadUid,
  getLeadVerificationResultByLeadUid,
  upsertLeadProof,
  upsertLeadProofArtifacts,
  upsertLeadSourceSnapshot,
} from "../../repositories/lead-proof.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { getLeadCaptureDataApiLeadById } from "../leadcapture-data-api/leadcapture-data-api.client.js";
import type { LeadCaptureDataApiTransport } from "../leadcapture-data-api/leadcapture-data-api.types.js";
import {
  buildLeadCaptureTrustPacketFromApiRecord,
  fingerprintProviderLeadId,
  maskProviderLeadId,
} from "../leadcapture-data-api/leadcapture-trust-packet.js";
import { extractProofArtifacts } from "../lead-proof/proof-artifact-extractor.service.js";
import { applyProofRequirementPolicy } from "../lead-proof/proof-requirement-policy.registry.js";
import {
  applyCorrelationToPacket,
  correlateLeadCaptureTrustPacket,
} from "./leadcapture-trust-correlation.service.js";
import { buildLeadCaptureTrustPilotPreview } from "./leadcapture-trust-preview.service.js";
import {
  LEADCAPTURE_TRUST_ATTACH_CONFIRMATION,
  LEADCAPTURE_TRUST_PILOT_FORM_ID,
  LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
} from "./leadcapture-trust.constants.js";

export type LeadCaptureTrustAttachError =
  | "trust_sync_disabled"
  | "invalid_confirmation_text"
  | "missing_operator_note"
  | "missing_request_id"
  | "request_id_action_conflict"
  | "source_lead_not_found"
  | "correlation_blocked"
  | "content_hash_changed"
  | "provider_error"
  | "preview_not_attachable"
  | "verification_mutation_blocked";

export type LeadCaptureTrustAttachSuccess = {
  ok: true;
  reviewStatus: "applied" | "idempotent_replay";
  sourceLeadEventId: string;
  leadProofId: string;
  previousProofStatus: LeadProofStatus | null;
  newProofStatus: LeadProofStatus;
  auditEventId: string;
  contentHash: string;
};

export type LeadCaptureTrustAttachResult =
  | LeadCaptureTrustAttachSuccess
  | { ok: false; error: LeadCaptureTrustAttachError; blockers: string[]; auditEventId?: string };

function readLeadUidFromNormalized(normalizedPayloadJson: unknown): string | null {
  if (!normalizedPayloadJson || typeof normalizedPayloadJson !== "object" || Array.isArray(normalizedPayloadJson)) {
    return null;
  }
  const contact = (normalizedPayloadJson as Record<string, unknown>).contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const leadUid = (contact as Record<string, unknown>).lead_uid;
    if (typeof leadUid === "string" && leadUid.trim()) return leadUid.trim();
  }
  return null;
}

function redactProviderRecordForVault(record: Record<string, unknown>): Prisma.InputJsonObject {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (["email", "phone", "phone_number", "name", "first_name", "last_name", "ip_address", "ip", "user_agent"].includes(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }
    if (key.includes("disclosure") || key.includes("consent_text") || key.includes("tcpa")) {
      redacted[key] = "[RESTRICTED]";
      continue;
    }
    redacted[key] = value;
  }
  return redacted as Prisma.InputJsonObject;
}

function resolveProofStatusFromPacket(input: {
  baselineStatus: LeadProofStatus;
  missingFields: string[];
  warnings: string[];
  extractedArtifactsCount: number;
}): LeadProofStatus {
  if (input.extractedArtifactsCount === 0 && input.missingFields.includes("artifact:CRYPTOGRAPHIC_INTEGRITY")) {
    return "PROOF_MISSING";
  }
  if (input.warnings.includes("consent_not_accepted") || input.missingFields.length > 0) {
    return "NEEDS_REVIEW";
  }
  if (input.baselineStatus === "UNREVIEWED" || input.baselineStatus === "PROOF_ATTACHED") {
    return "PROOF_ATTACHED";
  }
  return input.baselineStatus;
}

export async function attachLeadCaptureTrustPilotRecord(input: {
  providerLeadId: string;
  sourceLeadEventId: string;
  campaignId: string;
  requestId: string;
  operatorNote: string;
  operatorConfirmationText: string;
  expectedContentHash?: string | null;
  requestedBy?: string | null;
  transport?: LeadCaptureDataApiTransport;
}): Promise<LeadCaptureTrustAttachResult> {
  const blockers = collectLeadCaptureTrustSyncBlockers({
    campaignId: input.campaignId,
    formId: LEADCAPTURE_TRUST_PILOT_FORM_ID,
  });
  if (blockers.length > 0) {
    return { ok: false, error: "trust_sync_disabled", blockers };
  }
  if (!input.requestId.trim()) {
    return { ok: false, error: "missing_request_id", blockers: ["request_id_required"] };
  }
  if (!input.operatorNote.trim()) {
    return { ok: false, error: "missing_operator_note", blockers: ["operator_note_required"] };
  }
  if (input.operatorConfirmationText.trim() !== LEADCAPTURE_TRUST_ATTACH_CONFIRMATION) {
    return { ok: false, error: "invalid_confirmation_text", blockers: ["invalid_confirmation_text"] };
  }

  const existingAudit = await findLeadCaptureTrustSyncAuditByRequestId(
    input.sourceLeadEventId.trim(),
    input.requestId
  );
  if (existingAudit) {
    if (existingAudit.action !== "ATTACH") {
      return { ok: false, error: "request_id_action_conflict", blockers: ["request_id_action_conflict"] };
    }
    return {
      ok: true,
      reviewStatus: "idempotent_replay",
      sourceLeadEventId: existingAudit.sourceLeadEventId,
      leadProofId: existingAudit.leadProofId ?? "",
      previousProofStatus: existingAudit.previousProofStatus,
      newProofStatus: existingAudit.newProofStatus ?? "NEEDS_REVIEW",
      auditEventId: existingAudit.id,
      contentHash: existingAudit.newContentHash ?? "",
    };
  }

  const preview = await buildLeadCaptureTrustPilotPreview({
    providerLeadId: input.providerLeadId,
    campaignId: input.campaignId,
    sourceLeadEventId: input.sourceLeadEventId,
    transport: input.transport,
  });
  if (!preview.ok) {
    return { ok: false, error: preview.error === "trust_sync_disabled" ? "trust_sync_disabled" : "provider_error", blockers: preview.blockers };
  }
  if (!preview.preview.canAttach) {
    return { ok: false, error: "preview_not_attachable", blockers: preview.preview.blockers };
  }
  if (preview.preview.correlationClassification !== "exact_match") {
    return { ok: false, error: "correlation_blocked", blockers: ["exact_match_required"] };
  }
  if (input.expectedContentHash?.trim() && input.expectedContentHash.trim() !== preview.contentHash) {
    return { ok: false, error: "content_hash_changed", blockers: ["provider_content_hash_changed"] };
  }

  const providerResult = await getLeadCaptureDataApiLeadById(input.providerLeadId, input.transport);
  if (!providerResult.ok) {
    return { ok: false, error: "provider_error", blockers: [providerResult.message] };
  }
  const packet = applyCorrelationToPacket(
    buildLeadCaptureTrustPacketFromApiRecord(providerResult.data),
    await correlateLeadCaptureTrustPacket({
      campaignId: input.campaignId,
      packet: buildLeadCaptureTrustPacketFromApiRecord(providerResult.data),
      providerRecord: providerResult.data,
      explicitSourceLeadEventId: input.sourceLeadEventId,
    })
  );
  if (packet.integrity.contentHash !== preview.contentHash) {
    return { ok: false, error: "content_hash_changed", blockers: ["provider_content_hash_changed"] };
  }

  const event = await findSourceLeadEventById(input.sourceLeadEventId.trim());
  if (!event) {
    return { ok: false, error: "source_lead_not_found", blockers: ["source_lead_not_found"] };
  }
  const leadUid = readLeadUidFromNormalized(event.normalizedPayloadJson);
  if (!leadUid) {
    return { ok: false, error: "correlation_blocked", blockers: ["source_lead_uid_missing"] };
  }

  const verificationBefore = await getLeadVerificationResultByLeadUid(leadUid);
  const proofBefore = await getLeadProofWithArtifactsByLeadUid(leadUid);
  const previousProofStatus = proofBefore?.proofStatus ?? null;

  const extractedArtifacts = extractProofArtifacts({
    payload: providerResult.data,
    sourceLane: LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
  });
  const policyApplied = applyProofRequirementPolicy({
    sourceLane: LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
    baselineStatus: resolveProofStatusFromPacket({
      baselineStatus: previousProofStatus ?? "UNREVIEWED",
      missingFields: packet.assessment.missingFields,
      warnings: packet.assessment.warnings,
      extractedArtifactsCount: extractedArtifacts.length,
    }),
    baselineMissingReasons: [],
    baselineMissingFields: packet.assessment.missingFields,
    extractedArtifacts,
  });

  const redactedPayload = redactProviderRecordForVault(providerResult.data);
  const artifactInputs = extractedArtifacts.map((artifact) => ({
    leadProofId: "",
    provider: artifact.provider,
    artifactType: artifact.artifactType,
    status: artifact.status,
    externalReference: artifact.externalReference ?? null,
    certificateUrl: artifact.certificateUrl ?? null,
    integrityHash: artifact.integrityHash ?? null,
    signature: artifact.signature ?? null,
    algorithm: artifact.algorithm ?? null,
    keyId: artifact.keyId ?? null,
    capturedAt: artifact.capturedAt ?? null,
    issuedAt: artifact.issuedAt ?? null,
    verifiedAt: artifact.verifiedAt ?? null,
    retainedAt: artifact.retainedAt ?? null,
    expiresAt: artifact.expiresAt ?? null,
    artifactFingerprint: artifact.artifactFingerprint,
    providerMetadata: artifact.providerMetadata ?? null,
    failureReasons: artifact.failureReasons ?? null,
    rawArtifactPayload: artifact.rawArtifactPayload ?? null,
  }));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const leadProof = await upsertLeadProof(
        {
          leadUid,
          sourceLeadId: packet.identity.providerLeadId,
          sourceLane: LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
          sourcePlatform: "leadcapture_io",
          sourceType: "leadcapture_form",
          campaignId: input.campaignId,
          formId: packet.identity.providerFormId ?? LEADCAPTURE_TRUST_PILOT_FORM_ID,
          formName: packet.identity.providerFormName,
          landingPageUrl: packet.trustEvidence.sourceUrl,
          consentText: packet.trustEvidence.disclosureText,
          consentVersion: packet.trustEvidence.disclosureVersion,
          consentCapturedAt: packet.trustEvidence.consentTimestamp,
          submittedAt: packet.trustEvidence.submissionTimestamp,
          ipAddress: packet.trustEvidence.ipPresent ? "[RESTRICTED]" : null,
          userAgent: packet.trustEvidence.userAgentPresent ? "[RESTRICTED]" : null,
          proofStatus: policyApplied.proofStatus,
          proofMissingReasons: policyApplied.proofMissingReasons,
          rawSourcePayload: redactedPayload,
        },
        tx
      );

      await upsertLeadSourceSnapshot(
        {
          leadUid,
          sourceLane: LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
          sourcePlatform: "leadcapture_io",
          sourceType: "leadcapture_form",
          sourceLeadId: packet.identity.providerLeadId,
          sourceAttributes: {
            provider: "leadcapture_io",
            provider_lead_id: packet.identity.providerLeadId,
            provider_form_id: packet.identity.providerFormId,
            provider_campaign_id: packet.identity.providerCampaignId,
            content_hash: packet.integrity.contentHash,
            certificate_provider: packet.trustEvidence.certificateProvider,
            verification_status: packet.trustEvidence.providerVerificationStatus,
          } as Prisma.InputJsonObject,
          routingAttributes: {
            campaign_key: input.campaignId,
            source_route_key: event.sourceRouteKey,
          } as Prisma.InputJsonObject,
          rawPayload: redactedPayload,
          capturedAt: packet.integrity.fetchedAt,
        },
        tx
      );

      if (artifactInputs.length > 0) {
        await upsertLeadProofArtifacts(
          artifactInputs.map((row) => ({ ...row, leadProofId: leadProof.id })),
          tx
        );
      }

      const audit = await createLeadCaptureTrustSyncAuditEvent(
        {
          sourceLeadEventId: event.id,
          leadProofId: leadProof.id,
          providerLeadIdFingerprint: fingerprintProviderLeadId(packet.identity.providerLeadId),
          maskedProviderLeadId: maskProviderLeadId(packet.identity.providerLeadId),
          campaignId: input.campaignId,
          formId: packet.identity.providerFormId ?? LEADCAPTURE_TRUST_PILOT_FORM_ID,
          clientAccountId: event.clientAccountIdResolved ?? "",
          action: "ATTACH",
          priorContentHash: null,
          newContentHash: packet.integrity.contentHash,
          correlationClassification: "exact_match",
          previousProofStatus,
          newProofStatus: policyApplied.proofStatus,
          reviewStatus: "applied",
          completenessStatus: packet.assessment.completenessStatus,
          missingFieldsJson: packet.assessment.missingFields,
          warningsJson: packet.assessment.warnings,
          requestId: input.requestId,
          requestedBy: input.requestedBy ?? null,
          operatorNote: input.operatorNote,
        },
        tx
      );

      return { leadProof, audit };
    });

    const verificationAfter = await getLeadVerificationResultByLeadUid(leadUid);
    if (
      verificationBefore?.verificationStatus !== verificationAfter?.verificationStatus ||
      verificationBefore?.duplicateStatus !== verificationAfter?.duplicateStatus
    ) {
      return { ok: false, error: "verification_mutation_blocked", blockers: ["verification_must_not_change"] };
    }

    return {
      ok: true,
      reviewStatus: "applied",
      sourceLeadEventId: event.id,
      leadProofId: result.leadProof.id,
      previousProofStatus,
      newProofStatus: result.leadProof.proofStatus,
      auditEventId: result.audit.id,
      contentHash: packet.integrity.contentHash,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const replay = await findLeadCaptureTrustSyncAuditByRequestId(
        input.sourceLeadEventId.trim(),
        input.requestId
      );
      if (replay?.action === "ATTACH") {
        return {
          ok: true,
          reviewStatus: "idempotent_replay",
          sourceLeadEventId: replay.sourceLeadEventId,
          leadProofId: replay.leadProofId ?? "",
          previousProofStatus: replay.previousProofStatus,
          newProofStatus: replay.newProofStatus ?? "NEEDS_REVIEW",
          auditEventId: replay.id,
          contentHash: replay.newContentHash ?? "",
        };
      }
      return { ok: false, error: "request_id_action_conflict", blockers: ["request_id_action_conflict"] };
    }
    throw err;
  }
}
