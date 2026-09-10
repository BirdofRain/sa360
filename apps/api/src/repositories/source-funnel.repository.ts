import type { Prisma, PrismaClient, SourceFunnel, SourceLeadProvider } from "@prisma/client";

import { prisma } from "../lib/db.js";

export type SourceFunnelRecord = Prisma.SourceFunnelGetPayload<object>;

export function sourceCampaignIdsForFunnel(funnel: {
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
}): string[] {
  const ids: string[] = [];
  const uuid = funnel.providerFunnelId?.trim();
  const parentUrlKey = funnel.parentUrlKey?.trim();
  if (uuid) ids.push(uuid);
  if (parentUrlKey) ids.push(parentUrlKey);
  return [...new Set(ids)];
}

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

export async function findSourceFunnelByParentUrlKey(
  input: { provider: SourceLeadProvider; parentUrlKey: string },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const parentUrlKey = input.parentUrlKey.trim();
  if (!parentUrlKey) return null;
  return db.sourceFunnel.findUnique({
    where: {
      provider_parentUrlKey: {
        provider: input.provider,
        parentUrlKey,
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

export async function createSourceFunnel(
  input: {
    provider: SourceLeadProvider;
    providerFunnelId?: string | null;
    parentUrlKey?: string | null;
    pageSlug?: string | null;
    observedFunnelName?: string | null;
    nicheKey?: string | null;
    associationStatus?: Prisma.SourceFunnelCreateInput["associationStatus"];
    suggestedClientAccountId?: string | null;
    originClientAccountId?: string | null;
    firstSeenAt?: Date | null;
    lastSeenAt?: Date | null;
  },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const providerFunnelId = input.providerFunnelId?.trim() || null;
  const parentUrlKey = input.parentUrlKey?.trim() || null;
  if (!providerFunnelId && !parentUrlKey) {
    throw new Error("source_funnel_identity_required");
  }
  return db.sourceFunnel.create({
    data: {
      provider: input.provider,
      providerFunnelId,
      parentUrlKey,
      pageSlug: input.pageSlug?.trim() || null,
      observedFunnelName: input.observedFunnelName?.trim() || null,
      nicheKey: input.nicheKey?.trim() || null,
      associationStatus: input.associationStatus ?? "unassociated",
      suggestedClientAccountId: input.suggestedClientAccountId?.trim() || null,
      originClientAccountId: input.originClientAccountId?.trim() || null,
      firstSeenAt: input.firstSeenAt ?? null,
      lastSeenAt: input.lastSeenAt ?? null,
    },
  });
}

export async function upsertSourceFunnelObservation(
  input: {
    provider: SourceLeadProvider;
    providerFunnelId?: string | null;
    parentUrlKey?: string | null;
    pageSlug?: string | null;
    observedFunnelName?: string | null;
    nicheKey?: string | null;
    associationStatus?: Prisma.SourceFunnelCreateInput["associationStatus"];
    suggestedClientAccountId?: string | null;
    seenAt: Date;
    existing: SourceFunnel | null;
  },
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const providerFunnelId = input.providerFunnelId?.trim() || null;
  const parentUrlKey = input.parentUrlKey?.trim() || null;
  const pageSlug = input.pageSlug?.trim() || null;
  const observedFunnelName = input.observedFunnelName?.trim() || null;
  const nicheKey = input.nicheKey?.trim() || null;
  const suggestedClientAccountId = input.suggestedClientAccountId?.trim() || null;

  if (input.existing) {
    return db.sourceFunnel.update({
      where: { id: input.existing.id },
      data: {
        lastSeenAt: input.seenAt,
        firstSeenAt: input.existing.firstSeenAt ?? input.seenAt,
        ...(providerFunnelId && !input.existing.providerFunnelId
          ? { providerFunnelId }
          : {}),
        ...(parentUrlKey && !input.existing.parentUrlKey ? { parentUrlKey } : {}),
        ...(pageSlug !== null ? { pageSlug } : {}),
        ...(observedFunnelName !== null ? { observedFunnelName } : {}),
        ...(nicheKey !== null ? { nicheKey } : {}),
      },
    });
  }

  return createSourceFunnel(
    {
      provider: input.provider,
      providerFunnelId,
      parentUrlKey,
      pageSlug,
      observedFunnelName,
      nicheKey,
      associationStatus: input.associationStatus ?? "unassociated",
      suggestedClientAccountId,
      originClientAccountId: null,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
    },
    db
  );
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
  sourceCampaignIds: string[];
}) {
  return {
    sourceLeadEvent: {
      sourceProvider: input.provider,
      sourceCampaignId: { in: input.sourceCampaignIds },
    },
  } as const;
}

function inventoryScopeForFunnel(input: {
  provider: SourceLeadProvider;
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  sourceCampaignIds?: string[];
}) {
  const sourceCampaignIds =
    input.sourceCampaignIds ??
    sourceCampaignIdsForFunnel({
      providerFunnelId: input.providerFunnelId,
      parentUrlKey: input.parentUrlKey,
    });
  return { provider: input.provider, sourceCampaignIds };
}

export async function stampNullOriginOnFunnelInventory(input: {
  provider: SourceLeadProvider;
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  sourceCampaignIds?: string[];
  originClientAccountId: string;
  db: PrismaClient | Prisma.TransactionClient;
}) {
  const scope = inventoryScopeForFunnel(input);
  if (scope.sourceCampaignIds.length === 0) return { count: 0 };
  return input.db.leadInventoryItem.updateMany({
    where: {
      originClientAccountId: null,
      ...funnelSourcedInventoryWhere(scope),
    },
    data: { originClientAccountId: input.originClientAccountId },
  });
}

export async function applySourceFunnelOriginReassignment(input: {
  provider: SourceLeadProvider;
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  sourceCampaignIds?: string[];
  previousOriginClientAccountId: string;
  nextOriginClientAccountId: string;
  db: PrismaClient | Prisma.TransactionClient;
}): Promise<{ newlyStamped: number; reassigned: number; conflictsSkipped: number }> {
  const scope = inventoryScopeForFunnel(input);
  if (scope.sourceCampaignIds.length === 0) {
    return { newlyStamped: 0, reassigned: 0, conflictsSkipped: 0 };
  }
  const sourced = funnelSourcedInventoryWhere(scope);
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
    sourceCampaignIds: scope.sourceCampaignIds,
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
  providerFunnelId?: string | null;
  parentUrlKey?: string | null;
  sourceCampaignIds?: string[];
  previousOriginClientAccountId: string;
  db: PrismaClient | Prisma.TransactionClient;
}) {
  const scope = inventoryScopeForFunnel(input);
  if (scope.sourceCampaignIds.length === 0) return { count: 0 };
  return input.db.leadInventoryItem.updateMany({
    where: {
      originClientAccountId: input.previousOriginClientAccountId,
      ...funnelSourcedInventoryWhere(scope),
    },
    data: { originClientAccountId: null },
  });
}
