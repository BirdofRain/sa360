import type { PrismaClient } from "@prisma/client";

import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { prisma as defaultPrisma } from "../../lib/db.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import {
  listActiveAgeBandDefinitions,
  listLeadInventoryItems,
  type LeadInventoryListFilters,
} from "../../repositories/lead-inventory.repository.js";
import { evaluateLeadInventoryAvailability } from "./lead-inventory-availability.service.js";
import { calculateInventoryAgeDays } from "./lead-inventory-age.js";
import {
  presentInventoryItemDetail,
  presentInventoryItemListRow,
} from "./lead-inventory-present.service.js";
import { findLeadInventoryItemById, findInventoryLotById, listInventoryLots } from "../../repositories/lead-inventory.repository.js";

export async function buildLeadInventoryItemsList(
  filters: LeadInventoryListFilters,
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = new Date();
  const ageBands = await listActiveAgeBandDefinitions(undefined, db);
  const rows = await listLeadInventoryItems(filters, db);
  const items = [];

  for (const row of rows) {
    const leadUid = row.sourceLeadEvent.sourceLeadUid;
    const [proof, verification] = await Promise.all([
      leadUid ? getLeadProofByLeadUid(leadUid, db) : null,
      leadUid ? db.leadVerificationResult.findUnique({ where: { leadUid } }) : null,
    ]);
    const availability = evaluateLeadInventoryAvailability({
      item: row,
      lot: row.inventoryLot,
      sourceLeadEvent: row.sourceLeadEvent,
      leadProof: proof,
      verification,
      activeAllocations: row.leadAllocations,
      ageBands,
      evaluatedAt,
    });

    if (filters.available === true && !availability.available) continue;
    if (filters.proofStatus && availability.proofStatus !== filters.proofStatus) continue;
    if (filters.verificationStatus && availability.verificationStatus !== filters.verificationStatus) {
      continue;
    }

    if (filters.ageBandKey && availability.ageBandKey !== filters.ageBandKey) continue;
    if (filters.minAgeDays != null && availability.ageDays < filters.minAgeDays) continue;
    if (filters.maxAgeDays != null && availability.ageDays > filters.maxAgeDays) continue;

    items.push(
      presentInventoryItemListRow({
        id: row.id,
        maskedItemId: maskSourceLeadUidForAudit(row.id) ?? "inv***",
        normalizedState: row.normalizedState,
        generatedAt: row.generatedAt,
        ageDays: availability.ageDays,
        ageBandKey: availability.ageBandKey,
        inventoryClass: row.inventoryClass,
        sourceLane: row.sourceLane,
        lotDisplayName: row.inventoryLot.displayName,
        lotId: row.inventoryLot.id,
        proofStatus: availability.proofStatus,
        verificationStatus: availability.verificationStatus,
        itemStatus: row.status,
        reservationStatus: availability.reservationStatus,
        available: availability.available,
        blockers: availability.blockers,
      })
    );
  }

  const nextCursor = rows.length > 0 ? rows[rows.length - 1]!.id : null;
  return {
    items,
    nextCursor: items.length > 0 ? nextCursor : null,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

export async function buildLeadInventoryItemDetail(id: string, db: PrismaClient = defaultPrisma) {
  const evaluatedAt = new Date();
  const row = await findLeadInventoryItemById(id, db);
  if (!row) return null;

  const ageBands = await listActiveAgeBandDefinitions(undefined, db);
  const leadUid = row.sourceLeadEvent.sourceLeadUid;
  const [proof, verification] = await Promise.all([
    leadUid ? getLeadProofByLeadUid(leadUid, db) : null,
    leadUid ? db.leadVerificationResult.findUnique({ where: { leadUid } }) : null,
  ]);
  const availability = evaluateLeadInventoryAvailability({
    item: row,
    lot: row.inventoryLot,
    sourceLeadEvent: row.sourceLeadEvent,
    leadProof: proof,
    verification,
    activeAllocations: row.leadAllocations,
    ageBands,
    evaluatedAt,
  });

  return presentInventoryItemDetail({
    item: row,
    lot: row.inventoryLot,
    maskedLeadUid: maskSourceLeadUidForAudit(row.sourceLeadEvent.sourceLeadUid),
    availability,
    allocationHistory: row.leadAllocations.map((allocation) => ({
      id: allocation.id,
      status: allocation.status,
      leadOrderId: allocation.leadOrderId,
      reservedAt: allocation.reservedAt?.toISOString() ?? null,
      committedAt: allocation.committedAt?.toISOString() ?? null,
      releasedAt: allocation.releasedAt?.toISOString() ?? null,
    })),
  });
}

export async function buildInventoryLotsWithCounts(db: PrismaClient = defaultPrisma) {
  const lots = await listInventoryLots(db);
  const evaluatedAt = new Date();
  const results = [];

  for (const lot of lots) {
    const grouped = await db.leadInventoryItem.groupBy({
      by: ["status"],
      where: { inventoryLotId: lot.id },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }
    results.push({
      id: lot.id,
      lotKey: lot.lotKey,
      displayName: lot.displayName,
      status: lot.status,
      inventoryClass: lot.inventoryClass,
      sourceLane: lot.sourceLane,
      nicheKey: lot.nicheKey,
      generatedFrom: lot.generatedFrom?.toISOString() ?? null,
      generatedTo: lot.generatedTo?.toISOString() ?? null,
      total,
      available: counts.available ?? 0,
      reserved: counts.reserved ?? 0,
      blocked: total - (counts.available ?? 0) - (counts.reserved ?? 0),
    });
  }

  return { lots: results, evaluatedAt: evaluatedAt.toISOString() };
}

export async function buildInventoryLotDetail(id: string, db: PrismaClient = defaultPrisma) {
  const lot = await findInventoryLotById(id, db);
  if (!lot) return null;
  const payload = await buildInventoryLotsWithCounts(db);
  const summary = payload.lots.find((entry) => entry.id === id);
  return { lot, counts: summary ?? null, evaluatedAt: payload.evaluatedAt };
}
