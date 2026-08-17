import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadFulfillmentOverviewCounts,
  loadInventoryLifecycleAggregates,
} from "./inventory-lifecycle-aggregates.service.js";

describe("inventory lifecycle aggregates", () => {
  it("uses SQL count queries and never materializes inventory rows", async () => {
    const calls: Array<{ where?: unknown }> = [];
    const db = {
      leadInventoryItem: {
        count: async (args?: { where?: unknown }) => {
          calls.push(args ?? {});
          return 7;
        },
        findMany: async () => {
          throw new Error("findMany must not be used for overview aggregates");
        },
      },
    };

    const result = await loadInventoryLifecycleAggregates(db as never, new Date("2026-08-17T00:00:00.000Z"));
    assert.equal(result.metrics.length, 6);
    assert.ok(result.metrics.every((metric) => metric.queryShape.maxResultCardinality === 1));
    assert.ok(result.metrics.every((metric) => metric.queryShape.jsonCorpusScan === false));
    assert.ok(result.metrics.every((metric) => metric.queryShape.nodeMaterializesInventoryRows === false));
    assert.ok(result.metrics.every((metric) => metric.queryShape.queryType === "count"));
    assert.equal(calls.length, 6);
    assert.equal(result.metrics.find((row) => row.key === "inventoryTracked")?.value, 7);
  });

  it("marks a failed inventory count unavailable instead of fake 0", async () => {
    const db = {
      leadInventoryItem: {
        count: async (args?: { where?: unknown }) => {
          if (args?.where) throw new Error("range_failed");
          return 12;
        },
      },
    };
    const result = await loadInventoryLifecycleAggregates(db as never);
    const tracked = result.metrics.find((row) => row.key === "inventoryTracked");
    const fresh = result.metrics.find((row) => row.key === "freshHold");
    assert.equal(tracked?.value, 12);
    assert.equal(fresh?.availability, "unavailable");
    assert.equal(fresh?.value, null);
  });

  it("counts delivered identities and leaves delivery failures not wired", async () => {
    const db = {
      leadOrder: { count: async () => 3 },
      buyerDeliveredIdentity: { count: async () => 11 },
      leadDeliveryExportPackage: { count: async () => 99 },
    };
    const result = await loadFulfillmentOverviewCounts(db as never);
    assert.equal(result.activePricedOrders.value, 3);
    assert.equal(result.deliveredLeads.value, 11);
    assert.equal(result.deliveredLeads.label, "Buyer deliveries");
    assert.equal(result.deliveryFailures.availability, "not_wired");
    assert.equal(result.deliveryFailures.value, null);
  });
});
