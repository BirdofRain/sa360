import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  commitPplInventorySelection,
  isIncompleteCandidateSearch,
  previewPplInventorySelection,
  previewPplReplacementCandidate,
  queryEligibleInventoryCandidatesBounded,
  selectAndReservePplReplacementCandidate,
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
  ageDays: number;
  evaluatedAt: Date;
  phone: string;
  email: string;
  state?: string;
}): FakeItem {
  return {
    id: input.id,
    generatedAt: daysAgo(input.ageDays, input.evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: input.state ?? "NC",
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      normalizedPayloadJson: {
        contact: {
          first_name: "T",
          last_name: input.id,
          phone_e164: input.phone,
          email: input.email,
          state: input.state ?? "NC",
        },
      },
      enrichmentMetadataJson: {},
    },
  };
}

function buildInventoryFakeDb(allItems: FakeItem[]) {
  let findManyCalls = 0;
  let allocationCreates = 0;
  let transactionCalls = 0;

  const db = {
    buyerDeliveredIdentity: {
      findMany: async () => [],
    },
    protectedAgentExclusion: {
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
        clientAccountId: "client_a",
        requestedQuantity: 100,
        leadVolume: 100,
      }),
    },
    leadAllocation: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async () => {
        allocationCreates += 1;
        throw new Error("allocation_create_should_not_run");
      },
    },
    leadInventoryItem: {
      findMany: async (args: {
        where: Record<string, unknown>;
        take: number;
      }) => {
        findManyCalls += 1;
        const take = args.take;
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
                  const g = entry.generatedAt as { gt?: Date } | Date | undefined;
                  return g && typeof g === "object" && "gt" in g;
                });
                const eqGen = or.find((entry) => entry.id != null);
                if (gtGen || eqGen) {
                  const cursorGen =
                    (gtGen?.generatedAt as { gt?: Date } | undefined)?.gt ??
                    (eqGen?.generatedAt as Date | undefined);
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

        return rows.slice(0, take);
      },
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("transaction_should_not_run_on_scan_limit");
    },
  };

  return {
    db: db as unknown as PrismaClient,
    getFindManyCalls: () => findManyCalls,
    getAllocationCreates: () => allocationCreates,
    getTransactionCalls: () => transactionCalls,
  };
}

function buildEligibleItems(count: number, evaluatedAt: Date, prefix = "ok"): FakeItem[] {
  const items: FakeItem[] = [];
  for (let i = 0; i < count; i += 1) {
    items.push(
      makeItem({
        id: `${prefix}-${String(i).padStart(4, "0")}`,
        ageDays: 45,
        evaluatedAt,
        phone: `+1555200${String(i).padStart(4, "0")}`,
        email: `${prefix}${i}@example.test`,
      })
    );
  }
  return items;
}

function buildInvalidItems(count: number, evaluatedAt: Date): FakeItem[] {
  const items: FakeItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const item = makeItem({
      id: `bad-${i}`,
      ageDays: 45,
      evaluatedAt,
      phone: "",
      email: "",
    });
    item.sourceLeadEvent.normalizedPayloadJson = { contact: { state: "NC" } };
    items.push(item);
  }
  return items;
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

test("isIncompleteCandidateSearch distinguishes ceiling from satisfied request", () => {
  assert.equal(
    isIncompleteCandidateSearch({
      scanCeilingHit: true,
      selectedQuantity: 72,
      requestedQuantity: 100,
    }),
    true
  );
  assert.equal(
    isIncompleteCandidateSearch({
      scanCeilingHit: true,
      selectedQuantity: 100,
      requestedQuantity: 100,
    }),
    false
  );
  assert.equal(
    isIncompleteCandidateSearch({
      scanCeilingHit: false,
      selectedQuantity: 72,
      requestedQuantity: 100,
    }),
    false
  );
});

test("A: true DB exhaustion with partial eligible allows shortfall", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items = buildEligibleItems(72, evaluatedAt);
  const { db } = buildInventoryFakeDb(items);

  const result = await previewPplInventorySelection(
    {
      orderId: "order-partial",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 100,
    },
    db
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.selectedQuantity, 72);
  assert.equal(result.shortfallQuantity, 28);
  assert.equal(result.diagnostics?.scanCeilingHit, false);
  assert.equal(result.diagnostics?.selectionComplete, true);
});

test("B: scan ceiling with partial eligible is scan_limit_reached; commit writes nothing", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  // Older eligible first (FCFS), then enough younger invalid rows to hit the 5000 ceiling.
  const eligible = buildEligibleItems(72, evaluatedAt, "aa").map((item) => ({
    ...item,
    generatedAt: daysAgo(60, evaluatedAt),
  }));
  const invalid = buildInvalidItems(5100, evaluatedAt).map((item, index) => ({
    ...item,
    generatedAt: daysAgo(40, evaluatedAt),
    id: `zz-bad-${index}`,
  }));
  const ceilingDb = buildInventoryFakeDb([...eligible, ...invalid]);

  const ceilingPreview = await previewPplInventorySelection(
    {
      orderId: "order-ceiling-2",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 100,
    },
    ceilingDb.db
  );
  assert.equal(ceilingPreview.ok, false);
  if (ceilingPreview.ok) return;
  assert.equal(ceilingPreview.code, "scan_limit_reached");
  assert.deepEqual(ceilingPreview.reasons, ["candidate_scan_incomplete"]);
  assert.equal(ceilingPreview.shortfallQuantity, undefined);
  assert.equal(ceilingPreview.diagnostics?.scanCeilingHit, true);
  assert.equal(ceilingPreview.diagnostics?.selectionComplete, false);
  assert.equal(ceilingPreview.eligibleQuantity, 72);
  assert.ok((ceilingPreview.diagnostics?.rowsScanned ?? 0) >= 5000);

  const commit = await commitPplInventorySelection(
    {
      orderId: "order-ceiling-2",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 100,
      idempotencyKey: "ceil-batch-1",
    },
    ceilingDb.db
  );
  assert.equal(commit.ok, false);
  if (commit.ok) return;
  assert.equal(commit.code, "scan_limit_reached");
  assert.equal(ceilingDb.getTransactionCalls(), 0);
  assert.equal(ceilingDb.getAllocationCreates(), 0);
});

test("C: enough eligible before ceiling succeeds fully", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items = buildEligibleItems(130, evaluatedAt);
  const { db } = buildInventoryFakeDb(items);

  const result = await previewPplInventorySelection(
    {
      orderId: "order-full",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 100,
    },
    db
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.selectedQuantity, 100);
  assert.equal(result.shortfallQuantity, 0);
  assert.equal(result.diagnostics?.scanCeilingHit, false);
  assert.equal(result.diagnostics?.selectionComplete, true);
});

test("D: zero eligible with DB exhausted returns no_inventory", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items = buildInvalidItems(10, evaluatedAt);
  const { db } = buildInventoryFakeDb(items);

  const result = await previewPplInventorySelection(
    {
      orderId: "order-empty",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 100,
    },
    db
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "no_inventory");
  assert.equal(result.diagnostics?.scanCeilingHit, false);
  assert.equal(result.diagnostics?.selectionComplete, true);
});

test("E: zero eligible with scan ceiling returns scan_limit_reached", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items = buildInvalidItems(5100, evaluatedAt);
  const { db } = buildInventoryFakeDb(items);

  const result = await previewPplInventorySelection(
    {
      orderId: "order-empty-ceiling",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 100,
    },
    db
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "scan_limit_reached");
  assert.equal(result.diagnostics?.scanCeilingHit, true);
  assert.equal(result.eligibleQuantity, 0);
});

test("F: replacement shortage when DB exhausted", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items = buildInvalidItems(5, evaluatedAt);
  const { db } = buildInventoryFakeDb(items);

  const result = await previewPplReplacementCandidate(
    {
      orderId: "order-replace-shortage",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
    },
    db
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "shortage");
  assert.equal(result.diagnostics?.scanCeilingHit, false);
});

test("G: replacement scan ceiling is scan_limit_reached not shortage", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items = buildInvalidItems(5100, evaluatedAt);
  const { db, getTransactionCalls } = buildInventoryFakeDb(items);

  const preview = await previewPplReplacementCandidate(
    {
      orderId: "order-replace-ceiling",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
    },
    db
  );
  assert.equal(preview.ok, false);
  if (preview.ok) return;
  assert.equal(preview.code, "scan_limit_reached");

  const reserve = await selectAndReservePplReplacementCandidate(
    {
      orderId: "order-replace-ceiling",
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      idempotencyKey: "replace-ceil-1",
    },
    db
  );
  assert.equal(reserve.ok, false);
  if (reserve.ok) return;
  assert.equal(reserve.code, "scan_limit_reached");
  assert.equal(getTransactionCalls(), 0);
});

test("short final page at scan budget is DB exhaustion not ceiling", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  // Exactly 100 invalid rows, pageSize 40, max 100 → last page short or exact end.
  const items = buildInvalidItems(90, evaluatedAt);
  const { db } = buildInventoryFakeDb(items);
  const result = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 50,
      pageSize: 40,
      maxScannedRows: 100,
    },
    db
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.scanCeilingHit, false);
  assert.equal(result.rowsScanned, 90);
});
