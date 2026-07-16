import type { LeadInventoryClass, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { calculateInventoryAgeDays } from "./lead-inventory-age.js";
import {
  buildDemandOverlayFromLines,
  computeCellCoverage,
  type OrderLineDemandRecord,
} from "./lead-inventory-demand.logic.js";

export type LeadInventoryDemandFilters = {
  nicheKey?: string;
  productType?: string;
  inventoryClass?: string;
  sourceLane?: string;
  lotId?: string;
  status?: string;
  ageBandVersion?: string;
  evaluatedAt?: Date;
};

export async function buildLeadInventoryDemandOverlay(
  filters: LeadInventoryDemandFilters = {},
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = filters.evaluatedAt ?? new Date();
  const ageBands = await listActiveAgeBandDefinitions(filters.ageBandVersion, db);

  const orderWhere: Record<string, unknown> = { status: "active" };
  if (filters.nicheKey) orderWhere.nicheKey = filters.nicheKey;
  if (filters.productType) orderWhere.productType = filters.productType;

  const [orderLines, supplyItems] = await Promise.all([
    db.leadOrderLine.findMany({
      where: {
        status: { in: ["active", "partially_reserved", "reserved", "partially_fulfilled"] },
        leadOrder: orderWhere,
      },
      select: {
        id: true,
        normalizedStatesJson: true,
        ageBandKeysJson: true,
        minAgeDays: true,
        maxAgeDays: true,
        requestedQuantity: true,
        reservedQuantity: true,
        nicheKey: true,
        productType: true,
        fulfillmentPriority: true,
      },
    }),
    db.leadInventoryItem.findMany({
      where: {
        status: { in: ["available", "reserved", "committed"] },
        ...(filters.nicheKey ? { nicheKey: filters.nicheKey } : {}),
        ...(filters.productType ? { productType: filters.productType } : {}),
        ...(filters.inventoryClass
          ? { inventoryClass: filters.inventoryClass as LeadInventoryClass }
          : {}),
        ...(filters.sourceLane ? { sourceLane: filters.sourceLane } : {}),
        ...(filters.lotId ? { inventoryLotId: filters.lotId } : {}),
      },
      select: {
        normalizedState: true,
        generatedAt: true,
        status: true,
        leadAllocations: {
          select: { status: true, leadInventoryItemId: true },
        },
      },
    }),
  ]);

  const demand = buildDemandOverlayFromLines(orderLines as OrderLineDemandRecord[], ageBands);

  const supplyByCell = new Map<string, { available: number; reserved: number }>();
  for (const item of supplyItems) {
    const ageDays = calculateInventoryAgeDays(item.generatedAt, evaluatedAt);
    const band = ageBands.find(
      (b) =>
        ageDays >= b.minDaysInclusive &&
        (b.maxDaysExclusive == null || ageDays < b.maxDaysExclusive)
    );
    if (!band) continue;

    const key = `${item.normalizedState}::${band.key}`;
    const current = supplyByCell.get(key) ?? { available: 0, reserved: 0 };
    const hasHold = item.leadAllocations.some(
      (allocation) =>
        allocation.leadInventoryItemId != null &&
        ["reserved", "committed", "delivering", "review_required"].includes(allocation.status)
    );
    if (hasHold || item.status === "reserved" || item.status === "committed") {
      current.reserved += 1;
    } else {
      current.available += 1;
    }
    supplyByCell.set(key, current);
  }

  const keys = new Set([...demand.exactCellDemand.keys(), ...supplyByCell.keys()]);
  const cells = [...keys].map((key) => {
    const [state, ageBandKey] = key.split("::");
    const exactCellDemand = demand.exactCellDemand.get(key) ?? 0;
    const supplyCell = supplyByCell.get(key) ?? { available: 0, reserved: 0 };
    const supply = supplyCell.available + supplyCell.reserved;
    const coverage = computeCellCoverage({ exactCellDemand, supply });
    return {
      state,
      ageBandKey,
      exactCellDemand,
      supply,
      available: supplyCell.available,
      reserved: supplyCell.reserved,
      unmet: coverage.unmet,
      oversupply: coverage.oversupply,
      coverageRatio: coverage.coverageRatio,
    };
  });

  return {
    evaluatedAt: evaluatedAt.toISOString(),
    cells,
    flexibleDemandTotal: demand.flexibleDemandTotal,
    flexibleDemandLineCount: demand.flexibleDemandLineCount,
    flexibleDemandLines: demand.flexibleDemandLines,
  };
}
