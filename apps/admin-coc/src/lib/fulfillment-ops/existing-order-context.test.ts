import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  authoritativeOrderQuantity,
  formatFulfillmentOpsOrderOption,
  fulfillmentOpsClientLabel,
  resolveStage2bCommerceAgeBucketKeys,
} from "./existing-order-context.ts";
import type { PplPricingCatalog } from "./ppl-pricing-catalog.ts";
import type { FulfillmentOpsOrder } from "./types.ts";

const catalog: PplPricingCatalog = {
  pricingVersion: "ppl_aged_beta_2026_08_v1",
  activeAgedBuckets: [
    {
      key: "COMMERCE_3_6_MO",
      label: "3–6 Months",
      minDaysInclusive: 90,
      maxDaysExclusive: 180,
      unitPriceCents: 4200,
      status: "active",
    },
    {
      key: "COMMERCE_9_12_MO",
      label: "9–12 Months",
      minDaysInclusive: 270,
      maxDaysExclusive: 365,
      unitPriceCents: 200,
      status: "active",
    },
  ],
  holdBuckets: [],
};

function order(overrides: Partial<FulfillmentOpsOrder> = {}): FulfillmentOpsOrder {
  return {
    id: "ord_1",
    orderNumber: "LO-2050",
    clientAccountId: "client_a",
    clientDisplayName: "Valley Vet",
    status: "active",
    nicheKey: "VET",
    productType: null,
    states: ["NC"],
    leadVolume: 50,
    requestedQuantity: 50,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    remainingCapacity: 3,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    activatedAt: "2026-08-31T00:00:00.000Z",
    allocationReady: true,
    allocationBlockers: [],
    pricing: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("authoritativeOrderQuantity", () => {
  it("uses pricing.requestedQuantity, then requestedQuantity, then leadVolume", () => {
    assert.equal(
      authoritativeOrderQuantity(
        order({
          pricing: {
            commerceAgeBucketKey: "COMMERCE_9_12_MO",
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            unitPriceCents: 200,
            lineTotalCents: 20000,
            requestedQuantity: 100,
            label: "9–12 Months",
          },
          requestedQuantity: 50,
          leadVolume: 1,
        })
      ),
      100
    );
    assert.equal(authoritativeOrderQuantity(order({ requestedQuantity: 50, leadVolume: 1 })), 50);
    assert.equal(authoritativeOrderQuantity(order({ requestedQuantity: null, leadVolume: 50 })), 50);
  });

  it("does not use remainingCapacity", () => {
    assert.equal(
      authoritativeOrderQuantity(order({ requestedQuantity: 50, remainingCapacity: 3, leadVolume: 50 })),
      50
    );
  });
});

describe("fulfillment ops order identity", () => {
  it("formats order options with client display name", () => {
    assert.equal(
      formatFulfillmentOpsOrderOption(order()),
      "LO-2050 — Valley Vet — VET — active"
    );
  });

  it("falls back to Unnamed client when display name is absent", () => {
    assert.equal(fulfillmentOpsClientLabel({ clientDisplayName: null }), "Unnamed client");
    assert.equal(fulfillmentOpsClientLabel({ clientDisplayName: "   " }), "Unnamed client");
    assert.equal(
      formatFulfillmentOpsOrderOption(order({ clientDisplayName: null, orderNumber: "LO-1" })),
      "LO-1 — Unnamed client — VET — active"
    );
  });
});

describe("resolveStage2bCommerceAgeBucketKeys", () => {
  it("locks priced orders to the priced bucket", () => {
    const priced = order({
      pricing: {
        commerceAgeBucketKey: "COMMERCE_9_12_MO",
        pricingVersion: "ppl_aged_beta_2026_08_v1",
        unitPriceCents: 200,
        lineTotalCents: 200,
        requestedQuantity: 1,
        label: "9–12 Months",
      },
    });
    assert.deepEqual(
      resolveStage2bCommerceAgeBucketKeys(priced, "COMMERCE_3_6_MO", catalog),
      ["COMMERCE_9_12_MO"]
    );
    assert.deepEqual(resolveStage2bCommerceAgeBucketKeys(priced, "", null), ["COMMERCE_9_12_MO"]);
  });

  it("does not default unpriced orders to all five buckets", () => {
    const unpriced = order({ pricing: null });
    assert.equal(resolveStage2bCommerceAgeBucketKeys(unpriced, "", catalog), null);
    assert.equal(
      resolveStage2bCommerceAgeBucketKeys(
        unpriced,
        "COMMERCE_1_3_MO,COMMERCE_3_6_MO,COMMERCE_6_9_MO,COMMERCE_9_12_MO,COMMERCE_12_MO_PLUS",
        catalog
      ),
      null
    );
    assert.deepEqual(resolveStage2bCommerceAgeBucketKeys(unpriced, "COMMERCE_3_6_MO", catalog), [
      "COMMERCE_3_6_MO",
    ]);
  });

  it("rejects a bucket that is not a selectable catalog key", () => {
    assert.equal(resolveStage2bCommerceAgeBucketKeys(order(), "FRESH", catalog), null);
    assert.equal(resolveStage2bCommerceAgeBucketKeys(order(), "COMMERCE_3_6_MO", null), null);
  });
});

describe("workbench source guards", () => {
  it("does not hard-code an all-five Stage 2b bucket default", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const workbench = readFileSync(
      join(here, "../../components/fulfillment-ops/fulfillment-ops-workbench.tsx"),
      "utf8"
    );
    assert.doesNotMatch(
      workbench,
      /COMMERCE_1_3_MO,COMMERCE_3_6_MO,COMMERCE_6_9_MO,COMMERCE_9_12_MO,COMMERCE_12_MO_PLUS/
    );
  });
});
