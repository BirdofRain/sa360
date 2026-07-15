import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { evaluateLeadInventoryAvailability } from "./lead-inventory-availability.service.js";
import { calculateInventoryAgeDays } from "./lead-inventory-age.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import { bucketAvailabilityLabel } from "./lead-inventory-client-availability.helpers.js";

export const CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE = "global_lal_inventory" as const;

export type ClientLeadsOnDemandFilters = {
  clientAccountId: string;
  nicheKey?: string;
  productType?: string;
};

export async function buildClientLeadsOnDemandAvailability(
  filters: ClientLeadsOnDemandFilters,
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = new Date();
  const ageBands = await listActiveAgeBandDefinitions(undefined, db);
  const where: Record<string, unknown> = {
    status: { in: ["available", "reserved"] },
  };
  if (filters.nicheKey) where.nicheKey = filters.nicheKey;
  if (filters.productType) where.productType = filters.productType;

  const items = await db.leadInventoryItem.findMany({
    where,
    select: {
      id: true,
      status: true,
      generatedAt: true,
      normalizedState: true,
      inventoryClass: true,
      nicheKey: true,
      productType: true,
      exclusivityMode: true,
      maxFulfillments: true,
      fulfillmentCount: true,
      quarantineReason: true,
      withdrawnAt: true,
      expiredAt: true,
      sourceLeadEvent: {
        select: {
          sourceProvider: true,
          sourceSystem: true,
          sourceLeadUid: true,
          normalizedPayloadJson: true,
          enrichmentMetadataJson: true,
        },
      },
      inventoryLot: { select: { status: true } },
      leadAllocations: { select: { status: true, leadInventoryItemId: true } },
    },
  });

  const aggregate = new Map<
    string,
    {
      nicheKey: string;
      productType: string | null;
      state: string;
      ageBandLabel: string;
      inventoryClass: string;
      exclusivityMode: string;
      availableQuantity: number;
    }
  >();

  for (const item of items) {
    const leadUid = item.sourceLeadEvent.sourceLeadUid;
    const [proof, verification] = await Promise.all([
      leadUid ? getLeadProofByLeadUid(leadUid, db) : null,
      leadUid ? db.leadVerificationResult.findUnique({ where: { leadUid } }) : null,
    ]);
    const availability = evaluateLeadInventoryAvailability({
      item,
      lot: item.inventoryLot,
      sourceLeadEvent: item.sourceLeadEvent,
      leadProof: proof,
      verification,
      activeAllocations: item.leadAllocations,
      ageBands,
      evaluatedAt,
    });
    if (!availability.available) continue;

    const ageDays = calculateInventoryAgeDays(item.generatedAt, evaluatedAt);
    const band = ageBands.find(
      (b) =>
        ageDays >= b.minDaysInclusive &&
        (b.maxDaysExclusive == null || ageDays < b.maxDaysExclusive)
    );
    if (!band) continue;

    const key = [
      item.nicheKey,
      item.productType ?? "",
      item.normalizedState,
      band.key,
      item.inventoryClass,
      item.exclusivityMode,
    ].join("::");

    const current = aggregate.get(key) ?? {
      nicheKey: item.nicheKey,
      productType: item.productType,
      state: item.normalizedState,
      ageBandLabel: band.label,
      inventoryClass: item.inventoryClass,
      exclusivityMode: item.exclusivityMode,
      availableQuantity: 0,
    };
    current.availableQuantity += 1;
    aggregate.set(key, current);
  }

  return {
    catalogScope: CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE,
    rows: [...aggregate.values()].map((row) => ({
      nicheKey: row.nicheKey,
      productType: row.productType,
      state: row.state,
      ageBandLabel: row.ageBandLabel,
      inventoryClass: row.inventoryClass,
      exclusivityMode: row.exclusivityMode,
      availabilityLabel: bucketAvailabilityLabel(row.availableQuantity),
      unitPriceCents: null,
      evaluatedAt: evaluatedAt.toISOString(),
    })),
    evaluatedAt: evaluatedAt.toISOString(),
  };
}
