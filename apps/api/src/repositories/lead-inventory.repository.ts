import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../lib/db.js";
import {
  DEFAULT_AGE_BANDS_V1,
  LEAD_INVENTORY_DEFAULT_AGE_BAND_VERSION,
  type LeadInventoryAgeBand,
} from "../services/lead-inventory/lead-inventory.constants.js";

export async function listActiveAgeBandDefinitions(
  version = LEAD_INVENTORY_DEFAULT_AGE_BAND_VERSION,
  db: PrismaClient = defaultPrisma
): Promise<LeadInventoryAgeBand[]> {
  const rows = await db.leadAgeBandDefinition.findMany({
    where: { version, active: true },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    select: {
      key: true,
      label: true,
      minDaysInclusive: true,
      maxDaysExclusive: true,
      sortOrder: true,
    },
  });
  return rows.length > 0 ? rows : DEFAULT_AGE_BANDS_V1;
}

export async function countInventoryItemsByStatus(db: PrismaClient = defaultPrisma) {
  const grouped = await db.leadInventoryItem.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.status] = row._count._all;
  return counts;
}

export async function countInventoryLotsByStatus(db: PrismaClient = defaultPrisma) {
  const grouped = await db.inventoryLot.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.status] = row._count._all;
  return counts;
}

export type LeadInventoryListFilters = {
  state?: string;
  ageBandKey?: string;
  minAgeDays?: number;
  maxAgeDays?: number;
  lotId?: string;
  nicheKey?: string;
  productType?: string;
  inventoryClass?: string;
  sourceLane?: string;
  status?: string;
  available?: boolean;
  proofStatus?: string;
  verificationStatus?: string;
  cursor?: string;
  limit?: number;
};

export async function listLeadInventoryItems(
  filters: LeadInventoryListFilters,
  db: PrismaClient = defaultPrisma
) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const where: Record<string, unknown> = {};
  if (filters.lotId) where.inventoryLotId = filters.lotId;
  if (filters.nicheKey) where.nicheKey = filters.nicheKey;
  if (filters.productType) where.productType = filters.productType;
  if (filters.inventoryClass) where.inventoryClass = filters.inventoryClass;
  if (filters.sourceLane) where.sourceLane = filters.sourceLane;
  if (filters.status) where.status = filters.status;
  if (filters.state) where.normalizedState = filters.state;

  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }

  return db.leadInventoryItem.findMany({
    where,
    orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: {
      inventoryLot: {
        select: {
          id: true,
          lotKey: true,
          displayName: true,
          status: true,
          inventoryClass: true,
          sourceLane: true,
        },
      },
      sourceLeadEvent: {
        select: {
          id: true,
          sourceLeadUid: true,
          sourceProvider: true,
          sourceSystem: true,
          normalizedPayloadJson: true,
          enrichmentMetadataJson: true,
        },
      },
      leadAllocations: {
        select: {
          id: true,
          status: true,
          leadInventoryItemId: true,
          reservedAt: true,
          committedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
}

export async function findLeadInventoryItemById(id: string, db: PrismaClient = defaultPrisma) {
  return db.leadInventoryItem.findUnique({
    where: { id },
    include: {
      inventoryLot: true,
      sourceLeadEvent: {
        select: {
          id: true,
          sourceLeadUid: true,
          sourceProvider: true,
          sourceSystem: true,
          sourceRouteKey: true,
          receivedAt: true,
          normalizedPayloadJson: true,
          enrichmentMetadataJson: true,
        },
      },
      leadAllocations: {
        select: {
          id: true,
          status: true,
          leadInventoryItemId: true,
          leadOrderId: true,
          reservedAt: true,
          committedAt: true,
          releasedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function listInventoryLots(db: PrismaClient = defaultPrisma) {
  return db.inventoryLot.findMany({
    orderBy: [{ status: "asc" }, { displayName: "asc" }],
  });
}

export async function findInventoryLotById(id: string, db: PrismaClient = defaultPrisma) {
  return db.inventoryLot.findUnique({ where: { id } });
}
