import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
  excludeInventoryItemFromCommerce,
  INVENTORY_COMMERCE_EXCLUDE_CONFIRMATION,
  type InventoryCommerceExcludeArgs,
} from "./inventory-commerce-exclusion.service.js";

const LOCAL_URL = "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_test";

type ItemState = {
  id: string;
  status: string;
  sourceLeadEventId: string;
  nicheKey: string;
  inventoryClass: string;
  commerceExcludedAt: Date | null;
  commerceExcludedReason: string | null;
  commerceExcludedBy: string | null;
};

function baseItem(overrides: Partial<ItemState> = {}): ItemState {
  return {
    id: "inv_1",
    status: "available",
    sourceLeadEventId: "evt_1",
    nicheKey: "nurse",
    inventoryClass: "aged",
    commerceExcludedAt: null,
    commerceExcludedReason: null,
    commerceExcludedBy: null,
    ...overrides,
  };
}

function baseArgs(overrides: Partial<InventoryCommerceExcludeArgs> = {}): InventoryCommerceExcludeArgs {
  return {
    inventoryItemId: "inv_1",
    expectedSourceEventId: "evt_1",
    expectedDbHost: "127.0.0.1",
    reason: "synthetic_nextgen_canary",
    operator: "Sam",
    confirm: INVENTORY_COMMERCE_EXCLUDE_CONFIRMATION,
    databaseUrl: LOCAL_URL,
    ...overrides,
  };
}

function createDb(input: {
  item?: ItemState | null;
  allocations?: Array<{ id: string; status: string }>;
  updateCount?: number;
  racedItem?: ItemState;
}) {
  const item = input.item === undefined ? baseItem() : input.item;
  const allocations = input.allocations ?? [];
  let updateCalls = 0;
  const tx = {
    $queryRaw: async () => (item ? [item] : []),
    leadAllocation: {
      findMany: async () => allocations,
    },
    leadInventoryItem: {
      updateMany: async () => {
        updateCalls += 1;
        if (item && (input.updateCount ?? 1) === 1 && item.commerceExcludedAt == null) {
          item.commerceExcludedAt = new Date("2026-08-24T16:00:00.000Z");
          item.commerceExcludedReason = "synthetic_nextgen_canary";
          item.commerceExcludedBy = "Sam";
          return { count: 1 };
        }
        return { count: input.updateCount ?? 0 };
      },
      findUnique: async () => input.racedItem ?? item,
      findMany: async (args: { where: { commerceExcludedAt?: null } }) => {
        const current = input.racedItem ?? item;
        if (!current) return [];
        if (args.where.commerceExcludedAt === null && current.commerceExcludedAt != null) {
          return [];
        }
        return [{ id: current.id }];
      },
    },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    updateCalls: () => updateCalls,
  };
  return { db: db as unknown as PrismaClient, updateCalls: () => updateCalls, item };
}

test("valid exclude writes only commerce exclusion fields", async () => {
  const { db, updateCalls, item } = createDb({});
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "EXCLUDED");
  assert.equal(result.ok, true);
  assert.equal(result.writesAttempted, true);
  assert.equal(updateCalls(), 1);
  assert.equal(result.item?.id, "inv_1");
  assert.equal(result.item?.sourceLeadEventId, "evt_1");
  assert.equal(result.item?.commerceExcludedReason, "synthetic_nextgen_canary");
  assert.equal(result.item?.commerceExcludedBy, "Sam");
  assert.ok(result.item?.commerceExcludedAt);
  assert.equal(result.commerciallySelectable, false);
  assert.ok(item);
  assert.equal(item.status, "available");
  assert.equal(item.nicheKey, "nurse");
});

test("wrong DB host refuses without write", async () => {
  const { db, updateCalls } = createDb({});
  const result = await excludeInventoryItemFromCommerce(
    baseArgs({ expectedDbHost: "example.invalid" }),
    db
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "db_host_mismatch");
  assert.equal(result.writesAttempted, false);
  assert.equal(updateCalls(), 0);
});

test("wrong confirmation refuses without write", async () => {
  const { db, updateCalls } = createDb({});
  const result = await excludeInventoryItemFromCommerce(baseArgs({ confirm: "NOPE" }), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "confirmation_mismatch");
  assert.equal(updateCalls(), 0);
});

test("missing operator refuses without write", async () => {
  const { db, updateCalls } = createDb({});
  const result = await excludeInventoryItemFromCommerce(baseArgs({ operator: "  " }), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "operator_required");
  assert.equal(updateCalls(), 0);
});

test("missing reason refuses without write", async () => {
  const { db, updateCalls } = createDb({});
  const result = await excludeInventoryItemFromCommerce(baseArgs({ reason: "" }), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "reason_required");
  assert.equal(updateCalls(), 0);
});

test("wrong sourceEventId refuses without write", async () => {
  const { db, updateCalls } = createDb({});
  const result = await excludeInventoryItemFromCommerce(
    baseArgs({ expectedSourceEventId: "evt_other" }),
    db
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "source_event_mismatch");
  assert.equal(updateCalls(), 0);
});

test("item not found refuses without write", async () => {
  const { db, updateCalls } = createDb({ item: null });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "item_not_found");
  assert.equal(updateCalls(), 0);
});

test("already excluded second invocation is REFUSED_ALREADY_EXCLUDED and writes zero", async () => {
  const { db, updateCalls } = createDb({
    item: baseItem({
      commerceExcludedAt: new Date("2026-08-24T15:00:00.000Z"),
      commerceExcludedReason: "synthetic_nextgen_canary",
      commerceExcludedBy: "Sam",
    }),
  });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED_ALREADY_EXCLUDED");
  assert.equal(result.reasonCode, "already_excluded");
  assert.equal(result.writesAttempted, false);
  assert.equal(updateCalls(), 0);
});

test("reserved item is refused", async () => {
  const { db, updateCalls } = createDb({ item: baseItem({ status: "reserved" }) });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "item_reserved");
  assert.equal(updateCalls(), 0);
});

test("committed item is refused", async () => {
  const { db, updateCalls } = createDb({ item: baseItem({ status: "committed" }) });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "item_committed");
  assert.equal(updateCalls(), 0);
});

test("fulfilled item is refused", async () => {
  const { db, updateCalls } = createDb({ item: baseItem({ status: "fulfilled" }) });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "item_fulfilled");
  assert.equal(updateCalls(), 0);
});

test("active allocation including shadow is refused", async () => {
  const { db, updateCalls } = createDb({
    allocations: [{ id: "alloc_shadow", status: "shadow" }],
  });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "live_allocation_exists");
  assert.deepEqual(result.liveAllocationStatuses, ["shadow"]);
  assert.equal(updateCalls(), 0);
});

test("conditional update race returns already excluded when the other writer won", async () => {
  const raced = baseItem({
    commerceExcludedAt: new Date("2026-08-24T16:01:00.000Z"),
    commerceExcludedReason: "synthetic_nextgen_canary",
    commerceExcludedBy: "Other",
  });
  const { db } = createDb({ updateCount: 0, racedItem: raced });
  const result = await excludeInventoryItemFromCommerce(baseArgs(), db);
  assert.equal(result.outcome, "REFUSED_ALREADY_EXCLUDED");
  assert.equal(result.reasonCode, "already_excluded");
  assert.equal(result.writesAttempted, true);
});

test("missing DATABASE_URL refuses before host check", async () => {
  const { db, updateCalls } = createDb({});
  const result = await excludeInventoryItemFromCommerce(baseArgs({ databaseUrl: "" }), db);
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reasonCode, "database_url_required");
  assert.equal(updateCalls(), 0);
});
