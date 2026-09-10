import type { Prisma, PrismaClient, SourceLeadProvider } from "@prisma/client";

import { prisma } from "../lib/db.js";

export type SourceFunnelRecord = Prisma.SourceFunnelGetPayload<object>;

export async function findSourceFunnelByProviderId(
  input: { provider: SourceLeadProvider; providerFunnelId: string },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const providerFunnelId = input.providerFunnelId.trim();
  if (!providerFunnelId) return null;
  return db.sourceFunnel.findUnique({
    where: {
      provider_providerFunnelId: {
        provider: input.provider,
        providerFunnelId,
      },
    },
  });
}

export async function findSourceFunnelById(
  id: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const trimmed = id.trim();
  if (!trimmed) return null;
  return db.sourceFunnel.findUnique({ where: { id: trimmed } });
}

export async function upsertSourceFunnelObservation(
  input: {
    provider: SourceLeadProvider;
    providerFunnelId: string;
    observedFunnelName?: string | null;
    nicheKey?: string | null;
    associationStatus?: Prisma.SourceFunnelCreateInput["associationStatus"];
    suggestedClientAccountId?: string | null;
    seenAt: Date;
  },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const providerFunnelId = input.providerFunnelId.trim();
  const observedFunnelName = input.observedFunnelName?.trim() || null;
  const nicheKey = input.nicheKey?.trim() || null;
  const suggestedClientAccountId = input.suggestedClientAccountId?.trim() || null;

  return db.sourceFunnel.upsert({
    where: {
      provider_providerFunnelId: {
        provider: input.provider,
        providerFunnelId,
      },
    },
    create: {
      provider: input.provider,
      providerFunnelId,
      observedFunnelName,
      nicheKey,
      associationStatus: input.associationStatus ?? "unassociated",
      suggestedClientAccountId,
      originClientAccountId: null,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
    },
    update: {
      lastSeenAt: input.seenAt,
      ...(observedFunnelName !== null ? { observedFunnelName } : {}),
      ...(nicheKey !== null ? { nicheKey } : {}),
    },
  });
}

export async function updateSourceFunnelAssociation(
  id: string,
  data: {
    associationStatus: Prisma.SourceFunnelUpdateInput["associationStatus"];
    suggestedClientAccountId?: string | null;
    originClientAccountId?: string | null;
    nicheKey?: string | null;
    observedFunnelName?: string | null;
  },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.sourceFunnel.update({
    where: { id: id.trim() },
    data: {
      associationStatus: data.associationStatus,
      suggestedClientAccountId: data.suggestedClientAccountId ?? null,
      originClientAccountId: data.originClientAccountId ?? null,
      ...(data.nicheKey !== undefined ? { nicheKey: data.nicheKey } : {}),
      ...(data.observedFunnelName !== undefined
        ? { observedFunnelName: data.observedFunnelName }
        : {}),
    },
  });
}

export async function findClientAccountsByNormalizedDisplayName(
  clientNameHint: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<Array<{ clientAccountId: string; clientDisplayName: string }>> {
  const normalized = clientNameHint.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return [];
  return db.$queryRaw<Array<{ clientAccountId: string; clientDisplayName: string }>>`
    SELECT "clientAccountId", "clientDisplayName"
    FROM "ClientAccount"
    WHERE lower(regexp_replace(btrim("clientDisplayName"), '\\s+', ' ', 'g')) = ${normalized}
    LIMIT 3
  `;
}

function funnelSourcedInventoryWhere(input: {
  provider: SourceLeadProvider;
  providerFunnelId: string;
}) {
  return {
    sourceLeadEvent: {
      sourceProvider: input.provider,
      sourceCampaignId: input.providerFunnelId,
    },
  } as const;
}

export async function stampNullOriginOnFunnelInventory(input: {
  provider: SourceLeadProvider;
  providerFunnelId: string;
  originClientAccountId: string;
  db: PrismaClient | Prisma.TransactionClient;
}) {
  return input.db.leadInventoryItem.updateMany({
    where: {
      originClientAccountId: null,
      ...funnelSourcedInventoryWhere(input),
    },
    data: { originClientAccountId: input.originClientAccountId },
  });
}

export async function applySourceFunnelOriginReassignment(input: {
  provider: SourceLeadProvider;
  providerFunnelId: string;
  previousOriginClientAccountId: string;
  nextOriginClientAccountId: string;
  db: PrismaClient | Prisma.TransactionClient;
}): Promise<{ newlyStamped: number; reassigned: number; conflictsSkipped: number }> {
  const sourced = funnelSourcedInventoryWhere(input);
  const conflictsSkipped = await input.db.leadInventoryItem.count({
    where: {
      AND: [
        { originClientAccountId: { not: null } },
        { originClientAccountId: { not: input.previousOriginClientAccountId } },
      ],
      ...sourced,
    },
  });
  const newlyStamped = await stampNullOriginOnFunnelInventory({
    provider: input.provider,
    providerFunnelId: input.providerFunnelId,
    originClientAccountId: input.nextOriginClientAccountId,
    db: input.db,
  });
  const reassigned = await input.db.leadInventoryItem.updateMany({
    where: {
      originClientAccountId: input.previousOriginClientAccountId,
      ...sourced,
    },
    data: { originClientAccountId: input.nextOriginClientAccountId },
  });
  return {
    newlyStamped: newlyStamped.count,
    reassigned: reassigned.count,
    conflictsSkipped,
  };
}

export async function clearPreviousOriginOnFunnelInventory(input: {
  provider: SourceLeadProvider;
  providerFunnelId: string;
  previousOriginClientAccountId: string;
  db: PrismaClient | Prisma.TransactionClient;
}) {
  return input.db.leadInventoryItem.updateMany({
    where: {
      originClientAccountId: input.previousOriginClientAccountId,
      ...funnelSourcedInventoryWhere(input),
    },
    data: { originClientAccountId: null },
  });
}
