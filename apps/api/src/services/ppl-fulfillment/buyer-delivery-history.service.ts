import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";

export type BuyerDeliveryIdentityLookup = {
  clientAccountId: string;
  phoneFingerprint?: string | null;
  emailFingerprint?: string | null;
};

export type BuyerDeliveredIdentityRow = {
  clientAccountId: string;
  phoneFingerprint?: string | null;
  emailFingerprint?: string | null;
  sourceLeadEventId: string;
  leadAllocationId: string;
  leadInventoryItemId?: string | null;
};

export async function hasBuyerPriorDelivery(
  input: BuyerDeliveryIdentityLookup,
  db: PrismaClient = prisma
): Promise<boolean> {
  const clientAccountId = input.clientAccountId.trim();
  const phoneFingerprint = input.phoneFingerprint?.trim() || null;
  const emailFingerprint = input.emailFingerprint?.trim() || null;

  if (!phoneFingerprint && !emailFingerprint) return false;

  const or: Prisma.BuyerDeliveredIdentityWhereInput[] = [];
  if (phoneFingerprint) {
    or.push({ clientAccountId, phoneFingerprint });
  }
  if (emailFingerprint) {
    or.push({ clientAccountId, emailFingerprint });
  }

  const existing = await db.buyerDeliveredIdentity.findFirst({
    where: { OR: or },
    select: { id: true },
  });
  return existing != null;
}

export async function recordBuyerDeliveredIdentities(
  rows: BuyerDeliveredIdentityRow[],
  db: PrismaClient = prisma
) {
  if (rows.length === 0) return { count: 0 };

  const data = rows.map((row) => ({
    clientAccountId: row.clientAccountId.trim(),
    phoneFingerprint: row.phoneFingerprint?.trim() || null,
    emailFingerprint: row.emailFingerprint?.trim() || null,
    sourceLeadEventId: row.sourceLeadEventId.trim(),
    leadAllocationId: row.leadAllocationId.trim(),
    leadInventoryItemId: row.leadInventoryItemId?.trim() || null,
  }));

  return db.buyerDeliveredIdentity.createMany({
    data,
    skipDuplicates: true,
  });
}
