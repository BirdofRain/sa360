import { logger } from "../../lib/logger.js";
import {
  getLeadVerificationResultByLeadUid,
  upsertLeadProof,
  upsertLeadProofArtifacts,
  upsertLeadSourceSnapshot,
  upsertLeadVerificationResult,
} from "../../repositories/lead-proof.repository.js";
import { extractLeadProofPacket } from "./lead-proof.service.js";

export type LeadProofPersistResult =
  | {
      ok: true;
      leadUid: string;
      proofStatus: string;
      missingProofFields: string[];
    }
  | {
      ok: false;
      errorCode: string;
      errorSummary: string;
    };

/**
 * Non-blocking lifecycle side effect. Errors are logged and returned to caller;
 * caller must not fail core webhook ingestion based on this result.
 */
export async function persistLeadProofFromPayload(
  payload: unknown,
  context?: { requestId?: string; eventUuid?: string; sourceEventId?: string }
): Promise<LeadProofPersistResult> {
  const extracted = extractLeadProofPacket(payload);
  if (!extracted.ok) {
    return extracted;
  }

  try {
    const persistedProof = await upsertLeadProof(extracted.proofPacket);
    await upsertLeadSourceSnapshot(extracted.sourceSnapshot);

    const existingVerification = await getLeadVerificationResultByLeadUid(
      extracted.proofPacket.leadUid
    );
    if (!existingVerification) {
      await upsertLeadVerificationResult(extracted.verificationSeed);
    }

    let persistedProofStatus = extracted.proofPacket.proofStatus;
    if (extracted.extractedArtifacts.length > 0) {
      try {
        await upsertLeadProofArtifacts(
          extracted.extractedArtifacts.map((artifact) => ({
            leadProofId: persistedProof.id,
            provider: artifact.provider,
            artifactType: artifact.artifactType,
            status: artifact.status,
            externalReference: artifact.externalReference,
            certificateUrl: artifact.certificateUrl,
            integrityHash: artifact.integrityHash,
            signature: artifact.signature,
            algorithm: artifact.algorithm,
            keyId: artifact.keyId,
            capturedAt: artifact.capturedAt,
            issuedAt: artifact.issuedAt,
            verifiedAt: artifact.verifiedAt,
            retainedAt: artifact.retainedAt,
            expiresAt: artifact.expiresAt,
            artifactFingerprint: artifact.artifactFingerprint,
            providerMetadata: artifact.providerMetadata,
            failureReasons: artifact.failureReasons,
            rawArtifactPayload: artifact.rawArtifactPayload,
          }))
        );
      } catch (artifactError) {
        const artifactMessage =
          artifactError instanceof Error ? artifactError.message : String(artifactError);
        const artifactFailureReason = "proof artifact persistence failed; manual review required.";
        const nextMissingReasons = [
          ...(extracted.proofPacket.proofMissingReasons ?? []),
          artifactFailureReason,
        ];
        persistedProofStatus =
          extracted.proofPacket.proofStatus === "REJECTED" ? "REJECTED" : "NEEDS_REVIEW";
        await upsertLeadProof({
          leadUid: extracted.proofPacket.leadUid,
          proofStatus: persistedProofStatus,
          proofMissingReasons: nextMissingReasons,
        });
        logger.warn("lead_proof.artifacts.persist.failed", {
          request_id: context?.requestId,
          sourceEventId: context?.sourceEventId,
          leadUid: extracted.proofPacket.leadUid,
          error: artifactMessage,
        });
      }
    }

    return {
      ok: true,
      leadUid: extracted.proofPacket.leadUid,
      proofStatus: persistedProofStatus,
      missingProofFields: extracted.missingProofFields,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("lead_proof.persist.failed", {
      request_id: context?.requestId,
      eventUuid: context?.eventUuid,
      error: message,
    });
    return {
      ok: false,
      errorCode: "PERSIST_FAILED",
      errorSummary: "Failed to persist proof packet side effect.",
    };
  }
}
