import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { prisma } from "../../lib/db.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import {
  previewPplReplacementCandidate,
  selectAndReservePplReplacementCandidate,
} from "./inventory-selection.service.js";

export const REPLACEMENT_CONFIRM_APPROVE_PHRASE = "APPROVE REPLACEMENT";
export const DUPLICATE_REASON_CODE = "duplicate";

/** Unsupported replacement reasons — fail closed at request time. */
export const UNSUPPORTED_REPLACEMENT_REASON_CODES = [
  "disconnected_phone",
  "no_answer",
  "low_quality",
  "invalid_name",
  "incomplete_name",
  "buyer_dissatisfaction",
  "wrong_demographic",
  "consent_complaint",
  "operator_request",
  "quality",
  "bad_lead",
] as const;

const REQUESTED = "requested";
const APPROVED = "approved";
const DENIED = "denied";
const FULFILLED = "fulfilled";
const CANCELED = "canceled";

export function isPplReplacementEnabled(): boolean {
  return process.env.SA360_PPL_REPLACEMENT_ENABLED === "true";
}

/** Only reasonCode "duplicate" is accepted for PPL replacements. */
export function isDuplicateReasonCode(code: string): boolean {
  return code.trim().toLowerCase() === DUPLICATE_REASON_CODE;
}

export type DuplicateEvidenceMatchType =
  | "same_batch_identity"
  | "prior_same_buyer_delivery";

export type DuplicateEvidence = {
  proven: boolean;
  matchType: DuplicateEvidenceMatchType | null;
  matchedAllocationId: string | null;
  matchedSourceLeadEventId: string | null;
  reasons: string[];
};

/**
 * Independently prove a duplicate claim from SA360 records.
 * Buyer-provided free text is never accepted as proof.
 */
export async function evaluateDuplicateEvidence(
  originalAllocationId: string,
  db: PrismaClient = prisma
): Promise<
  | { ok: true; evidence: DuplicateEvidence }
  | {
      ok: false;
      code: "allocation_not_found" | "identity_missing" | "conflicting_identity_evidence";
      evidence: DuplicateEvidence;
    }
> {
  const allocation = await db.leadAllocation.findUnique({
    where: { id: originalAllocationId.trim() },
    select: {
      id: true,
      clientAccountId: true,
      leadOrderId: true,
      sourceLeadEventId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
  });
  if (!allocation) {
    return {
      ok: false,
      code: "allocation_not_found",
      evidence: {
        proven: false,
        matchType: null,
        matchedAllocationId: null,
        matchedSourceLeadEventId: null,
        reasons: ["allocation_not_found"],
      },
    };
  }

  const fingerprints = originalIdentityFingerprints(
    allocation.sourceLeadEvent.normalizedPayloadJson
  );
  if (!fingerprints.phoneFingerprint && !fingerprints.emailFingerprint) {
    return {
      ok: false,
      code: "identity_missing",
      evidence: {
        proven: false,
        matchType: null,
        matchedAllocationId: null,
        matchedSourceLeadEventId: null,
        reasons: ["identity_missing"],
      },
    };
  }

  // Same delivered/reserved batch: another allocation on this order with matching identity.
  const batchPeers = await db.leadAllocation.findMany({
    where: {
      leadOrderId: allocation.leadOrderId,
      id: { not: allocation.id },
      status: { in: ["reserved", "delivering", "committed"] },
    },
    select: {
      id: true,
      sourceLeadEventId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
  });

  let sameBatch: {
    allocationId: string;
    sourceLeadEventId: string;
  } | null = null;
  for (const peer of batchPeers) {
    const peerFp = originalIdentityFingerprints(peer.sourceLeadEvent.normalizedPayloadJson);
    const phoneHit =
      fingerprints.phoneFingerprint != null &&
      peerFp.phoneFingerprint === fingerprints.phoneFingerprint;
    const emailHit =
      fingerprints.emailFingerprint != null &&
      peerFp.emailFingerprint === fingerprints.emailFingerprint;
    if (phoneHit || emailHit) {
      sameBatch = { allocationId: peer.id, sourceLeadEventId: peer.sourceLeadEventId };
      break;
    }
  }

  // Prior same-buyer delivery history (tenant-scoped). Different-buyer rows never match.
  const priorRows = await db.buyerDeliveredIdentity.findMany({
    where: {
      clientAccountId: allocation.clientAccountId,
      leadAllocationId: { not: allocation.id },
      sourceLeadEventId: { not: allocation.sourceLeadEventId },
      OR: [
        ...(fingerprints.phoneFingerprint
          ? [{ phoneFingerprint: fingerprints.phoneFingerprint }]
          : []),
        ...(fingerprints.emailFingerprint
          ? [{ emailFingerprint: fingerprints.emailFingerprint }]
          : []),
      ],
    },
    select: {
      leadAllocationId: true,
      sourceLeadEventId: true,
      phoneFingerprint: true,
      emailFingerprint: true,
    },
  });

  const phonePrior = fingerprints.phoneFingerprint
    ? priorRows.find((row) => row.phoneFingerprint === fingerprints.phoneFingerprint)
    : undefined;
  const emailPrior = fingerprints.emailFingerprint
    ? priorRows.find((row) => row.emailFingerprint === fingerprints.emailFingerprint)
    : undefined;

  if (
    phonePrior &&
    emailPrior &&
    phonePrior.sourceLeadEventId !== emailPrior.sourceLeadEventId
  ) {
    return {
      ok: false,
      code: "conflicting_identity_evidence",
      evidence: {
        proven: false,
        matchType: null,
        matchedAllocationId: null,
        matchedSourceLeadEventId: null,
        reasons: ["conflicting_identity_evidence"],
      },
    };
  }

  const prior = phonePrior ?? emailPrior ?? null;
  if (sameBatch) {
    return {
      ok: true,
      evidence: {
        proven: true,
        matchType: "same_batch_identity",
        matchedAllocationId: sameBatch.allocationId,
        matchedSourceLeadEventId: sameBatch.sourceLeadEventId,
        reasons: ["same_batch_identity"],
      },
    };
  }
  if (prior) {
    return {
      ok: true,
      evidence: {
        proven: true,
        matchType: "prior_same_buyer_delivery",
        matchedAllocationId: prior.leadAllocationId,
        matchedSourceLeadEventId: prior.sourceLeadEventId,
        reasons: ["prior_same_buyer_delivery"],
      },
    };
  }

  return {
    ok: true,
    evidence: {
      proven: false,
      matchType: null,
      matchedAllocationId: null,
      matchedSourceLeadEventId: null,
      reasons: ["duplicate_not_proven"],
    },
  };
}

export type LeadReplacementRequestView = {
  id: string;
  clientAccountId: string;
  leadOrderId: string;
  originalAllocationId: string;
  originalInventoryItemId: string | null;
  status: string;
  reason: string;
  reasonCode: string;
  replacementAllocationId: string | null;
  replacementInventoryItemId: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  fulfilledAt: Date | null;
  requestId: string;
  createdAt: Date;
};

function present(row: {
  id: string;
  clientAccountId: string;
  leadOrderId: string;
  originalAllocationId: string;
  originalInventoryItemId: string | null;
  status: string;
  reason: string;
  reasonCode: string;
  replacementAllocationId: string | null;
  replacementInventoryItemId: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  fulfilledAt: Date | null;
  requestId: string;
  createdAt: Date;
}): LeadReplacementRequestView {
  return { ...row };
}

function originalIdentityFingerprints(normalizedPayloadJson: unknown): {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
} {
  const identity = readNormalizedLeadIdentity(normalizedPayloadJson);
  return {
    phoneFingerprint: identity?.phoneE164
      ? fingerprintIdentityValue("phone", identity.phoneE164)
      : null,
    emailFingerprint: identity?.email
      ? fingerprintIdentityValue("email", identity.email)
      : null,
  };
}

export async function requestLeadReplacement(
  input: {
    originalAllocationId: string;
    reason: string;
    requestId: string;
    createdBy?: string | null;
    reasonCode?: string;
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; item: LeadReplacementRequestView; idempotentReplay: boolean }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "allocation_not_found"
        | "not_delivered_to_buyer"
        | "invalid_reason_code"
        | "open_request_exists"
        | "replacement_already_fulfilled";
    }
> {
  if (!isPplReplacementEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const reasonCode = input.reasonCode ?? DUPLICATE_REASON_CODE;
  if (!isDuplicateReasonCode(reasonCode)) {
    return { ok: false, code: "invalid_reason_code" };
  }

  const requestId = input.requestId.trim();
  const existingByRequestId = await db.leadReplacementRequest.findUnique({
    where: { requestId },
  });
  if (existingByRequestId) {
    return {
      ok: true,
      item: present(existingByRequestId),
      idempotentReplay: true,
    };
  }

  const allocation = await db.leadAllocation.findUnique({
    where: { id: input.originalAllocationId.trim() },
    select: {
      id: true,
      clientAccountId: true,
      leadOrderId: true,
      leadInventoryItemId: true,
      status: true,
    },
  });
  if (!allocation) {
    return { ok: false, code: "allocation_not_found" };
  }

  const delivered = await db.buyerDeliveredIdentity.findFirst({
    where: { leadAllocationId: allocation.id },
    select: { id: true },
  });
  if (!delivered && allocation.status !== "committed") {
    return { ok: false, code: "not_delivered_to_buyer" };
  }

  const alreadyFulfilled = await db.leadReplacementRequest.findFirst({
    where: {
      originalAllocationId: allocation.id,
      status: FULFILLED,
    },
    select: { id: true },
  });
  if (alreadyFulfilled) {
    return { ok: false, code: "replacement_already_fulfilled" };
  }

  const open = await db.leadReplacementRequest.findFirst({
    where: {
      originalAllocationId: allocation.id,
      status: { in: [REQUESTED, APPROVED] },
    },
    select: { id: true },
  });
  if (open) {
    return { ok: false, code: "open_request_exists" };
  }

  const created = await db.leadReplacementRequest.create({
    data: {
      clientAccountId: allocation.clientAccountId,
      leadOrderId: allocation.leadOrderId,
      originalAllocationId: allocation.id,
      originalInventoryItemId: allocation.leadInventoryItemId,
      status: REQUESTED,
      reason: input.reason.trim().slice(0, 2000) || "duplicate",
      reasonCode: DUPLICATE_REASON_CODE,
      requestId,
      createdBy: input.createdBy?.trim() || null,
    },
  });

  return { ok: true, item: present(created), idempotentReplay: false };
}

export async function listLeadReplacementsForOrder(
  orderId: string,
  db: PrismaClient = prisma
): Promise<LeadReplacementRequestView[]> {
  const rows = await db.leadReplacementRequest.findMany({
    where: { leadOrderId: orderId.trim() },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(present);
}

export async function previewLeadReplacement(
  replacementId: string,
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      replacementId: string;
      orderId: string;
      eligibleQuantity: number;
      selectedItemId: string | null;
      originalAllocationId: string;
      duplicateEvidence: DuplicateEvidence;
    }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "replacement_not_found"
        | "invalid_status"
        | "original_allocation_missing"
        | "selection_disabled"
        | "order_not_found"
        | "order_not_active"
        | "unsupported_order_kind"
        | "shortage"
        | "duplicate_not_proven"
        | "conflicting_identity_evidence"
        | "identity_missing";
      reasons?: string[];
      eligibleQuantity?: number;
      duplicateEvidence?: DuplicateEvidence;
    }
> {
  if (!isPplReplacementEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const request = await db.leadReplacementRequest.findUnique({
    where: { id: replacementId.trim() },
  });
  if (!request) return { ok: false, code: "replacement_not_found" };
  if (request.status !== REQUESTED && request.status !== APPROVED) {
    return { ok: false, code: "invalid_status" };
  }

  const evidenceResult = await evaluateDuplicateEvidence(
    request.originalAllocationId,
    db
  );
  if (!evidenceResult.ok) {
    return {
      ok: false,
      code:
        evidenceResult.code === "allocation_not_found"
          ? "original_allocation_missing"
          : evidenceResult.code,
      reasons: evidenceResult.evidence.reasons,
      duplicateEvidence: evidenceResult.evidence,
    };
  }
  if (!evidenceResult.evidence.proven) {
    return {
      ok: false,
      code: "duplicate_not_proven",
      reasons: evidenceResult.evidence.reasons,
      duplicateEvidence: evidenceResult.evidence,
    };
  }

  const original = await db.leadAllocation.findUnique({
    where: { id: request.originalAllocationId },
    select: {
      id: true,
      leadInventoryItemId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
  });
  if (!original) return { ok: false, code: "original_allocation_missing" };

  const fingerprints = originalIdentityFingerprints(
    original.sourceLeadEvent.normalizedPayloadJson
  );
  const preview = await previewPplReplacementCandidate(
    {
      orderId: request.leadOrderId,
      excludeInventoryItemIds: [
        request.originalInventoryItemId,
        original.leadInventoryItemId,
      ].filter((id): id is string => Boolean(id)),
      excludePhoneFingerprints: fingerprints.phoneFingerprint
        ? [fingerprints.phoneFingerprint]
        : [],
      excludeEmailFingerprints: fingerprints.emailFingerprint
        ? [fingerprints.emailFingerprint]
        : [],
    },
    db
  );

  if (!preview.ok) {
    return {
      ok: false,
      code: preview.code,
      reasons: preview.reasons,
      eligibleQuantity: preview.eligibleQuantity,
      duplicateEvidence: evidenceResult.evidence,
    };
  }

  return {
    ok: true,
    replacementId: request.id,
    orderId: preview.orderId,
    eligibleQuantity: preview.eligibleQuantity,
    selectedItemId: preview.selectedItemId,
    originalAllocationId: request.originalAllocationId,
    duplicateEvidence: evidenceResult.evidence,
  };
}

export async function decideLeadReplacement(
  input: {
    replacementId: string;
    action: "approve" | "deny" | "cancel";
    confirmationPhrase?: string;
    decidedBy?: string | null;
    decisionNote?: string | null;
    requestId?: string;
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; item: LeadReplacementRequestView; idempotentReplay: boolean }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "replacement_not_found"
        | "invalid_status"
        | "confirmation_required"
        | "original_allocation_missing"
        | "selection_disabled"
        | "order_not_found"
        | "order_not_active"
        | "unsupported_order_kind"
        | "shortage"
        | "idempotency_replay_failed"
        | "duplicate_not_proven"
        | "conflicting_identity_evidence"
        | "identity_missing";
      reasons?: string[];
    }
> {
  if (!isPplReplacementEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const request = await db.leadReplacementRequest.findUnique({
    where: { id: input.replacementId.trim() },
  });
  if (!request) return { ok: false, code: "replacement_not_found" };

  if (input.action === "deny") {
    if (request.status !== REQUESTED) {
      if (request.status === DENIED) {
        return { ok: true, item: present(request), idempotentReplay: true };
      }
      return { ok: false, code: "invalid_status" };
    }
    const updated = await db.leadReplacementRequest.update({
      where: { id: request.id },
      data: {
        status: DENIED,
        decidedAt: new Date(),
        decidedBy: input.decidedBy?.trim() || null,
        decisionNote: input.decisionNote?.trim() || null,
      },
    });
    return { ok: true, item: present(updated), idempotentReplay: false };
  }

  if (input.action === "cancel") {
    if (request.status !== REQUESTED) {
      if (request.status === CANCELED) {
        return { ok: true, item: present(request), idempotentReplay: true };
      }
      return { ok: false, code: "invalid_status" };
    }
    const updated = await db.leadReplacementRequest.update({
      where: { id: request.id },
      data: {
        status: CANCELED,
        canceledAt: new Date(),
        decidedBy: input.decidedBy?.trim() || null,
        decisionNote: input.decisionNote?.trim() || null,
      },
    });
    return { ok: true, item: present(updated), idempotentReplay: false };
  }

  // approve
  if (request.status === FULFILLED && request.replacementAllocationId) {
    return { ok: true, item: present(request), idempotentReplay: true };
  }
  if (request.status !== REQUESTED && request.status !== APPROVED) {
    return { ok: false, code: "invalid_status" };
  }

  const phrase = (input.confirmationPhrase ?? "").trim();
  if (phrase !== REPLACEMENT_CONFIRM_APPROVE_PHRASE) {
    return { ok: false, code: "confirmation_required" };
  }

  // Approval requires independently proven duplicate evidence (not buyer text).
  const evidenceResult = await evaluateDuplicateEvidence(
    request.originalAllocationId,
    db
  );
  if (!evidenceResult.ok) {
    return {
      ok: false,
      code:
        evidenceResult.code === "allocation_not_found"
          ? "original_allocation_missing"
          : evidenceResult.code,
      reasons: evidenceResult.evidence.reasons,
    };
  }
  if (!evidenceResult.evidence.proven) {
    return {
      ok: false,
      code: "duplicate_not_proven",
      reasons: evidenceResult.evidence.reasons,
    };
  }

  const evidenceDecisionNote = [
    input.decisionNote?.trim() || "",
    `duplicate_evidence:${evidenceResult.evidence.matchType}`,
    evidenceResult.evidence.matchedAllocationId
      ? `matched_allocation:${evidenceResult.evidence.matchedAllocationId}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 2000);

  if (request.status === REQUESTED) {
    await db.leadReplacementRequest.update({
      where: { id: request.id },
      data: {
        status: APPROVED,
        decidedAt: new Date(),
        decidedBy: input.decidedBy?.trim() || null,
        decisionNote: evidenceDecisionNote || null,
      },
    });
  }

  const original = await db.leadAllocation.findUnique({
    where: { id: request.originalAllocationId },
    select: {
      id: true,
      leadInventoryItemId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
  });
  if (!original) return { ok: false, code: "original_allocation_missing" };

  // Original inventory must never return to available because of replacement.
  if (original.leadInventoryItemId) {
    await db.leadInventoryItem.updateMany({
      where: {
        id: original.leadInventoryItemId,
        status: { in: ["reserved", "committed", "fulfilled"] },
      },
      data: {
        status: "committed",
        committedAt: new Date(),
      },
    });
  }

  const fingerprints = originalIdentityFingerprints(
    original.sourceLeadEvent.normalizedPayloadJson
  );
  const reserve = await selectAndReservePplReplacementCandidate(
    {
      orderId: request.leadOrderId,
      idempotencyKey:
        input.requestId?.trim() ||
        `ppl-replace:${request.id}:${request.originalAllocationId}`,
      excludeInventoryItemIds: [
        request.originalInventoryItemId,
        original.leadInventoryItemId,
      ].filter((id): id is string => Boolean(id)),
      excludePhoneFingerprints: fingerprints.phoneFingerprint
        ? [fingerprints.phoneFingerprint]
        : [],
      excludeEmailFingerprints: fingerprints.emailFingerprint
        ? [fingerprints.emailFingerprint]
        : [],
    },
    db
  );

  if (!reserve.ok) {
    return {
      ok: false,
      code: reserve.code,
      reasons: reserve.reasons,
    };
  }

  const fulfilled = await db.leadReplacementRequest.update({
    where: { id: request.id },
    data: {
      status: FULFILLED,
      replacementAllocationId: reserve.allocationId,
      replacementInventoryItemId: reserve.inventoryItemId,
      fulfilledAt: new Date(),
      decidedAt: request.decidedAt ?? new Date(),
      decidedBy: input.decidedBy?.trim() || request.decidedBy,
      decisionNote:
        evidenceDecisionNote ||
        input.decisionNote?.trim() ||
        request.decisionNote,
    },
  });

  return { ok: true, item: present(fulfilled), idempotentReplay: false };
}
