/**
 * LO-1055 production recovery — read-only blast-radius measurement for the two
 * recovery lots that hold the pending_review candidates.
 *
 * The targeted per-item review API rejects this inventory lane
 * (`source_lane_unrecognized`), so the only production service able to activate
 * it is the lot-scale aged ops-verify path. This script quantifies exactly how
 * many rows that path would touch before any decision is made. PII-free.
 */

import { prisma } from "../lib/db.js";

const LOT_KEYS = [
  "lot_aged_recovery_historical_parser_vet_b4471cf183f8",
  "lot_aged_recovery_post_snapshot_vet_b4471cf183f8",
];

const ORDER_STATES = new Set(["IN", "SC", "AZ"]);
const MS_PER_DAY = 86_400_000;

async function main(): Promise<void> {
  console.log("[preflight] db host:", /@([^/:]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown");
  const now = Date.now();

  for (const lotKey of LOT_KEYS) {
    const lot = await prisma.inventoryLot.findUnique({
      where: { lotKey },
      select: { id: true, lotKey: true, status: true, nicheKey: true, sourceLane: true, createdAt: true },
    });
    if (!lot) {
      console.log(`\n### ${lotKey}: NOT FOUND`);
      continue;
    }

    const byStatus = await prisma.leadInventoryItem.groupBy({
      by: ["status"],
      where: { inventoryLotId: lot.id },
      _count: { _all: true },
    });

    const pending = await prisma.leadInventoryItem.findMany({
      where: { inventoryLotId: lot.id, status: "pending_review" },
      select: { id: true, normalizedState: true, nicheKey: true, generatedAt: true, commerceExcludedAt: true },
    });

    const inOrderScope = pending.filter((p) => {
      if (!ORDER_STATES.has(p.normalizedState)) return false;
      if (p.commerceExcludedAt != null) return false;
      const ageDays = Math.floor((now - p.generatedAt.getTime()) / MS_PER_DAY);
      return ageDays >= 30 && ageDays < 90;
    });

    const outOfScope = pending.length - inOrderScope.length;
    const stateTally = pending.reduce<Record<string, number>>((acc, p) => {
      acc[p.normalizedState] = (acc[p.normalizedState] ?? 0) + 1;
      return acc;
    }, {});
    const ageTally = pending.reduce<Record<string, number>>((acc, p) => {
      const ageDays = Math.floor((now - p.generatedAt.getTime()) / MS_PER_DAY);
      const bucket =
        ageDays < 30 ? "lt30" : ageDays < 90 ? "30to89" : ageDays < 180 ? "90to179" : "gte180";
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`\n### ${lotKey}`);
    console.log(`  lotStatus=${lot.status} niche=${lot.nicheKey} lane=${lot.sourceLane} created=${lot.createdAt.toISOString()}`);
    console.log(`  itemsByStatus: ${JSON.stringify(byStatus.map((s) => ({ status: s.status, n: s._count._all })))}`);
    console.log(`  pending_review total: ${pending.length}`);
    console.log(`  pending in LO-1055 scope (IN/SC/AZ + 30<=age<90 + not excluded): ${inOrderScope.length}`);
    console.log(`  pending OUTSIDE LO-1055 scope (would be collaterally activated): ${outOfScope}`);
    console.log(`  pending state tally: ${JSON.stringify(stateTally)}`);
    console.log(`  pending age tally:   ${JSON.stringify(ageTally)}`);
  }

  // Global pending_review footprint, for contrast.
  const globalPending = await prisma.leadInventoryItem.count({ where: { status: "pending_review" } });
  console.log(`\n[global] pending_review rows across all inventory: ${globalPending}`);
}

main()
  .catch((error) => {
    console.error("[fatal]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
