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

/** Centralized Prisma upsert for `InboundContactIndex`. */
export async function upsertInboundContactIndex(
  args: Prisma.InboundContactIndexUpsertArgs
): Promise<InboundContactIndex> {
  return prisma.inboundContactIndex.upsert(args);
}
