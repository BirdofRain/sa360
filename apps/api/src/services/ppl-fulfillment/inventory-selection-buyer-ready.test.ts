import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import {
  commitPplInventorySelection,
  previewPplInventorySelection,
  queryEligibleInventoryCandidatesBounded,
} from "./inventory-selection.service.js";

type FakeItem = {
  id: string;
  generatedAt: Date;
  status: string;
  inventoryClass: string;
  nicheKey: string;
  normalizedState: string;
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
  evaluatedAt: Date;
  phone: string;
  email: string;
  first?: string;
  last?: string;
  age?: unknown;
  omitAge?: boolean;
  state?: string;
  ageDays?: number;
}): FakeItem {
  const contact = {
    first_name: input.first ?? "Ada",
    last_name: input.last ?? "Lee",
    phone_e164: input.phone,
    email: input.email,
    state: input.state ?? "NC",
  };
  const payload: Record<string, unknown> = { contact };
  if (!input.omitAge) {
    payload.lead_details = { consumer_age: input.age ?? 62 };
  }
  return {
    id: input.id,
    generatedAt: daysAgo(input.ageDays ?? 45, input.evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: input.state ?? "NC",
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      normalizedPayloadJson: payload,
      enrichmentMetadataJson: {},
    },
  };
}

function buildInventoryFakeDb(
  allItems: FakeItem[],
  opts: {
    priorFingerprints?: Array<{ phone?: string; email?: string }>;
    clientAccountId?: string;
    requestedQuantity?: number;
  } = {}
) {
  let findManyCalls = 0;
  let transactionCalls = 0;
  const clientAccountId = opts.clientAccountId ?? "client_a";
  const requestedQuantity = opts.requestedQuantity ?? 50;

  const db = {
    buyerDeliveredIdentity: {
      findMany: async (args?: { where?: { clientAccountId?: string } }) => {
        if (args?.where?.clientAccountId && args.where.clientAccountId !== clientAccountId) {
          return [];
        }
        return (opts.priorFingerprints ?? []).map((row) => ({
          phoneFingerprint: row.phone ?? null,
          emailFingerprint: row.email ?? null,
        }));
      },
    },
    protectedAgentExclusion: {
      findMany: async () => [],
    },
    leadOrderLine: {
      findMany: async () => [],
    },
    leadOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "active",
        canceledAt: null,
        completedAt: null,
        pausedAt: null,
        orderKind: "pay_per_lead",
        nicheKey: "vet",
        statesJson: ["NC"],
        clientAccountId,
        requestedQuantity,
        leadVolume: requestedQuantity,
      }),
    },
    leadAllocation: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    leadInventoryItem: {
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        findManyCalls += 1;
        let rows = [...allItems].sort((a, b) => {
          const d = a.generatedAt.getTime() - b.generatedAt.getTime();
          if (d !== 0) return d;
          return a.id.localeCompare(b.id);
        });
        const and = args.where.AND as Array<Record<string, unknown>> | undefined;
        if (and) {
          for (const clause of and) {
            if (clause.OR && Array.isArray(clause.OR)) {
              const or = clause.OR as Array<Record<string, unknown>>;
              if (or.some((entry) => entry.id != null || entry.generatedAt != null)) {
                const gtGen = or.find((entry) => {
                  const g = entry.generatedAt as { gt?: Date } | undefined;
                  return g && typeof g === "object" && "gt" in g;
                });
                const eqGen = or.find((entry) => entry.id != null);
                if (gtGen || eqGen) {
                  const cursorGen = (gtGen?.generatedAt as { gt?: Date } | undefined)?.gt;
                  const cursorId = (eqGen?.id as { gt?: string } | undefined)?.gt;
                  rows = rows.filter((row) => {
                    if (!cursorGen) return true;
                    if (row.generatedAt.getTime() > cursorGen.getTime()) return true;
                    if (
                      cursorId &&
                      row.generatedAt.getTime() === cursorGen.getTime() &&
                      row.id > cursorId
                    ) {
                      return true;
                    }
                    return false;
                  });
                }
              }
            }
          }
        }
        return rows.slice(0, args.take);
      },
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("transaction_should_not_run_on_fail_closed_or_quantity_probe");
    },
  };

  return {
    db: db as unknown as PrismaClient,
    getFindManyCalls: () => findManyCalls,
    getTransactionCalls: () => transactionCalls,
  };
}

const EVALUATED_AT = new Date("2026-08-12T00:00:00.000Z");

function valid(id: string, n: number): FakeItem {
  return makeItem({
    id,
    evaluatedAt: EVALUATED_AT,
    phone: `+1555400${String(n).padStart(4, "0")}`,
    email: `${id}@example.test`,
  });
}

let previousSelectionFlag: string | undefined;

before(() => {
  previousSelectionFlag = process.env.SA360_PPL_SELECTION_ENABLED;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
});

after(() => {
  if (previousSelectionFlag === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
  else process.env.SA360_PPL_SELECTION_ENABLED = previousSelectionFlag;
});

test("A: missing age does not consume reserved quantity", async () => {
  const missingAge = makeItem({
    id: "missing-age",
    evaluatedAt: EVALUATED_AT,
    phone: "+15554001001",
    email: "missing-age@example.test",
    omitAge: true,
    ageDays: 60,
  });
  const ok = valid("ok-after-missing-age", 2);
  const { db } = buildInventoryFakeDb([missingAge, ok], {
    requestedQuantity: 1,
  });

  const preview = await previewPplInventorySelection(
    { orderId: "order-a", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.selectedQuantity, 1);
  assert.deepEqual(preview.selectedItemIds, ["ok-after-missing-age"]);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 1);
});

test("B: one-character first name does not consume reserved quantity", async () => {
  const bad = makeItem({
    id: "short-first",
    evaluatedAt: EVALUATED_AT,
    phone: "+15554001003",
    email: "short-first@example.test",
    first: "A",
    ageDays: 60,
  });
  const ok = valid("ok-after-short-first", 4);
  const { db } = buildInventoryFakeDb([bad, ok], { requestedQuantity: 1 });
  const preview = await previewPplInventorySelection(
    { orderId: "order-b", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.selectedItemIds, ["ok-after-short-first"]);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 1);
});

test("C: one-character last name does not consume reserved quantity", async () => {
  const bad = makeItem({
    id: "short-last",
    evaluatedAt: EVALUATED_AT,
    phone: "+15554001005",
    email: "short-last@example.test",
    last: "L",
    ageDays: 60,
  });
  const ok = valid("ok-after-short-last", 6);
  const { db } = buildInventoryFakeDb([bad, ok], { requestedQuantity: 1 });
  const preview = await previewPplInventorySelection(
    { orderId: "order-c", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.selectedItemIds, ["ok-after-short-last"]);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 1);
});

test("D: whitespace/multi-part first name does not consume reserved quantity", async () => {
  const bad = makeItem({
    id: "multi-first",
    evaluatedAt: EVALUATED_AT,
    phone: "+15554001007",
    email: "multi-first@example.test",
    first: "Mary Ann",
    ageDays: 60,
  });
  const ok = valid("ok-after-multi-first", 8);
  const { db } = buildInventoryFakeDb([bad, ok], { requestedQuantity: 1 });
  const preview = await previewPplInventorySelection(
    { orderId: "order-d", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.selectedItemIds, ["ok-after-multi-first"]);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 1);
});

test("E: whitespace/multi-part last name does not consume reserved quantity", async () => {
  const bad = makeItem({
    id: "multi-last",
    evaluatedAt: EVALUATED_AT,
    phone: "+15554001009",
    email: "multi-last@example.test",
    last: "Van Dyke",
    ageDays: 60,
  });
  const ok = valid("ok-after-multi-last", 10);
  const { db } = buildInventoryFakeDb([bad, ok], { requestedQuantity: 1 });
  const preview = await previewPplInventorySelection(
    { orderId: "order-e", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.selectedItemIds, ["ok-after-multi-last"]);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 1);
});

test("F: selector searches beyond rejected candidates to satisfy requested quantity", async () => {
  const items: FakeItem[] = [
    makeItem({
      id: "bad-age",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002001",
      email: "bad-age@example.test",
      omitAge: true,
      ageDays: 80,
    }),
    makeItem({
      id: "bad-first",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002002",
      email: "bad-first@example.test",
      first: "J",
      ageDays: 79,
    }),
    makeItem({
      id: "good-1",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002003",
      email: "good-1@example.test",
      ageDays: 78,
    }),
    makeItem({
      id: "bad-last",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002004",
      email: "bad-last@example.test",
      last: "Q",
      ageDays: 77,
    }),
    makeItem({
      id: "bad-multi-first",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002005",
      email: "bad-mf@example.test",
      first: "Ann Marie",
      ageDays: 76,
    }),
    makeItem({
      id: "good-2",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002006",
      email: "good-2@example.test",
      ageDays: 75,
    }),
    makeItem({
      id: "bad-multi-last",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002007",
      email: "bad-ml@example.test",
      last: "De La Cruz",
      ageDays: 74,
    }),
    makeItem({
      id: "good-3",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554002008",
      email: "good-3@example.test",
      ageDays: 73,
    }),
  ];
  const { db } = buildInventoryFakeDb(items, { requestedQuantity: 3 });
  const preview = await previewPplInventorySelection(
    { orderId: "order-f", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 3 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.selectedQuantity, 3);
  assert.deepEqual(preview.selectedItemIds, ["good-1", "good-2", "good-3"]);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 5);
  assert.equal(preview.shortfallQuantity, 0);
});

test("G: 50 requested with sufficient valid inventory reserves 50, not 52/53", async () => {
  const items: FakeItem[] = [];
  for (let i = 0; i < 8; i += 1) {
    items.push(
      makeItem({
        id: `reject-${i}`,
        evaluatedAt: EVALUATED_AT,
        phone: `+15554003${String(i).padStart(3, "0")}`,
        email: `reject-${i}@example.test`,
        first: i % 2 === 0 ? "A" : "Mary Sue",
      })
    );
  }
  for (let i = 0; i < 70; i += 1) {
    items.push(valid(`good-${String(i).padStart(3, "0")}`, 100 + i));
  }
  const { db } = buildInventoryFakeDb(items, { requestedQuantity: 50 });
  const preview = await previewPplInventorySelection(
    { orderId: "order-g", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 50 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.requestedQuantity, 50);
  assert.equal(preview.selectedQuantity, 50);
  assert.ok(preview.eligibleQuantity >= 50);
  assert.ok(preview.eligibleQuantity <= 50 + 25);
  assert.notEqual(preview.selectedQuantity, 52);
  assert.notEqual(preview.selectedQuantity, 53);
  assert.equal(preview.shortfallQuantity, 0);
  assert.equal(preview.selectedItemIds.length, 50);
  assert.ok(preview.selectedItemIds.every((id) => id.startsWith("good-")));
});

test("H: insufficient valid inventory stays fail-safe (partial shortfall or no_inventory)", async () => {
  const threeValid = [valid("only-1", 1), valid("only-2", 2), valid("only-3", 3)];
  const invalids = [
    makeItem({
      id: "h-missing-age",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554004001",
      email: "h-missing@example.test",
      omitAge: true,
    }),
    makeItem({
      id: "h-short-first",
      evaluatedAt: EVALUATED_AT,
      phone: "+15554004002",
      email: "h-short@example.test",
      first: "B",
    }),
  ];
  const partialDb = buildInventoryFakeDb([...invalids, ...threeValid], {
    requestedQuantity: 50,
  });
  const partial = await previewPplInventorySelection(
    { orderId: "order-h-partial", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 50 },
    partialDb.db
  );
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  assert.equal(partial.selectedQuantity, 3);
  assert.equal(partial.shortfallQuantity, 47);
  assert.equal(partial.requestedQuantity, 50);
  assert.equal(partial.diagnostics?.selectionComplete, true);

  const emptyDb = buildInventoryFakeDb(invalids, { requestedQuantity: 50 });
  const empty = await previewPplInventorySelection(
    { orderId: "order-h-empty", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 50 },
    emptyDb.db
  );
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.equal(empty.code, "no_inventory");
  assert.equal(empty.selectedQuantity, 0);
  assert.equal(empty.shortfallQuantity, 50);
  assert.deepEqual(empty.reasons, ["eligible_inventory_shortage"]);

  const emptyCommit = await commitPplInventorySelection(
    {
      orderId: "order-h-empty",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 50,
      idempotencyKey: "buyer-ready-h",
    },
    emptyDb.db
  );
  assert.equal(emptyCommit.ok, false);
  if (emptyCommit.ok) return;
  assert.equal(emptyCommit.code, "no_inventory");
  assert.equal(emptyDb.getTransactionCalls(), 0);
});

test("I: same-buyer protection still holds for otherwise buyer-ready leads", async () => {
  const priorPhone = "+15554005001";
  const priorEmail = "prior-buyer@example.test";
  const prior = makeItem({
    id: "prior-same-buyer",
    evaluatedAt: EVALUATED_AT,
    phone: priorPhone,
    email: priorEmail,
  });
  const other = valid("other-ok", 52);
  const { db } = buildInventoryFakeDb([prior, other], {
    requestedQuantity: 2,
    priorFingerprints: [
      {
        phone: fingerprintIdentityValue("phone", priorPhone),
        email: fingerprintIdentityValue("email", priorEmail),
      },
    ],
  });
  const preview = await previewPplInventorySelection(
    { orderId: "order-i", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 2 },
    db
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.selectedItemIds, ["other-ok"]);
  assert.equal(preview.exclusionCounts?.sameBuyerPriorDelivery, 1);
  assert.equal(preview.exclusionCounts?.notBuyerReady, 0);
  assert.equal(preview.shortfallQuantity, 1);
});

test("J: tenant isolation remains intact — prior delivery is buyer-scoped", async () => {
  const sharedPhone = "+15554006001";
  const sharedEmail = "shared-identity@example.test";
  const shared = makeItem({
    id: "shared-identity",
    evaluatedAt: EVALUATED_AT,
    phone: sharedPhone,
    email: sharedEmail,
  });
  const fingerprints = [
    {
      phone: fingerprintIdentityValue("phone", sharedPhone),
      email: fingerprintIdentityValue("email", sharedEmail),
    },
  ];

  const buyerA = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt: EVALUATED_AT,
      targetEligible: 5,
    },
    buildInventoryFakeDb([shared], {
      clientAccountId: "client_a",
      priorFingerprints: fingerprints,
    }).db
  );
  assert.deepEqual(
    buyerA.candidates.map((row) => row.item.id),
    []
  );
  assert.equal(buyerA.exclusionCounts.sameBuyerPriorDelivery, 1);

  const buyerB = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_b",
      exclusions: [],
      evaluatedAt: EVALUATED_AT,
      targetEligible: 5,
    },
    buildInventoryFakeDb([shared], {
      clientAccountId: "client_b",
      priorFingerprints: [],
    }).db
  );
  assert.deepEqual(
    buyerB.candidates.map((row) => row.item.id),
    ["shared-identity"]
  );
  assert.equal(buyerB.exclusionCounts.sameBuyerPriorDelivery, 0);
});
