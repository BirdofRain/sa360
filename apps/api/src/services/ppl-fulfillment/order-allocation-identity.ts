import type { PrismaClient } from "@prisma/client";

const OPEN_ALLOCATION_STATUSES = [
  "shadow",
  "reserved",
  "delivering",
  "committed",
  "review_required",
] as const;

export type OrderAllocationIdentityExclusions = {
  itemIds: string[];
  phoneFingerprints: string[];
  emailFingerprints: string[];
};

const EMPTY: OrderAllocationIdentityExclusions = {
  itemIds: [],
  phoneFingerprints: [],
  emailFingerprints: [],
};

/**
 * Identities already tied to this order. Selection merges these into the
 * existing fingerprint exclusion lists so a second age-bucket line cannot
 * take another copy of someone already allocated on the order.
 */
export async function loadOrderAllocationIdentityExclusions(
  orderId: string,
  db: PrismaClient
): Promise<OrderAllocationIdentityExclusions> {
  if (!db.leadAllocation?.findMany) return EMPTY;
  const rows = await db.leadAllocation.findMany({
    where: {
      leadOrderId: orderId.trim(),
      releasedAt: null,
      status: { in: [...OPEN_ALLOCATION_STATUSES] },
    },
    select: {
      leadInventoryItemId: true,
      leadInventoryItem: {
        select: { phoneFingerprint: true, emailFingerprint: true },
      },
    },
  });
  const itemIds = new Set<string>();
  const phoneFingerprints = new Set<string>();
  const emailFingerprints = new Set<string>();
  for (const row of rows) {
    if (row.leadInventoryItemId) itemIds.add(row.leadInventoryItemId);
    const phone = row.leadInventoryItem?.phoneFingerprint?.trim();
    const email = row.leadInventoryItem?.emailFingerprint?.trim();
    if (phone) phoneFingerprints.add(phone);
    if (email) emailFingerprints.add(email);
  }
  return {
    itemIds: [...itemIds],
    phoneFingerprints: [...phoneFingerprints],
    emailFingerprints: [...emailFingerprints],
  };
}

export function mergeIdentityExclusions(
  input: {
    excludeInventoryItemIds?: string[];
    excludePhoneFingerprints?: string[];
    excludeEmailFingerprints?: string[];
  },
  extra: OrderAllocationIdentityExclusions
): {
  excludeInventoryItemIds: string[];
  excludePhoneFingerprints: string[];
  excludeEmailFingerprints: string[];
} {
  return {
    excludeInventoryItemIds: [...(input.excludeInventoryItemIds ?? []), ...extra.itemIds],
    excludePhoneFingerprints: [...(input.excludePhoneFingerprints ?? []), ...extra.phoneFingerprints],
    excludeEmailFingerprints: [...(input.excludeEmailFingerprints ?? []), ...extra.emailFingerprints],
  };
}
