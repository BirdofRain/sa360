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
        | "open_request_exists";
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
        | "shortage";
      reasons?: string[];
      eligibleQuantity?: number;
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
    };
  }

  return {
    ok: true,
    replacementId: request.id,
    orderId: preview.orderId,
    eligibleQuantity: preview.eligibleQuantity,
    selectedItemId: preview.selectedItemId,
    originalAllocationId: request.originalAllocationId,
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
        | "idempotency_replay_failed";
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

  if (request.status === REQUESTED) {
    await db.leadReplacementRequest.update({
      where: { id: request.id },
      data: {
        status: APPROVED,
        decidedAt: new Date(),
        decidedBy: input.decidedBy?.trim() || null,
        decisionNote: input.decisionNote?.trim() || null,
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
      decisionNote: input.decisionNote?.trim() || request.decisionNote,
    },
  });

  return { ok: true, item: present(fulfilled), idempotentReplay: false };
}
