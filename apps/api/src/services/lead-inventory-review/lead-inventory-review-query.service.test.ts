import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateCommittedBatchStatusCounts,
  buildLeadInventoryReviewSummary,
  REVIEW_SUMMARY_BATCH_LIMIT,
  REVIEW_SUMMARY_PENDING_ID_LIMIT,
} from "./lead-inventory-review-query.service.js";

type CallLog = Array<{ model: string; method: string; args?: unknown }>;

function createTrackingDb(opts: {
  statusGroups?: Array<{ status: string; _count: { _all: number } }>;
  pendingIds?: string[];
  batches?: Array<{
    requestId: string;
    lotKey: string | null;
    sourceLane: string;
    inventoryLotId: string | null;
    createdAt: Date;
    committedAt: Date | null;
  }>;
  lotStatusGroups?: Array<{
    inventoryLotId: string;
    status: string;
    _count: { _all: number };
  }>;
  metadataStatusGroupsByRequestId?: Record<
    string,
    Array<{ status: string; _count: { _all: number } }>
  >;
  stateGroups?: Array<{
    normalizedState: string;
    status: string;
    _count: { _all: number };
  }>;
  sourceLaneGroups?: Array<{
    sourceLane: string;
    status: string;
    _count: { _all: number };
  }>;
  pendingIdsByLot?: Record<string, string[]>;
}) {
  const calls: CallLog = [];
  const batches = opts.batches ?? [];

  const db = {
    leadInventoryItem: {
      groupBy: async (args: {
        by: string[];
        where?: { inventoryLotId?: { in: string[] }; metadataJson?: unknown };
      }) => {
        calls.push({ model: "leadInventoryItem", method: "groupBy", args });
        if (args.by.length === 1 && args.by[0] === "status") {
          if (args.where && "metadataJson" in (args.where as object)) {
            const pathEquals = (args.where as { metadataJson?: { equals?: string } }).metadataJson
              ?.equals;
            return opts.metadataStatusGroupsByRequestId?.[String(pathEquals)] ?? [];
          }
          return opts.statusGroups ?? [];
        }
        if (args.by[0] === "inventoryLotId" && args.by[1] === "status") {
          const allowed = new Set(args.where?.inventoryLotId?.in ?? []);
          return (opts.lotStatusGroups ?? []).filter((row) => allowed.has(row.inventoryLotId));
        }
        if (args.by[0] === "normalizedState") return opts.stateGroups ?? [];
        if (args.by[0] === "sourceLane") return opts.sourceLaneGroups ?? [];
        return [];
      },
      findMany: async (args: {
        where?: { status?: string; inventoryLotId?: string; id?: { in: string[] } };
        select?: { id?: boolean; status?: boolean };
        take?: number;
      }) => {
        calls.push({ model: "leadInventoryItem", method: "findMany", args });
        // Detect legacy per-batch status scans (id+status without pending filter).
        if (args.select?.status === true && args.select?.id === true) {
          throw new Error("unexpected_per_batch_status_findMany_scan");
        }
        if (args.where?.status === "pending_review" && args.where.inventoryLotId) {
          const ids = opts.pendingIdsByLot?.[args.where.inventoryLotId] ?? [];
          return ids.slice(0, args.take ?? REVIEW_SUMMARY_PENDING_ID_LIMIT).map((id) => ({ id }));
        }
        if (args.where?.status === "pending_review") {
          return (opts.pendingIds ?? [])
            .slice(0, args.take ?? REVIEW_SUMMARY_PENDING_ID_LIMIT)
            .map((id) => ({ id }));
        }
        return [];
      },
    },
    leadInventoryImportBatch: {
      findMany: async (args: { take?: number; orderBy?: unknown; where?: unknown }) => {
        calls.push({ model: "leadInventoryImportBatch", method: "findMany", args });
        assert.equal(args.take, REVIEW_SUMMARY_BATCH_LIMIT);
        return batches;
      },
    },
  };

  return { db, calls };
}

function withReviewFlag<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = enabled ? "true" : "false";
  return fn().finally(() => {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  });
}

const twoCommittedBatches = [
  {
    requestId: "batch_a",
    lotKey: "lot-a",
    sourceLane: "aged_csv",
    inventoryLotId: "lot_1",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    committedAt: new Date("2026-07-02T00:00:00.000Z"),
  },
  {
    requestId: "batch_b",
    lotKey: "lot-b",
    sourceLane: "aged_csv",
    inventoryLotId: "lot_2",
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    committedAt: new Date("2026-07-04T00:00:00.000Z"),
  },
];

test("disabled review summary is lightweight and skips expensive work", async () => {
  await withReviewFlag(false, async () => {
    const { db, calls } = createTrackingDb({
      statusGroups: [
        { status: "available", _count: { _all: 10 } },
        { status: "pending_review", _count: { _all: 3 } },
      ],
      batches: twoCommittedBatches,
    });
    let eligibilityCalls = 0;
    const summary = await buildLeadInventoryReviewSummary(db as never, {
      eligibilityLoader: async () => {
        eligibilityCalls += 1;
        return { ageBands: [], results: [], evaluatedAt: new Date() };
      },
    });

    assert.equal(summary.featureSkipped, true);
    assert.equal(summary.counts.pendingReview, 3);
    assert.equal(summary.counts.eligibleNow, 0);
    assert.equal(summary.counts.blocked, 0);
    assert.equal(summary.counts.available, 10);
    assert.deepEqual(summary.byState, []);
    assert.deepEqual(summary.bySourceLane, []);
    assert.deepEqual(summary.batches, []);
    assert.equal(eligibilityCalls, 0);
    assert.equal(calls.filter((c) => c.method === "groupBy").length, 1);
    assert.equal(
      calls.filter((c) => c.model === "leadInventoryImportBatch").length,
      0
    );
    assert.ok(!calls.some((c) => c.method === "findMany"));
  });
});

test("bootstrap detail with zero pending uses aggregate batch counts and skips breakdowns", async () => {
  await withReviewFlag(true, async () => {
    const { db, calls } = createTrackingDb({
      statusGroups: [
        { status: "available", _count: { _all: 243_056 } },
        { status: "pending_review", _count: { _all: 0 } },
      ],
      batches: twoCommittedBatches,
      lotStatusGroups: [
        { inventoryLotId: "lot_1", status: "available", _count: { _all: 100_000 } },
        { inventoryLotId: "lot_1", status: "quarantined", _count: { _all: 2 } },
        { inventoryLotId: "lot_2", status: "available", _count: { _all: 143_056 } },
      ],
      stateGroups: [{ normalizedState: "TX", status: "available", _count: { _all: 1 } }],
      sourceLaneGroups: [{ sourceLane: "aged_csv", status: "available", _count: { _all: 1 } }],
    });

    let eligibilityCalls = 0;
    const summary = await buildLeadInventoryReviewSummary(db as never, {
      detail: "bootstrap",
      eligibilityLoader: async () => {
        eligibilityCalls += 1;
        return { ageBands: [], results: [], evaluatedAt: new Date() };
      },
    });

    assert.equal("featureSkipped" in summary, false);
    assert.equal(summary.counts.pendingReview, 0);
    assert.equal(summary.counts.eligibleNow, 0);
    assert.equal(summary.counts.blocked, 0);
    assert.equal(summary.counts.available, 243_056);
    assert.deepEqual(summary.byState, []);
    assert.deepEqual(summary.bySourceLane, []);
    assert.equal(eligibilityCalls, 0);

    assert.equal(summary.batches.length, 2);
    assert.equal(summary.batches[0]!.requestId, "batch_a");
    assert.equal(summary.batches[0]!.imported, 100_002);
    assert.equal(summary.batches[0]!.available, 100_000);
    assert.equal(summary.batches[0]!.quarantined, 2);
    assert.equal(summary.batches[0]!.pending, 0);
    assert.equal(summary.batches[0]!.eligible, 0);
    assert.equal(summary.batches[1]!.imported, 143_056);
    assert.equal(summary.batches[1]!.available, 143_056);

    // No pending ID lookup when pending_review status count is zero.
    assert.ok(
      !calls.some(
        (c) =>
          c.method === "findMany" &&
          (c.args as { where?: { status?: string } })?.where?.status === "pending_review"
      )
    );
    // One lot×status aggregate — not per-batch findMany scans.
    const lotAggregates = calls.filter(
      (c) =>
        c.method === "groupBy" &&
        Array.isArray((c.args as { by?: string[] })?.by) &&
        (c.args as { by: string[] }).by[0] === "inventoryLotId"
    );
    assert.equal(lotAggregates.length, 1);
    assert.ok(!calls.some((c) => c.method === "findMany" && (c.args as { select?: { status?: boolean } })?.select?.status));

    const groupBys = calls.filter((c) => c.method === "groupBy");
    // status + lot×status only (no state/sourceLane in bootstrap)
    assert.equal(groupBys.length, 2);
    assert.ok(!groupBys.some((c) => (c.args as { by: string[] }).by[0] === "normalizedState"));
    assert.ok(!groupBys.some((c) => (c.args as { by: string[] }).by[0] === "sourceLane"));
  });
});

test("full detail with zero pending still returns breakdowns and aggregated batches", async () => {
  await withReviewFlag(true, async () => {
    const { db, calls } = createTrackingDb({
      statusGroups: [
        { status: "available", _count: { _all: 10 } },
        { status: "pending_review", _count: { _all: 0 } },
      ],
      batches: twoCommittedBatches,
      lotStatusGroups: [
        { inventoryLotId: "lot_1", status: "available", _count: { _all: 4 } },
        { inventoryLotId: "lot_2", status: "available", _count: { _all: 6 } },
      ],
      stateGroups: [{ normalizedState: "FL", status: "available", _count: { _all: 10 } }],
      sourceLaneGroups: [{ sourceLane: "aged_csv", status: "available", _count: { _all: 10 } }],
    });

    const summary = await buildLeadInventoryReviewSummary(db as never, {
      detail: "full",
      eligibilityLoader: async () => {
        throw new Error("eligibility_should_not_run");
      },
    });

    assert.equal(summary.byState.length, 1);
    assert.equal(summary.byState[0]!.normalizedState, "FL");
    assert.equal(summary.bySourceLane.length, 1);
    assert.equal(summary.batches[0]!.imported, 4);
    assert.equal(summary.batches[1]!.imported, 6);
    assert.ok(
      calls.some(
        (c) => c.method === "groupBy" && (c.args as { by: string[] }).by[0] === "normalizedState"
      )
    );
  });
});

test("enabled non-empty pending evaluates eligibility without per-batch row scans", async () => {
  await withReviewFlag(true, async () => {
    const { db, calls } = createTrackingDb({
      statusGroups: [
        { status: "available", _count: { _all: 5 } },
        { status: "pending_review", _count: { _all: 2 } },
      ],
      pendingIds: ["p1", "p2"],
      batches: [twoCommittedBatches[0]!],
      lotStatusGroups: [
        { inventoryLotId: "lot_1", status: "available", _count: { _all: 5 } },
        { inventoryLotId: "lot_1", status: "pending_review", _count: { _all: 2 } },
      ],
      pendingIdsByLot: { lot_1: ["p1", "p2"] },
    });

    const eligibilityCalls: string[][] = [];
    const summary = await buildLeadInventoryReviewSummary(db as never, {
      detail: "bootstrap",
      eligibilityLoader: (async (ids: string[]) => {
        eligibilityCalls.push([...ids]);
        return {
          ageBands: [],
          evaluatedAt: new Date(),
          results: ids.map((id, index) => ({
            itemId: id,
            found: true as const,
            item: { id } as never,
            eligibility: {
              inventoryItemId: id,
              eligible: index === 0,
              blockerCodes: index === 0 ? [] : (["missing_required_provenance"] as never[]),
              warnings: [],
              currentStatus: "pending_review",
              allowedActions: ["make_available", "quarantine", "reject"] as const,
              ageDays: 30,
              ageBandKey: "30_90",
              sourceLane: "aged_csv",
              sourceProvider: "csv",
              normalizedState: "TX",
              proofStatus: "NONE",
              verificationStatus: "UNCHECKED",
              duplicateStatus: "UNCHECKED",
              provenance: {
                hasLot: true,
                hasSourceEvent: true,
                hasImportRequestId: true,
                hasGeneratedAt: true,
              },
              duplicateSummary: { status: "UNCHECKED", safe: true },
              identitySummary: {
                present: true,
                hasPhoneOrEmail: true,
                verificationPassed: false,
              },
              allocationConflict: false,
              deliveryHistoryPresent: false,
            },
          })),
        };
      }) as never,
    });

    assert.equal(summary.counts.pendingReview, 2);
    assert.equal(summary.counts.eligibleNow, 1);
    assert.equal(summary.counts.blocked, 1);
    assert.equal(summary.batches[0]!.pending, 2);
    assert.equal(summary.batches[0]!.eligible, 1);
    assert.equal(summary.batches[0]!.blocked, 1);
    // Global pending + batch pending ID lookups only (id select), never status row scans.
    assert.equal(eligibilityCalls.length, 2);
    assert.deepEqual(eligibilityCalls[0], ["p1", "p2"]);
    assert.ok(!calls.some((c) => (c.args as { select?: { status?: boolean } })?.select?.status));
  });
});

test("aggregateCommittedBatchStatusCounts uses one lot groupBy for lot-backed batches", async () => {
  const { db, calls } = createTrackingDb({
    lotStatusGroups: [
      { inventoryLotId: "lot_1", status: "available", _count: { _all: 3 } },
      { inventoryLotId: "lot_1", status: "rejected", _count: { _all: 1 } },
      { inventoryLotId: "lot_2", status: "available", _count: { _all: 9 } },
    ],
  });

  const map = await aggregateCommittedBatchStatusCounts(db as never, twoCommittedBatches);
  assert.equal(map.get("batch_a")?.imported, 4);
  assert.equal(map.get("batch_a")?.available, 3);
  assert.equal(map.get("batch_a")?.rejected, 1);
  assert.equal(map.get("batch_b")?.imported, 9);
  assert.equal(
    calls.filter((c) => c.method === "groupBy" && (c.args as { by: string[] }).by[0] === "inventoryLotId")
      .length,
    1
  );
});

test("metadata-only batches use status groupBy instead of findMany row scans", async () => {
  const { db, calls } = createTrackingDb({
    metadataStatusGroupsByRequestId: {
      batch_meta: [
        { status: "available", _count: { _all: 7 } },
        { status: "pending_review", _count: { _all: 1 } },
      ],
    },
  });

  const map = await aggregateCommittedBatchStatusCounts(db as never, [
    {
      requestId: "batch_meta",
      inventoryLotId: null,
    },
  ]);
  assert.equal(map.get("batch_meta")?.imported, 8);
  assert.equal(map.get("batch_meta")?.pending, 1);
  assert.ok(!calls.some((c) => c.method === "findMany"));
  assert.equal(calls.filter((c) => c.method === "groupBy").length, 1);
});

test("abort signal stops review summary before expensive work", async () => {
  await withReviewFlag(true, async () => {
    const { db } = createTrackingDb({
      statusGroups: [{ status: "available", _count: { _all: 1 } }],
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => buildLeadInventoryReviewSummary(db as never, { signal: controller.signal, detail: "bootstrap" }),
      (err: Error) => err.name === "AbortError"
    );
  });
});
