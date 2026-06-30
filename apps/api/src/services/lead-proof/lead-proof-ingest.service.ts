import { logger } from "../../lib/logger.js";
import {
  getLeadVerificationResultByLeadUid,
  upsertLeadProof,
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
    await upsertLeadProof(extracted.proofPacket);
    await upsertLeadSourceSnapshot(extracted.sourceSnapshot);

    const existingVerification = await getLeadVerificationResultByLeadUid(
      extracted.proofPacket.leadUid
    );
    if (!existingVerification) {
      await upsertLeadVerificationResult(extracted.verificationSeed);
    }

    return {
      ok: true,
      leadUid: extracted.proofPacket.leadUid,
      proofStatus: extracted.proofPacket.proofStatus,
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
