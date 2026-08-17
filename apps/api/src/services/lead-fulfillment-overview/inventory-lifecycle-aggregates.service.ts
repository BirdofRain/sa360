import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import {
  FRESH_HOLD_MAX_DAYS_EXCLUSIVE,
  SEMI_FRESH_HOLD_MAX_DAYS_EXCLUSIVE,
} from "../ppl-fulfillment/commerce-lifecycle.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type OverviewMetricAvailability = "ok" | "unavailable" | "not_wired";

export type OverviewCountMetric = {
  key: string;
  label: string;
  value: number | null;
  availability: OverviewMetricAvailability;
  hint?: string;
  queryShape: OverviewQueryShape;
};

export type OverviewQueryShape = {
  queryType: "count" | "bounded_findMany" | "groupBy";
  predicates: string[];
  indexesUsed: string[];
  maxResultCardinality: number;
  jsonCorpusScan: false;
  nodeMaterializesInventoryRows: false;
};

function countShape(predicates: string[], indexes: string[]): OverviewQueryShape {
  return {
    queryType: "count",
    predicates,
    indexesUsed: indexes,
    maxResultCardinality: 1,
    jsonCorpusScan: false,
    nodeMaterializesInventoryRows: false,
  };
}

function generatedAtCutoff(evaluatedAt: Date, ageDaysExclusive: number): Date {
  return new Date(evaluatedAt.getTime() - ageDaysExclusive * MS_PER_DAY);
}

async function safeCount(
  key: string,
  label: string,
  queryShape: OverviewQueryShape,
  run: () => Promise<number>
): Promise<OverviewCountMetric> {
  try {
    const value = await run();
    return { key, label, value, availability: "ok", queryShape };
  } catch (err) {
    return {
      key,
      label,
      value: null,
      availability: "unavailable",
      hint: err instanceof Error ? err.message : "count_failed",
      queryShape,
    };
  }
}

/**
 * SQL-side inventory lifecycle counts. Each metric is an indexed COUNT(*).
 * Never findMany's the inventory corpus. Never classifies rows in Node.
 */
export async function loadInventoryLifecycleAggregates(
  db: PrismaClient = defaultPrisma,
  evaluatedAt = new Date()
): Promise<{
  metrics: OverviewCountMetric[];
  queryEvidence: OverviewQueryShape[];
}> {
  const freshCutoff = generatedAtCutoff(evaluatedAt, FRESH_HOLD_MAX_DAYS_EXCLUSIVE);
  const semiCutoff = generatedAtCutoff(evaluatedAt, SEMI_FRESH_HOLD_MAX_DAYS_EXCLUSIVE);

  const tracked = await safeCount(
    "inventoryTracked",
    "Inventory tracked",
    countShape(["LeadInventoryItem"], ["LeadInventoryItem_pkey"]),
    () => db.leadInventoryItem.count()
  );

  const freshHold = await safeCount(
    "freshHold",
    "Fresh tracked · 0–9 days · HOLD",
    countShape(
      ["generatedAt > now()-10d"],
      ["LeadInventoryItem_generatedAt_idx"]
    ),
    () => db.leadInventoryItem.count({ where: { generatedAt: { gt: freshCutoff } } })
  );

  const semiFreshHold = await safeCount(
    "semiFreshHold",
    "Semi-Fresh tracked · 10–29 days · HOLD",
    countShape(
      ["generatedAt <= now()-10d", "generatedAt > now()-30d"],
      ["LeadInventoryItem_generatedAt_idx"]
    ),
    () =>
      db.leadInventoryItem.count({
        where: { generatedAt: { lte: freshCutoff, gt: semiCutoff } },
      })
  );

  const agedAvailable = await safeCount(
    "agedAvailable",
    "Aged available",
    countShape(
      ["status = available", "generatedAt <= now()-30d"],
      ["LeadInventoryItem_status_idx", "LeadInventoryItem_generatedAt_idx"]
    ),
    () =>
      db.leadInventoryItem.count({
        where: {
          status: "available",
          generatedAt: { lte: semiCutoff },
        },
      })
  );

  const reserved = await safeCount(
    "reserved",
    "Reserved",
    countShape(["status = reserved"], ["LeadInventoryItem_status_idx"]),
    () => db.leadInventoryItem.count({ where: { status: "reserved" } })
  );

  const blockedReview = await safeCount(
    "blockedReview",
    "Blocked / Review",
    countShape(["status = pending_review"], ["LeadInventoryItem_status_idx"]),
    () => db.leadInventoryItem.count({ where: { status: "pending_review" } })
  );

  freshHold.hint =
    "All tracked inventory in the 0–9 day generatedAt band, including pending_review and quarantined. Not sellable.";
  semiFreshHold.hint =
    "All tracked inventory in the 10–29 day generatedAt band, including pending_review and quarantined. Not sellable.";

  const metrics = [tracked, freshHold, semiFreshHold, agedAvailable, reserved, blockedReview];
  return { metrics, queryEvidence: metrics.map((row) => row.queryShape) };
}

export async function loadFulfillmentOverviewCounts(
  db: PrismaClient = defaultPrisma
): Promise<{
  activePricedOrders: OverviewCountMetric;
  deliveredLeads: OverviewCountMetric;
  deliveryFailures: OverviewCountMetric;
}> {
  const activePricedOrders = await safeCount(
    "activeOrders",
    "Active priced orders",
    countShape(
      ["LeadOrder.status = active", "exists LeadOrderLine.unitPriceCents IS NOT NULL"],
      ["LeadOrder_status_createdAt_idx", "LeadOrderLine_leadOrderId_status_idx"]
    ),
    () =>
      db.leadOrder.count({
        where: {
          status: "active",
          orderLines: { some: { unitPriceCents: { not: null } } },
        },
      })
  );

  const deliveredLeads = await safeCount(
    "deliveredLeads",
    "Buyer deliveries",
    countShape(
      ["BuyerDeliveredIdentity"],
      ["BuyerDeliveredIdentity_pkey"]
    ),
    () => db.buyerDeliveredIdentity.count()
  );
  deliveredLeads.hint =
    "COUNT(*) of BuyerDeliveredIdentity rows. One consumer can appear more than once across buyers/resale. CSV download is not a delivery.";

  const deliveryFailures: OverviewCountMetric = {
    key: "deliveryFailures",
    label: "Delivery failures",
    value: null,
    availability: "not_wired",
    hint: "Delivery failure ledger is not wired. CSV download is not a failure or a delivery.",
    queryShape: countShape(["not_wired"], []),
  };

  return { activePricedOrders, deliveredLeads, deliveryFailures };
}
