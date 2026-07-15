import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { evaluateLeadInventoryAvailability } from "./lead-inventory-availability.service.js";
import { calculateInventoryAgeDays } from "./lead-inventory-age.js";
import { buildLeadInventoryDemandOverlay } from "./lead-inventory-demand.service.js";

export type LeadInventoryFacetFilters = {
  nicheKey?: string;
  productType?: string;
  inventoryClass?: string;
  sourceLane?: string;
  lotId?: string;
  status?: string;
  availableOnly?: boolean;
  ageBandVersion?: string;
};

type FacetCell = {
  state: string;
  ageBandKey: string;
  ageBandLabel: string;
  total: number;
  available: number;
  reserved: number;
  blocked: number;
  demand: number;
  supply: number;
  unmet: number;
  coverageRatio: number | null;
};

export async function buildLeadInventoryFacets(
  filters: LeadInventoryFacetFilters = {},
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = new Date();
  const ageBands = await listActiveAgeBandDefinitions(filters.ageBandVersion, db);
  const where: Record<string, unknown> = {};
  if (filters.nicheKey) where.nicheKey = filters.nicheKey;
  if (filters.productType) where.productType = filters.productType;
  if (filters.inventoryClass) where.inventoryClass = filters.inventoryClass;
  if (filters.sourceLane) where.sourceLane = filters.sourceLane;
  if (filters.lotId) where.inventoryLotId = filters.lotId;
  if (filters.status) where.status = filters.status;

  const items = await db.leadInventoryItem.findMany({
    where,
    select: {
      id: true,
      status: true,
      generatedAt: true,
      normalizedState: true,
      inventoryClass: true,
      nicheKey: true,
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
      leadAllocations: { select: { status: true } },
    },
  });

  const demandOverlay = await buildLeadInventoryDemandOverlay(filters, db);
  const cellMap = new Map<string, FacetCell>();

  for (const band of ageBands) {
    for (const item of items) {
      const state = item.normalizedState;
      if (!state) continue;
      const ageDays = calculateInventoryAgeDays(item.generatedAt, evaluatedAt);
      const inBand =
        ageDays >= band.minDaysInclusive &&
        (band.maxDaysExclusive == null || ageDays < band.maxDaysExclusive);
      if (!inBand) continue;

      const key = `${state}::${band.key}`;
      if (!cellMap.has(key)) {
        const demandCell = demandOverlay.cells.find(
          (c) => c.state === state && c.ageBandKey === band.key
        );
        cellMap.set(key, {
          state,
          ageBandKey: band.key,
          ageBandLabel: band.label,
          total: 0,
          available: 0,
          reserved: 0,
          blocked: 0,
          demand: demandCell?.demand ?? 0,
          supply: 0,
          unmet: demandCell?.unmet ?? 0,
          coverageRatio: demandCell?.coverageRatio ?? null,
        });
      }
      const cell = cellMap.get(key)!;
      cell.total += 1;
      cell.supply += 1;

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

      if (item.status === "reserved") cell.reserved += 1;
      if (availability.available) {
        cell.available += 1;
      } else {
        cell.blocked += 1;
      }
    }
  }

  const rows = [...cellMap.values()].sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    return a.ageBandKey.localeCompare(b.ageBandKey);
  });

  if (filters.availableOnly) {
    return {
      rows: rows.filter((row) => row.available > 0),
      ageBands,
      evaluatedAt: evaluatedAt.toISOString(),
      totals: summarizeFacetRows(rows),
    };
  }

  return {
    rows,
    ageBands: ageBands.map((b) => ({ key: b.key, label: b.label })),
    evaluatedAt: evaluatedAt.toISOString(),
    totals: summarizeFacetRows(rows),
  };
}

function summarizeFacetRows(rows: FacetCell[]) {
  const byState = new Map<string, number>();
  const byAgeBand = new Map<string, number>();
  let overall = 0;
  for (const row of rows) {
    overall += row.total;
    byState.set(row.state, (byState.get(row.state) ?? 0) + row.total);
    byAgeBand.set(row.ageBandKey, (byAgeBand.get(row.ageBandKey) ?? 0) + row.total);
  }
  return {
    overall,
    byState: Object.fromEntries(byState),
    byAgeBand: Object.fromEntries(byAgeBand),
  };
}
