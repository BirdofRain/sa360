import assert from "node:assert/strict";
import { test } from "node:test";

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
            if (by[0] === "normalizedState") return [];
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
