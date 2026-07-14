import type { LeadCaptureTrustSyncAuditEvent, LeadProofStatus } from "@prisma/client";

export type LeadCaptureTrustAttachReplaySuccess = {
  ok: true;
  reviewStatus: "idempotent_replay";
  sourceLeadEventId: string;
  leadProofId: string;
  previousProofStatus: LeadProofStatus | null;
  newProofStatus: LeadProofStatus;
  auditEventId: string;
  contentHashPrefix: string;
};

export function validateIdempotentReplay(input: {
  audit: Pick<
    LeadCaptureTrustSyncAuditEvent,
    | "id"
    | "action"
    | "sourceLeadEventId"
    | "providerLeadIdFingerprint"
    | "campaignId"
    | "formId"
    | "leadProofId"
    | "newContentHash"
    | "newProofStatus"
    | "previousProofStatus"
  >;
  sourceLeadEventId: string;
  providerLeadIdFingerprint: string;
  campaignId: string;
  formId: string | null;
  expectedContentHash: string;
}):
  | LeadCaptureTrustAttachReplaySuccess
  | { ok: false; error: "request_id_action_conflict" | "request_id_input_conflict" } {
  if (input.audit.action !== "ATTACH") {
    return { ok: false, error: "request_id_action_conflict" };
  }
  if (
    input.audit.sourceLeadEventId !== input.sourceLeadEventId.trim() ||
    input.audit.providerLeadIdFingerprint !== input.providerLeadIdFingerprint ||
    input.audit.campaignId !== input.campaignId.trim() ||
    (input.audit.formId ?? null) !== input.formId ||
    input.audit.newContentHash !== input.expectedContentHash.trim() ||
    !input.audit.leadProofId ||
    !input.audit.newContentHash ||
    !input.audit.newProofStatus
  ) {
    return { ok: false, error: "request_id_input_conflict" };
  }

  return {
    ok: true,
    reviewStatus: "idempotent_replay",
    sourceLeadEventId: input.audit.sourceLeadEventId,
    leadProofId: input.audit.leadProofId,
    previousProofStatus: input.audit.previousProofStatus,
    newProofStatus: input.audit.newProofStatus,
    auditEventId: input.audit.id,
    contentHashPrefix: input.audit.newContentHash.slice(0, 12),
  };
}
