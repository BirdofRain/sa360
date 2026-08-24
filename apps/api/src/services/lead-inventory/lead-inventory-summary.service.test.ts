import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLeadInventorySummary } from "./lead-inventory-summary.service.js";

function createSummaryPrismaMock(itemCount: number) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item_${String(i).padStart(4, "0")}`,
    status: "available",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    normalizedState: "TX",
    inventoryClass: "aged",
    nicheKey: "TRUCKER",
    maxFulfillments: 1,
    fulfillmentCount: 0,
    quarantineReason: null,
    withdrawnAt: null,
    expiredAt: null,
    commerceExcludedAt: null,
    sourceLeadEvent: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      sourceLeadUid: `uid_${i}`,
      normalizedPayloadJson: {
        contact: { phone_e164: "+15550100000", email: `a${i}@example.test`, state: "TX" },
      },
      enrichmentMetadataJson: {},
    },
    inventoryLot: { status: "active" },
    leadAllocations: [],
  }));

  let findManyCalls = 0;
  let proofFindManyCalls = 0;
  let verificationFindManyCalls = 0;

  return {
    findManyCalls: () => findManyCalls,
    proofFindManyCalls: () => proofFindManyCalls,
    verificationFindManyCalls: () => verificationFindManyCalls,
    db: {
      leadInventoryItem: {
        count: async () => itemCount,
        groupBy: async ({ by }: { by: string[] }) => {
          if (by[0] === "status") {
            return [{ status: "available", _count: { _all: itemCount } }];
          }
          return [];
        },
        findMany: async (args: { take?: number; cursor?: { id: string }; skip?: number }) => {
          findManyCalls += 1;
          const take = args.take ?? itemCount;
          let start = 0;
          if (args.cursor?.id) {
            const idx = items.findIndex((row) => row.id === args.cursor!.id);
            start = idx >= 0 ? idx + (args.skip ?? 0) : 0;
          }
          return items.slice(start, start + take);
        },
      },
      inventoryLot: {
        groupBy: async () => [{ status: "active", _count: { _all: 1 } }],
      },
      leadProof: {
        findMany: async () => {
          proofFindManyCalls += 1;
          return [];
        },
      },
      leadVerificationResult: {
        findMany: async () => {
          verificationFindManyCalls += 1;
          return [];
        },
      },
      leadAgeBandDefinition: {
        findMany: async () => [],
      },
    },
  };
}

test("inventory summary uses bounded chunks and batched proof lookups (no per-item N+1)", async () => {
  const mock = createSummaryPrismaMock(250);
  const summary = await buildLeadInventorySummary(mock.db as never, { maxItems: 250 });
  assert.equal(summary.totalItems, 250);
  assert.equal(summary.scannedItems, 250);
  assert.equal(summary.truncated, false);
  // 250 items / chunk 100 => 3 findMany calls, not 250.
  assert.ok(mock.findManyCalls() <= 3);
  assert.ok(mock.proofFindManyCalls() <= 3);
  assert.ok(mock.verificationFindManyCalls() <= 3);
  assert.notEqual(mock.proofFindManyCalls(), 250);
});

test("inventory summary respects hard max and marks truncated", async () => {
  const mock = createSummaryPrismaMock(50);
  const summary = await buildLeadInventorySummary(mock.db as never, { maxItems: 20 });
  assert.equal(summary.totalItems, 50);
  assert.equal(summary.scannedItems, 20);
  assert.equal(summary.truncated, true);
});

test("inventory summary stops when AbortSignal aborts", async () => {
  const mock = createSummaryPrismaMock(500);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => buildLeadInventorySummary(mock.db as never, { signal: controller.signal, maxItems: 500 }),
    (err: unknown) => err instanceof Error && err.name === "AbortError"
  );
});
