import type {
  LeadInventoryItemStatus,
  LeadInventoryReviewActionType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { createHash } from "node:crypto";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { isLeadInventoryReviewEnabled } from "../../lib/lead-inventory-review-env.js";
import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import {
  REVIEW_AVAILABILITY_REASON_CODES,
  REVIEW_CONFIRMATION,
  REVIEW_MAX_ITEMS,
  REVIEW_QUARANTINE_REASON_CODES,
  REVIEW_REJECT_REASON_CODES,
  type LeadInventoryReviewActionTypeKey,
} from "./lead-inventory-review.constants.js";
import {
  buildReviewSelectionFingerprint,
  normalizeReviewItemIds,
} from "./lead-inventory-review-fingerprint.js";
import { loadReviewItemsWithEligibility } from "./lead-inventory-review-load.js";
import {
  presentSafeEligibilitySnapshot,
  sanitizeReviewOperatorNote,
} from "./lead-inventory-review-sanitize.js";

export type ReviewActionInput = {
  requestId: string;
  actionType: LeadInventoryReviewActionTypeKey;
  itemIds: string[];
  reasonCode?: string | null;
  operatorNote?: string | null;
  requestedBy?: string | null;
  selectionFingerprint?: string;
  confirmationPhrase?: string;
};

function isReasonAllowed(
  actionType: LeadInventoryReviewActionTypeKey,
  reasonCode: string | null | undefined
): boolean {
  const code = reasonCode?.trim() || "";
  if (actionType === "make_available") {
    return !code || (REVIEW_AVAILABILITY_REASON_CODES as readonly string[]).includes(code);
  }
  if (!code) return false;
  if (actionType === "quarantine") {
    return (REVIEW_QUARANTINE_REASON_CODES as readonly string[]).includes(code);
  }
  return (REVIEW_REJECT_REASON_CODES as readonly string[]).includes(code);
}

function resolveEffectiveReason(
  actionType: LeadInventoryReviewActionTypeKey,
  reasonCode: string | null | undefined
): string | null {
  if (actionType === "make_available") {
    return reasonCode?.trim() || "review_passed";
  }
  return reasonCode?.trim() || null;
}

function presentAction(action: {
  id: string;
  requestId: string;
  actionType: LeadInventoryReviewActionType;
  actionStatus: string;
  reasonCode: string | null;
  selectionFingerprint: string;
  requestedCount: number;
  eligibleCount: number;
  appliedCount: number;
  blockedCount: number;
  resultSummaryJson: Prisma.JsonValue;
  previewedAt: Date | null;
  committedAt: Date | null;
  createdAt: Date;
  requestedBy: string | null;
}) {
  return {
    id: action.id,
    requestId: action.requestId,
    actionType: action.actionType,
    actionStatus: action.actionStatus,
    reasonCode: action.reasonCode,
    selectionFingerprint: action.selectionFingerprint,
    requestedCount: action.requestedCount,
    eligibleCount: action.eligibleCount,
    appliedCount: action.appliedCount,
    blockedCount: action.blockedCount,
    resultSummary: action.resultSummaryJson,
    previewedAt: action.previewedAt?.toISOString() ?? null,
    committedAt: action.committedAt?.toISOString() ?? null,
    createdAt: action.createdAt.toISOString(),
    requestedBy: action.requestedBy,
  };
}

function sameSelection(
  existing: { actionType: string; selectionFingerprint: string; reasonCode: string | null },
  expected: { actionType: string; selectionFingerprint: string; reasonCode: string | null }
): boolean {
  return (
    existing.actionType === expected.actionType &&
    existing.selectionFingerprint === expected.selectionFingerprint &&
    (existing.reasonCode ?? null) === (expected.reasonCode ?? null)
  );
}

export async function previewLeadInventoryReviewAction(
  input: ReviewActionInput,
  db: PrismaClient = defaultPrisma
) {
  const itemIds = normalizeReviewItemIds(input.itemIds);
  if (itemIds.length === 0) {
    return { ok: false as const, error: "item_ids_required", code: "item_ids_required" };
  }
  if (itemIds.length > REVIEW_MAX_ITEMS) {
    return { ok: false as const, error: "item_limit_exceeded", code: "item_limit_exceeded" };
  }
  if (!REVIEW_CONFIRMATION[input.actionType]) {
    return { ok: false as const, error: "invalid_action_type", code: "invalid_action_type" };
  }
  if (!isReasonAllowed(input.actionType, input.reasonCode)) {
    return { ok: false as const, error: "invalid_reason_code", code: "invalid_reason_code" };
  }

  const reasonCode = resolveEffectiveReason(input.actionType, input.reasonCode);
  const selectionFingerprint = buildReviewSelectionFingerprint({
    actionType: input.actionType,
    itemIds,
    reasonCode,
  });
  const { results, evaluatedAt } = await loadReviewItemsWithEligibility(itemIds, db);

  const eligibleItems = [];
  const blockedItems = [];

  for (const row of results) {
    const maskedRef = maskSourceLeadUidForAudit(row.itemId) ?? "inv***";
    if (!row.found || !row.eligibility) {
      blockedItems.push({
        inventoryItemId: row.itemId,
        maskedInventoryReference: maskedRef,
        eligible: false,
        blockerCodes: ["required_fields_missing"],
        currentStatus: null,
      });
      continue;
    }

    const canApply =
      input.actionType === "make_available"
        ? row.eligibility.eligible
        : row.eligibility.currentStatus === "pending_review";

    const entry = {
      inventoryItemId: row.itemId,
      maskedInventoryReference: maskedRef,
      eligible: canApply,
      blockerCodes: canApply
        ? []
        : input.actionType === "make_available"
          ? row.eligibility.blockerCodes
          : row.eligibility.currentStatus === "pending_review"
            ? []
            : (["status_not_pending_review"] as const),
      currentStatus: row.eligibility.currentStatus,
      ageBandKey: row.eligibility.ageBandKey,
      normalizedState: row.eligibility.normalizedState,
      sourceLane: row.eligibility.sourceLane,
      duplicateStatus: row.eligibility.duplicateStatus,
      eligibility: presentSafeEligibilitySnapshot(row.eligibility),
    };

    if (canApply) eligibleItems.push(entry);
    else blockedItems.push(entry);
  }

  return {
    ok: true as const,
    writesPerformed: 0,
    featureEnabled: isLeadInventoryReviewEnabled(),
    requestId: input.requestId,
    actionType: input.actionType,
    reasonCode,
    selectionFingerprint,
    requestedCount: itemIds.length,
    eligibleCount: eligibleItems.length,
    blockedCount: blockedItems.length,
    confirmationPhraseRequired: REVIEW_CONFIRMATION[input.actionType],
    evaluatedAt: evaluatedAt.toISOString(),
    eligibleItems,
    blockedItems,
  };
}

export async function commitLeadInventoryReviewAction(
  input: ReviewActionInput,
  db: PrismaClient = defaultPrisma
) {
  if (!isLeadInventoryReviewEnabled()) {
    return {
      ok: false as const,
      error: "review_activation_disabled",
      code: "review_activation_disabled",
    };
  }

  const itemIds = normalizeReviewItemIds(input.itemIds);
  if (itemIds.length === 0) {
    return { ok: false as const, error: "item_ids_required", code: "item_ids_required" };
  }
  if (itemIds.length > REVIEW_MAX_ITEMS) {
    return { ok: false as const, error: "item_limit_exceeded", code: "item_limit_exceeded" };
  }
  if (!REVIEW_CONFIRMATION[input.actionType]) {
    return { ok: false as const, error: "invalid_action_type", code: "invalid_action_type" };
  }
  if (input.confirmationPhrase !== REVIEW_CONFIRMATION[input.actionType]) {
    return { ok: false as const, error: "invalid_confirmation", code: "invalid_confirmation" };
  }
  if (!isReasonAllowed(input.actionType, input.reasonCode)) {
    return { ok: false as const, error: "invalid_reason_code", code: "invalid_reason_code" };
  }
  if (!input.selectionFingerprint?.trim()) {
    return {
      ok: false as const,
      error: "selection_fingerprint_required",
      code: "selection_fingerprint_required",
    };
  }

  const reasonCode = resolveEffectiveReason(input.actionType, input.reasonCode);
  const expectedFingerprint = buildReviewSelectionFingerprint({
    actionType: input.actionType,
    itemIds,
    reasonCode,
  });
  if (expectedFingerprint !== input.selectionFingerprint.trim()) {
    return {
      ok: false as const,
      error: "selection_fingerprint_mismatch",
      code: "selection_fingerprint_mismatch",
    };
  }

  const operatorNote = sanitizeReviewOperatorNote(input.operatorNote);
  const existing = await db.leadInventoryReviewAction.findUnique({
    where: { requestId: input.requestId },
    include: { itemResults: true },
  });

  if (existing) {
    if (
      sameSelection(existing, {
        actionType: input.actionType,
        selectionFingerprint: expectedFingerprint,
        reasonCode,
      }) &&
      (existing.actionStatus === "applied" ||
        existing.actionStatus === "partially_applied" ||
        existing.actionStatus === "blocked" ||
        existing.actionStatus === "idempotent_replay")
    ) {
      return {
        ok: true as const,
        idempotentReplay: true,
        writesPerformed: 0,
        action: presentAction(existing),
        itemResults: existing.itemResults.map((row) => ({
          leadInventoryItemId: row.leadInventoryItemId,
          maskedInventoryReference: maskSourceLeadUidForAudit(row.leadInventoryItemId) ?? "inv***",
          priorStatus: row.priorStatus,
          resultingStatus: row.resultingStatus,
          reasonCode: row.reasonCode,
          blockerCodes: row.blockerCodesJson,
          appliedAt: row.appliedAt?.toISOString() ?? null,
        })),
      };
    }
    return { ok: false as const, error: "request_id_conflict", code: "request_id_conflict" };
  }

  const preview = await previewLeadInventoryReviewAction(
    {
      requestId: input.requestId,
      actionType: input.actionType,
      itemIds,
      reasonCode,
      operatorNote,
      requestedBy: input.requestedBy,
    },
    db
  );
  if (!preview.ok) return preview;

  const eligibleIds = new Set(preview.eligibleItems.map((item) => item.inventoryItemId));
  const committedAt = new Date();

  try {
    const result = await db.$transaction(async (tx) => {
      const action = await tx.leadInventoryReviewAction.create({
        data: {
          requestId: input.requestId,
          actionType: input.actionType,
          actionStatus: "previewed",
          requestedBy: input.requestedBy ?? null,
          reasonCode,
          operatorNote,
          selectionFingerprint: expectedFingerprint,
          requestedCount: itemIds.length,
          eligibleCount: preview.eligibleCount,
          appliedCount: 0,
          blockedCount: preview.blockedCount,
          resultSummaryJson: {
            confirmationPhrase: REVIEW_CONFIRMATION[input.actionType],
            eligibleItemIdsHash: createHash("sha256")
              .update(preview.eligibleItems.map((i) => i.inventoryItemId).sort().join(","))
              .digest("hex"),
            blockedItemIdsHash: createHash("sha256")
              .update(preview.blockedItems.map((i) => i.inventoryItemId).sort().join(","))
              .digest("hex"),
          },
          previewedAt: committedAt,
        },
      });

      let appliedCount = 0;
      let blockedCount = 0;
      const itemResults = [];

      for (const itemId of itemIds) {
        const loaded = await loadReviewItemsWithEligibility([itemId], tx as unknown as PrismaClient, committedAt);
        const row = loaded.results[0];
        if (!row?.found || !row.item || !row.eligibility) {
          // Item missing: cannot persist per-item FK row; count as blocked only.
          blockedCount += 1;
          continue;
        }

        const priorStatus = row.item.status as LeadInventoryItemStatus;
        const wasPreviewEligible = eligibleIds.has(itemId);

        let canApply = false;
        let blockers: string[] = [...row.eligibility.blockerCodes];

        if (priorStatus !== "pending_review") {
          canApply = false;
          blockers = ["status_not_pending_review"];
        } else if (input.actionType === "make_available") {
          canApply = row.eligibility.eligible && wasPreviewEligible;
          if (!wasPreviewEligible && row.eligibility.eligible) {
            blockers = ["selection_stale"];
            canApply = false;
          }
        } else {
          canApply = wasPreviewEligible && priorStatus === "pending_review";
          blockers = canApply ? [] : blockers.length ? blockers : ["status_not_pending_review"];
        }

        if (!canApply) {
          blockedCount += 1;
          const created = await tx.leadInventoryReviewItemResult.create({
            data: {
              reviewActionId: action.id,
              leadInventoryItemId: itemId,
              priorStatus,
              resultingStatus: null,
              reasonCode,
              blockerCodesJson: blockers,
              eligibilitySnapshotJson: presentSafeEligibilitySnapshot(row.eligibility),
              appliedAt: null,
            },
          });
          itemResults.push(created);
          continue;
        }

        let resultingStatus: LeadInventoryItemStatus = priorStatus;
        const updateData: Prisma.LeadInventoryItemUpdateManyMutationInput = {};

        if (input.actionType === "make_available") {
          resultingStatus = "available";
          updateData.status = "available";
          updateData.availableAt = committedAt;
        } else if (input.actionType === "quarantine") {
          resultingStatus = "quarantined";
          updateData.status = "quarantined";
          updateData.quarantineReason = reasonCode;
        } else {
          resultingStatus = "rejected";
          updateData.status = "rejected";
          updateData.rejectedAt = committedAt;
        }

        const updated = await tx.leadInventoryItem.updateMany({
          where: { id: itemId, status: "pending_review" },
          data: updateData,
        });

        if (updated.count !== 1) {
          blockedCount += 1;
          const created = await tx.leadInventoryReviewItemResult.create({
            data: {
              reviewActionId: action.id,
              leadInventoryItemId: itemId,
              priorStatus,
              resultingStatus: null,
              reasonCode,
              blockerCodesJson: ["status_not_pending_review"],
              eligibilitySnapshotJson: presentSafeEligibilitySnapshot(row.eligibility),
              appliedAt: null,
            },
          });
          itemResults.push(created);
          continue;
        }

        appliedCount += 1;
        const created = await tx.leadInventoryReviewItemResult.create({
          data: {
            reviewActionId: action.id,
            leadInventoryItemId: itemId,
            priorStatus,
            resultingStatus,
            reasonCode,
            blockerCodesJson: [],
            eligibilitySnapshotJson: presentSafeEligibilitySnapshot(row.eligibility),
            appliedAt: committedAt,
          },
        });
        itemResults.push(created);
      }

      const actionStatus =
        appliedCount === 0
          ? "blocked"
          : blockedCount > 0
            ? "partially_applied"
            : "applied";

      const updatedAction = await tx.leadInventoryReviewAction.update({
        where: { id: action.id },
        data: {
          actionStatus,
          appliedCount,
          blockedCount,
          committedAt,
          resultSummaryJson: {
            appliedCount,
            blockedCount,
            requestedCount: itemIds.length,
            actionType: input.actionType,
            reasonCode,
          },
        },
      });

      return { action: updatedAction, itemResults, appliedCount, blockedCount };
    });

    return {
      ok: true as const,
      idempotentReplay: false,
      writesPerformed: result.appliedCount,
      action: presentAction(result.action),
      itemResults: result.itemResults.map((row) => ({
        leadInventoryItemId: row.leadInventoryItemId,
        maskedInventoryReference: maskSourceLeadUidForAudit(row.leadInventoryItemId) ?? "inv***",
        priorStatus: row.priorStatus,
        resultingStatus: row.resultingStatus,
        reasonCode: row.reasonCode,
        blockerCodes: row.blockerCodesJson,
        appliedAt: row.appliedAt?.toISOString() ?? null,
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "commit_failed";
    return { ok: false as const, error: message, code: "commit_failed" };
  }
}

export async function getLeadInventoryReviewActionByRequestId(
  requestId: string,
  db: PrismaClient = defaultPrisma
) {
  const action = await db.leadInventoryReviewAction.findUnique({
    where: { requestId },
    include: {
      itemResults: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!action) return null;

  return {
    action: presentAction(action),
    itemResults: action.itemResults.map((row) => ({
      leadInventoryItemId: row.leadInventoryItemId,
      maskedInventoryReference: maskSourceLeadUidForAudit(row.leadInventoryItemId) ?? "inv***",
      priorStatus: row.priorStatus,
      resultingStatus: row.resultingStatus,
      reasonCode: row.reasonCode,
      blockerCodes: row.blockerCodesJson,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    // operatorNote intentionally omitted from recovery/client-facing payload
  };
}
