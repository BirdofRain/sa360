import type { LeadInventoryClass, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { calculateInventoryAgeDays } from "./lead-inventory-age.js";
import { normalizeInventoryState } from "./lead-inventory-state.js";

export type LeadInventoryDemandFilters = {
  nicheKey?: string;
  productType?: string;
  inventoryClass?: string;
  sourceLane?: string;
  lotId?: string;
  status?: string;
  ageBandVersion?: string;
};

function parseStringArrayJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function buildLeadInventoryDemandOverlay(
  filters: LeadInventoryDemandFilters = {},
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = new Date();
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
        normalizedStatesJson: true,
        ageBandKeysJson: true,
        minAgeDays: true,
        maxAgeDays: true,
        requestedQuantity: true,
        reservedQuantity: true,
        nicheKey: true,
        productType: true,
        inventoryClassesJson: true,
        allowedSourceLanesJson: true,
      },
    }),
    db.leadInventoryItem.findMany({
      where: {
        status: { in: ["available", "reserved"] },
        ...(filters.nicheKey ? { nicheKey: filters.nicheKey } : {}),
        ...(filters.productType ? { productType: filters.productType } : {}),
        ...(filters.inventoryClass
          ? { inventoryClass: filters.inventoryClass as LeadInventoryClass }
          : {}),
        ...(filters.sourceLane ? { sourceLane: filters.sourceLane } : {}),
        ...(filters.lotId ? { inventoryLotId: filters.lotId } : {}),
      },
      select: { normalizedState: true, generatedAt: true, status: true },
    }),
  ]);

  const demandByCell = new Map<string, number>();
  const supplyByCell = new Map<string, { available: number; reserved: number }>();

  for (const line of orderLines) {
    const states = parseStringArrayJson(line.normalizedStatesJson).map((s) => normalizeInventoryState(s) ?? s);
    const bandKeys = parseStringArrayJson(line.ageBandKeysJson);
    const unmetQty = Math.max(line.requestedQuantity - line.reservedQuantity, 0);
    if (unmetQty <= 0) continue;

    const targetBands =
      bandKeys.length > 0
        ? ageBands.filter((b) => bandKeys.includes(b.key))
        : ageBands.filter((b) => {
            if (line.minAgeDays != null && b.minDaysInclusive < line.minAgeDays) return false;
            if (line.maxAgeDays != null && b.maxDaysExclusive != null && b.maxDaysExclusive > line.maxAgeDays + 1) {
              return b.minDaysInclusive <= line.maxAgeDays;
            }
            return true;
          });

    for (const state of states.length > 0 ? states : ["*"]) {
      for (const band of targetBands) {
        const key = `${state}::${band.key}`;
        demandByCell.set(key, (demandByCell.get(key) ?? 0) + unmetQty);
      }
    }
  }

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
    if (item.status === "reserved") current.reserved += 1;
    else current.available += 1;
    supplyByCell.set(key, current);
  }

  const keys = new Set([...demandByCell.keys(), ...supplyByCell.keys()]);
  const cells = [...keys].map((key) => {
    const [state, ageBandKey] = key.split("::");
    const demand = demandByCell.get(key) ?? 0;
    const supply = supplyByCell.get(key) ?? { available: 0, reserved: 0 };
    const totalSupply = supply.available + supply.reserved;
    const unmet = Math.max(demand - totalSupply, 0);
    const oversupply = Math.max(totalSupply - demand, 0);
    const coverageRatio = demand > 0 ? Number((totalSupply / demand).toFixed(4)) : null;
    return {
      state,
      ageBandKey,
      demand,
      supply: totalSupply,
      available: supply.available,
      reserved: supply.reserved,
      unmet,
      oversupply,
      coverageRatio,
    };
  });

  return { evaluatedAt: evaluatedAt.toISOString(), cells };
}
