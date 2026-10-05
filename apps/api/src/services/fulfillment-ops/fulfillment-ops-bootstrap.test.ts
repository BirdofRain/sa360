import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_US_STATE_CODES } from "@sa360/shared";

import {
  buildFulfillmentOpsBootstrap,
  FULFILLMENT_OPS_BOOTSTRAP_INVENTORY_TIMEOUT_MS,
} from "./fulfillment-ops.service.js";

function createBootstrapPrismaMock(opts?: { hangInventory?: boolean }) {
  const hang = async () => {
    await new Promise(() => {
      /* never resolves */
    });
  };

  return {
    leadInventoryItem: {
      count: async () => 0,
      groupBy: opts?.hangInventory
        ? hang
        : async ({ by }: { by: string[] }) => {
            if (by[0] === "status") return [];
            if (by[0] === "nicheKey") return [];
            if (by[0] === "normalizedState") {
              return [
                { normalizedState: "NC", _count: { _all: 4 } },
                { normalizedState: "South Columbia", _count: { _all: 2 } },
              ];
            }
            return [];
          },
      findMany: async () => [],
    },
    inventoryLot: {
      groupBy: async () => [],
    },
    leadProof: { findMany: async () => [] },
    leadVerificationResult: { findMany: async () => [] },
    leadAgeBandDefinition: { findMany: async () => [] },
    leadInventoryImportBatch: { findMany: async () => [] },
    leadOrder: { findUnique: async () => null, findFirst: async () => null },
    leadAllocation: { findFirst: async () => null },
  };
}

test("bootstrap succeeds with inventory review disabled and empty inventory", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "false";
  try {
    const data = await buildFulfillmentOpsBootstrap(undefined, createBootstrapPrismaMock() as never);
    assert.equal(data.ok, true);
    assert.equal(data.safety.inventoryReviewEnabled, false);
    assert.equal(data.safety.liveDeliveryEnabled, false);
    assert.equal(data.inventory.review.featureEnabled, false);
    assert.equal(data.inventory.summary?.totalItems, 0);
    assert.equal(data.partial, false);
    assert.deepEqual(data.unavailableSections, []);
    assert.deepEqual(data.inventory.stateDistribution, [{ state: "NC", count: 4 }]);
    assert.equal(data.inventory.invalidStateReviewCount, 2);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("bootstrap returns partial structured data when inventory dependency times out", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "false";
  // Force a very small timeout via env-independent race: hang groupBy used by counts.
  const originalTimeout = FULFILLMENT_OPS_BOOTSTRAP_INVENTORY_TIMEOUT_MS;
  assert.ok(originalTimeout > 0);

  try {
    const hangDb = createBootstrapPrismaMock({ hangInventory: true });
    // Override count path used first in summary to hang immediately.
    hangDb.leadInventoryItem.count = async () => {
      await new Promise(() => {
        /* hang */
      });
      return 0;
    };

    const started = Date.now();
    const data = await buildFulfillmentOpsBootstrap(undefined, hangDb as never);
    const elapsed = Date.now() - started;
    assert.equal(data.ok, true);
    assert.equal(data.partial, true);
    assert.ok(data.unavailableSections.some((s) => s.section === "inventory"));
    assert.equal(data.inventory.summary, null);
    // Independent dependencies run in parallel with hard caps — wall clock ≈ max timeout, not unbounded.
    assert.ok(elapsed < originalTimeout + 3_000);
    assert.ok(
      data.unavailableSections.every((s) => s.code === "dependency_timeout" || s.code === "dependency_aborted")
    );
    // Safety still present — never HTML / crash.
    assert.equal(data.safety.simulationOnly, true);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("bootstrap request cancellation stops optional inventory work", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "false";
  const controller = new AbortController();
  controller.abort();
  try {
    const data = await buildFulfillmentOpsBootstrap(undefined, createBootstrapPrismaMock() as never, {
      signal: controller.signal,
      requestId: "cancel-test",
    });
    assert.equal(data.ok, true);
    assert.equal(data.partial, true);
    assert.ok(data.unavailableSections.length >= 1);
    assert.equal(data.diagnostics?.requestId, "cancel-test");
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("bootstrap state distribution returns all 51 canonical codes and drops none", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "false";
  assert.equal(CANONICAL_US_STATE_CODES.length, 51);
  const db = createBootstrapPrismaMock();
  db.leadInventoryItem.groupBy = async ({ by }: { by: string[] }) => {
    if (by[0] === "status") return [];
    if (by[0] === "nicheKey") return [];
    if (by[0] === "normalizedState") {
      const rows = [...CANONICAL_US_STATE_CODES].reverse().map((state, index) => ({
        normalizedState: state,
        _count: { _all: index + 1 },
      }));
      const dc = rows.find((row) => row.normalizedState === "DC");
      if (dc) dc._count._all = 99;
      return [...rows, { normalizedState: "South Columbia", _count: { _all: 7 } }];
    }
    return [];
  };
  try {
    const data = await buildFulfillmentOpsBootstrap(undefined, db as never);
    assert.equal(data.ok, true);
    const states = data.inventory.stateDistribution.map((row) => row.state);
    assert.equal(states.length, 51);
    assert.deepEqual(states, [...CANONICAL_US_STATE_CODES]);
    assert.ok(states.includes("DC"));
    assert.ok(states.includes("WY"));
    assert.equal(
      data.inventory.stateDistribution.some((row) => row.state === "South Columbia"),
      false
    );
    assert.equal(data.inventory.invalidStateReviewCount, 7);
    const dc = data.inventory.stateDistribution.find((row) => row.state === "DC");
    assert.equal(dc?.count, 99);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("bootstrap with review enabled returns optimized review section and stays ok", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "true";
  try {
    const data = await buildFulfillmentOpsBootstrap(undefined, createBootstrapPrismaMock() as never);
    assert.equal(data.ok, true);
    assert.equal(data.partial, false);
    assert.equal(data.safety.inventoryReviewEnabled, true);
    assert.equal(data.inventory.review.featureEnabled, true);
    assert.equal(data.inventory.review.counts?.pendingReview, 0);
    assert.equal(data.inventory.review.counts?.eligibleNow, 0);
    // Counts must remain present for Fulfillment Ops UI / safety posture.
    assert.ok(data.inventory.review.counts);
    assert.equal(data.safety.liveDeliveryEnabled, false);
    assert.equal(data.safety.simulationOnly, true);
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});

test("bootstrap niche distribution merges commerce aliases and keeps unsupported counts", async () => {
  const prev = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
  process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = "false";
  const raw = [
    { nicheKey: "vet", count: 10 },
    { nicheKey: "vet_fex", count: 5 },
    { nicheKey: "VET", count: 2 },
    { nicheKey: "n_vet", count: 1 },
    { nicheKey: "nurse", count: 4 },
    { nicheKey: "nurse_life", count: 3 },
    { nicheKey: "trucker", count: 6 },
    { nicheKey: "trucker_life", count: 1 },
    { nicheKey: "unspecified", count: 7 },
    { nicheKey: "mortgage_protection", count: 8 },
  ];
  const db = createBootstrapPrismaMock();
  db.leadInventoryItem.groupBy = (async ({ by }: { by: string[] }) => {
    if (by[0] === "nicheKey") {
      return raw.map((row) => ({ nicheKey: row.nicheKey, _count: { _all: row.count } }));
    }
    return [];
  }) as unknown as typeof db.leadInventoryItem.groupBy;
  try {
    const data = await buildFulfillmentOpsBootstrap(undefined, db as never);
    assert.equal(data.ok, true);
    const rows = data.inventory.nicheDistribution;
    assert.deepEqual(
      rows
        .filter((row) => !row.review)
        .map((row) => ({ nicheKey: row.nicheKey, count: row.count, label: row.label })),
      [
        { nicheKey: "vet", count: 18, label: "Veteran" },
        { nicheKey: "nurse", count: 7, label: "Nurse" },
        { nicheKey: "trucker", count: 7, label: "Trucker" },
      ]
    );
    assert.equal(
      rows.some((row) => row.nicheKey === "vet_fex" || row.nicheKey === "nurse_life"),
      false
    );
    const review = rows.filter((row) => row.review);
    assert.equal(
      rows.reduce((sum, row) => sum + row.count, 0),
      raw.reduce((sum, row) => sum + row.count, 0)
    );
    assert.ok(review.some((row) => row.nicheKey === "unspecified" && row.count === 7));
    assert.ok(review.some((row) => row.nicheKey === "mortgage_protection" && row.count === 8));
  } finally {
    if (prev === undefined) delete process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED;
    else process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED = prev;
  }
});
