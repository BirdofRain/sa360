import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
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

export type LeadInventoryDemandOverlayOpts = {
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("inventory_demand_aborted");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * Demand overlay from active order lines only.
 * Does not materialize inventory rows — supply for coverage is provided by the caller
 * (facets aggregates) or left at zero when used standalone.
 */
export async function buildLeadInventoryDemandOverlay(
  filters: LeadInventoryDemandFilters = {},
  db: PrismaClient = defaultPrisma,
  opts?: LeadInventoryDemandOverlayOpts
) {
  const signal = opts?.signal;
  throwIfAborted(signal);

  const evaluatedAt = filters.evaluatedAt ?? new Date();
  const ageBands = await listActiveAgeBandDefinitions(filters.ageBandVersion, db);
  throwIfAborted(signal);

  const orderWhere: Record<string, unknown> = { status: "active" };
  if (filters.nicheKey) orderWhere.nicheKey = filters.nicheKey;
  if (filters.productType) orderWhere.productType = filters.productType;

  // Bounded by active order-line cardinality — never scans LeadInventoryItem.
  const orderLines = await db.leadOrderLine.findMany({
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
  });
  throwIfAborted(signal);

  const demand = buildDemandOverlayFromLines(orderLines as OrderLineDemandRecord[], ageBands);

  const cells = [...demand.exactCellDemand.entries()].map(([key, exactCellDemand]) => {
    const [state, ageBandKey] = key.split("::");
    const coverage = computeCellCoverage({ exactCellDemand, supply: 0 });
    return {
      state,
      ageBandKey,
      exactCellDemand,
      supply: 0,
      available: 0,
      reserved: 0,
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
    queryCount: 2, // age bands + order lines
  };
}
