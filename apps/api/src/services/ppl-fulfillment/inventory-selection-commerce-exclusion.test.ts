import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { queryEligibleInventoryCandidatesBounded } from "./inventory-selection.service.js";

type FakeItem = {
  id: string;
  generatedAt: Date;
  status: string;
  inventoryClass: string;
  nicheKey: string;
  normalizedState: string;
  commerceExcludedAt: Date | null;
  inventoryLot: { supplierAccountId: string | null; status: string };
  sourceLeadEvent: {
    id: string;
    normalizedPayloadJson: unknown;
    enrichmentMetadataJson: unknown;
  };
};

function daysAgo(days: number, evaluatedAt: Date): Date {
  return new Date(evaluatedAt.getTime() - days * 86400000);
}

function makeItem(input: {
  id: string;
  ageDays: number;
  evaluatedAt: Date;
  phone: string;
  email: string;
  excluded?: boolean;
}): FakeItem {
  return {
    id: input.id,
    generatedAt: daysAgo(input.ageDays, input.evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: "NC",
    commerceExcludedAt: input.excluded ? new Date("2026-08-24T16:00:00.000Z") : null,
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      normalizedPayloadJson: {
        contact: {
          first_name: "Ty",
          last_name: input.id.length > 1 ? input.id : `${input.id}x`,
          phone_e164: input.phone,
          email: input.email,
          state: "NC",
        },
        lead_details: { consumer_age: 55 },
      },
      enrichmentMetadataJson: {},
    },
  };
}

function buildFakeDb(allItems: FakeItem[]) {
  const db = {
    buyerDeliveredIdentity: { findMany: async () => [] },
    leadInventoryItem: {
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        let rows = [...allItems];
        if (args.where.commerceExcludedAt === null) {
          rows = rows.filter((row) => row.commerceExcludedAt == null);
        }
        if (args.where.status === "available") {
          rows = rows.filter((row) => row.status === "available");
        }
        if (args.where.inventoryClass === "aged") {
          rows = rows.filter((row) => row.inventoryClass === "aged");
        }
        rows.sort((a, b) => {
          const d = a.generatedAt.getTime() - b.generatedAt.getTime();
          if (d !== 0) return d;
          return a.id.localeCompare(b.id);
        });
        return rows.slice(0, args.take);
      },
    },
  };
  return db as unknown as PrismaClient;
}

const BUCKETS = [
  "COMMERCE_1_3_MO",
  "COMMERCE_3_6_MO",
  "COMMERCE_6_9_MO",
  "COMMERCE_9_12_MO",
  "COMMERCE_12_MO_PLUS",
] as const;

async function scan(items: FakeItem[], evaluatedAt: Date, extra: Record<string, unknown> = {}) {
  return queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: [...BUCKETS],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 10,
      ...extra,
    },
    buildFakeDb(items)
  );
}

test("normal 30-day available aged item remains selectable", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const result = await scan(
    [
      makeItem({
        id: "normal-30",
        ageDays: 30,
        evaluatedAt,
        phone: "+15553000001",
        email: "normal30@example.test",
      }),
    ],
    evaluatedAt
  );
  assert.deepEqual(
    result.candidates.map((row) => row.item.id),
    ["normal-30"]
  );
  assert.equal(result.exclusionCounts.commerceExcluded, 0);
});

test("fresh commerce-excluded item is not selectable", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const result = await scan(
    [
      makeItem({
        id: "ex-fresh",
        ageDays: 2,
        evaluatedAt,
        phone: "+15553000002",
        email: "exfresh@example.test",
        excluded: true,
      }),
    ],
    evaluatedAt
  );
  assert.equal(result.candidates.length, 0);
});

test("30-day commerce-excluded item is not selectable", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const result = await scan(
    [
      makeItem({
        id: "ex-30",
        ageDays: 30,
        evaluatedAt,
        phone: "+15553000003",
        email: "ex30@example.test",
        excluded: true,
      }),
    ],
    evaluatedAt
  );
  assert.equal(result.candidates.length, 0);
});

test("90-day commerce-excluded item is not selectable", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const result = await scan(
    [
      makeItem({
        id: "ex-90",
        ageDays: 90,
        evaluatedAt,
        phone: "+15553000004",
        email: "ex90@example.test",
        excluded: true,
      }),
    ],
    evaluatedAt
  );
  assert.equal(result.candidates.length, 0);
});

test("365+ commerce-excluded item is not selectable", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const result = await scan(
    [
      makeItem({
        id: "ex-365",
        ageDays: 400,
        evaluatedAt,
        phone: "+15553000005",
        email: "ex365@example.test",
        excluded: true,
      }),
    ],
    evaluatedAt
  );
  assert.equal(result.candidates.length, 0);
});

test("exclusion survives different evaluatedAt / lifecycle recalculation", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const item = makeItem({
    id: "ex-clock",
    ageDays: 0,
    evaluatedAt: createdAt,
    phone: "+15553000006",
    email: "exclock@example.test",
    excluded: true,
  });
  item.generatedAt = createdAt;
  for (const days of [0, 15, 30, 90, 400]) {
    const evaluatedAt = new Date(createdAt.getTime() + days * 86400000);
    const result = await scan([item], evaluatedAt);
    assert.equal(result.candidates.length, 0, `day ${days} leaked excluded item`);
  }
});

test("repeated candidate scans never return an excluded item", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const items = [
    makeItem({
      id: "ok-repeat",
      ageDays: 45,
      evaluatedAt,
      phone: "+15553000007",
      email: "okrepeat@example.test",
    }),
    makeItem({
      id: "ex-repeat",
      ageDays: 46,
      evaluatedAt,
      phone: "+15553000008",
      email: "exrepeat@example.test",
      excluded: true,
    }),
  ];
  for (let i = 0; i < 3; i += 1) {
    const result = await scan(items, evaluatedAt);
    assert.deepEqual(
      result.candidates.map((row) => row.item.id),
      ["ok-repeat"]
    );
  }
});

test("replacement-style scan cannot select an excluded item", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const result = await scan(
    [
      makeItem({
        id: "ex-replace",
        ageDays: 60,
        evaluatedAt,
        phone: "+15553000009",
        email: "exreplace@example.test",
        excluded: true,
      }),
      makeItem({
        id: "ok-replace",
        ageDays: 61,
        evaluatedAt,
        phone: "+15553000010",
        email: "okreplace@example.test",
      }),
    ],
    evaluatedAt,
    { excludeInventoryItemIds: ["original-item"] }
  );
  assert.deepEqual(
    result.candidates.map((row) => row.item.id),
    ["ok-replace"]
  );
});

test("node-side recheck counts commerceExcluded when a stale row leaks past SQL", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const leaked = makeItem({
    id: "leaked",
    ageDays: 45,
    evaluatedAt,
    phone: "+15553000011",
    email: "leaked@example.test",
    excluded: true,
  });
  const db = {
    buyerDeliveredIdentity: { findMany: async () => [] },
    leadInventoryItem: {
      findMany: async () => [leaked],
    },
  } as unknown as PrismaClient;
  const result = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: [...BUCKETS],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 5,
    },
    db
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.exclusionCounts.commerceExcluded, 1);
});
