import type { LeadAllocationStatus, LeadInventoryItemStatus, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { assertExpectedDbHost } from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { isInventoryCommerceExcluded } from "./inventory-commerce-exclusion.js";

export const INVENTORY_COMMERCE_EXCLUDE_CONFIRMATION =
  "EXCLUDE ONE INVENTORY ITEM FROM COMMERCE" as const;

export const COMMERCE_EXCLUDE_BLOCKED_ITEM_STATUSES = [
  "reserved",
  "committed",
  "fulfilled",
] as const satisfies readonly LeadInventoryItemStatus[];

/** Nonterminal allocations that must block exclusion. Do not auto-cancel. */
export const COMMERCE_EXCLUDE_LIVE_ALLOCATION_STATUSES = [
  "shadow",
  "reserved",
  "delivering",
  "committed",
  "review_required",
] as const satisfies readonly LeadAllocationStatus[];

export type InventoryCommerceExcludeOutcome =
  | "EXCLUDED"
  | "REFUSED"
  | "REFUSED_ALREADY_EXCLUDED"
  | "FAILED";

export type InventoryCommerceExcludeReasonCode =
  | "confirmation_mismatch"
  | "operator_required"
  | "reason_required"
  | "database_url_required"
  | "db_host_mismatch"
  | "item_not_found"
  | "source_event_mismatch"
  | "already_excluded"
  | "item_reserved"
  | "item_committed"
  | "item_fulfilled"
  | "live_allocation_exists"
  | "update_race"
  | "postcheck_failed";

export type InventoryCommerceExcludeArgs = {
  inventoryItemId: string;
  expectedSourceEventId: string;
  expectedDbHost: string;
  reason: string;
  operator: string;
  confirm: string;
  databaseUrl: string;
};

export type InventoryCommerceExcludeSafeItem = {
  id: string;
  sourceLeadEventId: string;
  status: string;
  nicheKey: string;
  inventoryClass: string;
  commerceExcludedAt: string | null;
  commerceExcludedReason: string | null;
  commerceExcludedBy: string | null;
};

export type InventoryCommerceExcludeResult = {
  outcome: InventoryCommerceExcludeOutcome;
  ok: boolean;
  reasonCode?: InventoryCommerceExcludeReasonCode;
  reason?: string;
  writesAttempted: boolean;
  dbHostVerified?: string;
  operator?: string;
  item?: InventoryCommerceExcludeSafeItem;
  liveAllocationCount?: number;
  liveAllocationStatuses?: string[];
  commerciallySelectable?: boolean;
};

type LockedInventoryRow = {
  id: string;
  status: string;
  sourceLeadEventId: string;
  nicheKey: string;
  inventoryClass: string;
  commerceExcludedAt: Date | null;
  commerceExcludedReason: string | null;
  commerceExcludedBy: string | null;
};

function presentItem(row: LockedInventoryRow): InventoryCommerceExcludeSafeItem {
  return {
    id: row.id,
    sourceLeadEventId: row.sourceLeadEventId,
    status: row.status,
    nicheKey: row.nicheKey,
    inventoryClass: row.inventoryClass,
    commerceExcludedAt: row.commerceExcludedAt?.toISOString() ?? null,
    commerceExcludedReason: row.commerceExcludedReason,
    commerceExcludedBy: row.commerceExcludedBy,
  };
}

function refused(
  reasonCode: InventoryCommerceExcludeReasonCode,
  reason: string,
  extra: Partial<InventoryCommerceExcludeResult> = {}
): InventoryCommerceExcludeResult {
  const outcome =
    reasonCode === "already_excluded" ? "REFUSED_ALREADY_EXCLUDED" : "REFUSED";
  return {
    outcome,
    ok: false,
    reasonCode,
    reason,
    writesAttempted: extra.writesAttempted ?? false,
    ...extra,
  };
}

function statusRefusal(status: string): InventoryCommerceExcludeResult | null {
  if (status === "reserved") {
    return refused("item_reserved", "inventory_item_is_reserved");
  }
  if (status === "committed") {
    return refused("item_committed", "inventory_item_is_committed");
  }
  if (status === "fulfilled") {
    return refused("item_fulfilled", "inventory_item_is_fulfilled");
  }
  return null;
}

async function loadLiveAllocations(
  tx: PrismaClient,
  inventoryItemId: string
): Promise<Array<{ id: string; status: string }>> {
  return tx.leadAllocation.findMany({
    where: {
      leadInventoryItemId: inventoryItemId,
      status: { in: [...COMMERCE_EXCLUDE_LIVE_ALLOCATION_STATUSES] },
    },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
}

function commerciallySelectablePredicateHolds(row: {
  commerceExcludedAt: Date | null;
}): boolean {
  return !isInventoryCommerceExcluded(row);
}

export async function excludeInventoryItemFromCommerce(
  args: InventoryCommerceExcludeArgs,
  db: PrismaClient = defaultPrisma
): Promise<InventoryCommerceExcludeResult> {
  const inventoryItemId = args.inventoryItemId.trim();
  const expectedSourceEventId = args.expectedSourceEventId.trim();
  const operator = args.operator.trim();
  const reason = args.reason.trim();
  const confirm = args.confirm.trim();
  const databaseUrl = args.databaseUrl.trim();

  if (!databaseUrl) {
    return refused("database_url_required", "DATABASE_URL_required");
  }
  if (confirm !== INVENTORY_COMMERCE_EXCLUDE_CONFIRMATION) {
    return refused("confirmation_mismatch", "confirmation_phrase_mismatch");
  }
  if (!operator) {
    return refused("operator_required", "operator_required");
  }
  if (!reason) {
    return refused("reason_required", "reason_required");
  }
  if (!inventoryItemId || !expectedSourceEventId) {
    return refused("item_not_found", "inventory_item_id_and_source_event_id_required");
  }

  let dbHostVerified: string;
  try {
    const identity = assertExpectedDbHost({
      databaseUrl,
      expectedDbHost: args.expectedDbHost,
    });
    dbHostVerified = identity.port ? `${identity.host}:${identity.port}` : identity.host;
  } catch (err) {
    const message = err instanceof Error ? err.message : "db_host_mismatch";
    return refused("db_host_mismatch", message);
  }

  try {
    return await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedInventoryRow[]>`
        SELECT
          id,
          status::text AS status,
          "sourceLeadEventId",
          "nicheKey",
          "inventoryClass"::text AS "inventoryClass",
          "commerceExcludedAt",
          "commerceExcludedReason",
          "commerceExcludedBy"
        FROM "LeadInventoryItem"
        WHERE id = ${inventoryItemId}
        FOR UPDATE
      `;
      const item = locked[0];
      if (!item) {
        return refused("item_not_found", "lead_inventory_item_not_found", { dbHostVerified, operator });
      }

      const presented = presentItem(item);
      if (item.sourceLeadEventId !== expectedSourceEventId) {
        return refused("source_event_mismatch", "source_lead_event_id_mismatch", {
          dbHostVerified,
          operator,
          item: presented,
        });
      }

      if (isInventoryCommerceExcluded(item)) {
        return refused("already_excluded", "inventory_item_already_commerce_excluded", {
          dbHostVerified,
          operator,
          item: presented,
          commerciallySelectable: false,
        });
      }

      const blockedStatus = statusRefusal(item.status);
      if (blockedStatus) {
        return { ...blockedStatus, dbHostVerified, operator, item: presented };
      }

      const liveAllocations = await loadLiveAllocations(tx as unknown as PrismaClient, item.id);
      if (liveAllocations.length > 0) {
        return refused("live_allocation_exists", "live_or_nonterminal_allocation_exists", {
          dbHostVerified,
          operator,
          item: presented,
          liveAllocationCount: liveAllocations.length,
          liveAllocationStatuses: liveAllocations.map((row) => row.status),
        });
      }

      const now = new Date();
      const updated = await tx.leadInventoryItem.updateMany({
        where: {
          id: item.id,
          commerceExcludedAt: null,
          status: { notIn: [...COMMERCE_EXCLUDE_BLOCKED_ITEM_STATUSES] },
        },
        data: {
          commerceExcludedAt: now,
          commerceExcludedReason: reason,
          commerceExcludedBy: operator,
        },
      });
      if (updated.count !== 1) {
        const raced = await tx.leadInventoryItem.findUnique({
          where: { id: item.id },
          select: {
            id: true,
            status: true,
            sourceLeadEventId: true,
            nicheKey: true,
            inventoryClass: true,
            commerceExcludedAt: true,
            commerceExcludedReason: true,
            commerceExcludedBy: true,
          },
        });
        if (raced && isInventoryCommerceExcluded(raced)) {
          return refused("already_excluded", "inventory_item_already_commerce_excluded", {
            writesAttempted: true,
            dbHostVerified,
            operator,
            item: presentItem(raced),
            commerciallySelectable: false,
          });
        }
        return refused("update_race", "conditional_exclude_update_matched_zero_rows", {
          writesAttempted: true,
          dbHostVerified,
          operator,
          item: raced ? presentItem(raced) : presented,
        });
      }

      const after = await tx.leadInventoryItem.findUnique({
        where: { id: item.id },
        select: {
          id: true,
          status: true,
          sourceLeadEventId: true,
          nicheKey: true,
          inventoryClass: true,
          commerceExcludedAt: true,
          commerceExcludedReason: true,
          commerceExcludedBy: true,
        },
      });
      const afterLive = await loadLiveAllocations(tx as unknown as PrismaClient, item.id);
      if (
        !after ||
        after.id !== item.id ||
        after.sourceLeadEventId !== expectedSourceEventId ||
        after.commerceExcludedReason !== reason ||
        after.commerceExcludedBy !== operator ||
        !after.commerceExcludedAt ||
        afterLive.length > 0 ||
        commerciallySelectablePredicateHolds(after)
      ) {
        return {
          outcome: "FAILED",
          ok: false,
          reasonCode: "postcheck_failed",
          reason: "post_exclusion_verification_failed",
          writesAttempted: true,
          dbHostVerified,
          operator,
          item: after ? presentItem(after) : presented,
          liveAllocationCount: afterLive.length,
          liveAllocationStatuses: afterLive.map((row) => row.status),
          commerciallySelectable: after ? commerciallySelectablePredicateHolds(after) : undefined,
        };
      }

      const sneak = await tx.leadInventoryItem.findMany({
        where: {
          id: after.id,
          status: "available",
          inventoryClass: "aged",
          commerceExcludedAt: null,
        },
        select: { id: true },
        take: 1,
      });
      if (sneak.length > 0) {
        return {
          outcome: "FAILED",
          ok: false,
          reasonCode: "postcheck_failed",
          reason: "excluded_item_still_matched_ppl_predicate",
          writesAttempted: true,
          dbHostVerified,
          operator,
          item: presentItem(after),
          liveAllocationCount: 0,
          commerciallySelectable: true,
        };
      }

      return {
        outcome: "EXCLUDED",
        ok: true,
        writesAttempted: true,
        dbHostVerified,
        operator,
        item: presentItem(after),
        liveAllocationCount: 0,
        liveAllocationStatuses: [],
        commerciallySelectable: false,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "exclude_failed";
    return {
      outcome: "FAILED",
      ok: false,
      reason: message,
      writesAttempted: true,
      dbHostVerified,
      operator,
    };
  }
}
