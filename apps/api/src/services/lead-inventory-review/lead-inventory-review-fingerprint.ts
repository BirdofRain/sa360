import { createHash } from "node:crypto";

import type { LeadInventoryReviewActionTypeKey } from "./lead-inventory-review.constants.js";

export function normalizeReviewItemIds(itemIds: string[]): string[] {
  return [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))].sort();
}

export function buildReviewSelectionFingerprint(input: {
  actionType: LeadInventoryReviewActionTypeKey;
  itemIds: string[];
  reasonCode: string | null | undefined;
}): string {
  const payload = {
    actionType: input.actionType,
    itemIds: normalizeReviewItemIds(input.itemIds),
    reasonCode: input.reasonCode?.trim() || null,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}
