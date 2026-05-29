import type { InboundContactIndex, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

export type InboundContactLookupScope = {
  clientAccountId?: string;
  /** When set (including ""), restricts to that subaccount key; when omitted, any subaccount for the client. */
  subaccountIdGhl?: string;
};

const compositeWhere = (
  clientAccountId: string,
  subaccountIdGhl: string,
  phoneE164: string
) => ({
  clientAccountId_subaccountIdGhl_phoneE164: {
    clientAccountId,
    subaccountIdGhl,
    phoneE164,
  },
});

/**
 * Local caller index: prefer scoped client/subaccount when provided, else newest row globally for the phone.
 */
export async function findByNormalizedPhone(
  phoneE164: string,
  scope?: InboundContactLookupScope
): Promise<InboundContactIndex | null> {
  const orderBy = [{ lastSeenAt: "desc" as const }, { updatedAt: "desc" as const }];

  if (scope?.clientAccountId) {
    const where: {
      phoneE164: string;
      clientAccountId: string;
      subaccountIdGhl?: string;
    } = {
      phoneE164,
      clientAccountId: scope.clientAccountId,
    };
    if (scope.subaccountIdGhl !== undefined) {
      where.subaccountIdGhl = scope.subaccountIdGhl;
    }
    return prisma.inboundContactIndex.findFirst({
      where,
      orderBy,
    });
  }

  return prisma.inboundContactIndex.findFirst({
    where: { phoneE164 },
    orderBy,
  });
}

/** How we searched when no per-request tenant was resolved. */
export type InboundIndexGlobalPhoneLookupMode = "active_client_configs" | "unrestricted";

/**
 * Phone-only lookup when tenant is unknown: prefer rows under `ClientConfig` (metaSyncEnabled)
 * with matching `clientAccountId`; if none, search all InboundContactIndex (legacy).
 */
export async function findByNormalizedPhoneGlobalFallback(
  phoneE164: string
): Promise<{
  row: InboundContactIndex | null;
  mode: InboundIndexGlobalPhoneLookupMode;
}> {
  const orderBy = [{ lastSeenAt: "desc" as const }, { updatedAt: "desc" as const }];

  const active = await prisma.clientConfig.findMany({
    where: { metaSyncEnabled: true },
    select: { clientAccountId: true },
  });
  const ids = active.map((a) => a.clientAccountId);

  if (ids.length === 0) {
    const row = await prisma.inboundContactIndex.findFirst({
      where: { phoneE164 },
      orderBy,
    });
    return { row, mode: "unrestricted" };
  }

  const row = await prisma.inboundContactIndex.findFirst({
    where: {
      phoneE164,
      clientAccountId: { in: ids },
    },
    orderBy,
  });
  return { row, mode: "active_client_configs" };
}

export async function findByCompositeKey(
  clientAccountId: string,
  subaccountIdGhl: string,
  phoneE164: string,
  select?: Prisma.InboundContactIndexSelect
): Promise<InboundContactIndex | null> {
  return prisma.inboundContactIndex.findUnique({
    where: compositeWhere(clientAccountId, subaccountIdGhl, phoneE164),
    ...(select ? { select } : {}),
  });
}

const recentFirst = [{ lastSeenAt: "desc" as const }, { updatedAt: "desc" as const }];

export async function findByContactIdGhl(
  contactIdGhl: string,
  scope?: InboundContactLookupScope
): Promise<InboundContactIndex | null> {
  const where: Prisma.InboundContactIndexWhereInput = {
    contactIdGhl,
  };
  if (scope?.clientAccountId) {
    where.clientAccountId = scope.clientAccountId;
    if (scope.subaccountIdGhl !== undefined) {
      where.subaccountIdGhl = scope.subaccountIdGhl;
    }
  }
  return prisma.inboundContactIndex.findFirst({
    where,
    orderBy: recentFirst,
  });
}

export async function findByLeadUid(
  leadUid: string,
  scope?: InboundContactLookupScope
): Promise<InboundContactIndex | null> {
  const where: Prisma.InboundContactIndexWhereInput = { leadUid };
  if (scope?.clientAccountId) {
    where.clientAccountId = scope.clientAccountId;
    if (scope.subaccountIdGhl !== undefined) {
      where.subaccountIdGhl = scope.subaccountIdGhl;
    }
  }
  return prisma.inboundContactIndex.findFirst({
    where,
    orderBy: recentFirst,
  });
}

export async function findByNormalizedEmail(
  email: string,
  scope?: InboundContactLookupScope
): Promise<InboundContactIndex | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const where: Prisma.InboundContactIndexWhereInput = {
    email: { equals: normalized, mode: "insensitive" },
  };
  if (scope?.clientAccountId) {
    where.clientAccountId = scope.clientAccountId;
    if (scope.subaccountIdGhl !== undefined) {
      where.subaccountIdGhl = scope.subaccountIdGhl;
    }
  }
  return prisma.inboundContactIndex.findFirst({
    where,
    orderBy: recentFirst,
  });
}

/** Rows with similar display name in destination scope within time window (for possible_duplicate). */
export async function findByDisplayNameProximity(
  displayName: string,
  scope: InboundContactLookupScope & { since: Date }
): Promise<InboundContactIndex[]> {
  const name = displayName.trim();
  if (!name || !scope.clientAccountId) return [];
  const where: Prisma.InboundContactIndexWhereInput = {
    clientAccountId: scope.clientAccountId,
    lastSeenAt: { gte: scope.since },
    OR: [
      { displayName: { contains: name, mode: "insensitive" } },
      { firstName: { contains: name.split(" ")[0] ?? name, mode: "insensitive" } },
    ],
  };
  if (scope.subaccountIdGhl !== undefined) {
    where.subaccountIdGhl = scope.subaccountIdGhl;
  }
  return prisma.inboundContactIndex.findMany({
    where,
    orderBy: recentFirst,
    take: 10,
  });
}

/** Centralized Prisma upsert for `InboundContactIndex`. */
export async function upsertInboundContactIndex(
  args: Prisma.InboundContactIndexUpsertArgs
): Promise<InboundContactIndex> {
  return prisma.inboundContactIndex.upsert(args);
}
