import assert from "node:assert/strict";
import test from "node:test";

import { resolveExportAllocationPricing } from "./ppl-order-pricing.js";

const line = (id: string, bucket: "COMMERCE_1_3_MO" | "COMMERCE_3_6_MO", quantity: number, status = "active") => ({
  id,
  lineNumber: bucket === "COMMERCE_1_3_MO" ? 1 : 2,
  status,
  requestedQuantity: quantity,
  unitPriceCents: bucket === "COMMERCE_1_3_MO" ? 600 : 400,
  lineTotalCents: quantity * (bucket === "COMMERCE_1_3_MO" ? 600 : 400),
  nicheKey: "vet",
  metadataJson: {
    schema: "ppl_order_line_pricing_v1",
    pricingVersion: "ppl_aged_beta_2026_08_v1",
    commerceAgeBucketKey: bucket,
    unitPriceCents: bucket === "COMMERCE_1_3_MO" ? 600 : 400,
  },
  ageBandKeysJson: [bucket],
});

test("a legacy single line prices every allocation, including rows without a line id", () => {
  const priced = resolveExportAllocationPricing(
    [line("ln_1", "COMMERCE_1_3_MO", 2)],
    [
      { id: "alloc_a", leadOrderLineId: null },
      { id: "alloc_b", leadOrderLineId: "ln_1" },
    ]
  );
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  assert.equal(priced.pricing.mode, "single_line");
  assert.equal(priced.pricing.unitPriceCents, 600);
  assert.equal(priced.pricing.commerceAgeBucketKey, "COMMERCE_1_3_MO");
  assert.equal(priced.pricing.requestedTotalCents, 1200);
  assert.equal(priced.pricing.exportedTotalCents, 1200);
  assert.deepEqual(
    priced.pricing.allocations.map((row) => row.unitPriceCents),
    [600, 600]
  );
});

test("multi-line export prices each allocation from its own line and reconciles totals", () => {
  const priced = resolveExportAllocationPricing(
    [line("ln_1", "COMMERCE_1_3_MO", 2), line("ln_2", "COMMERCE_3_6_MO", 3)],
    [
      { id: "alloc_a", leadOrderLineId: "ln_1" },
      { id: "alloc_b", leadOrderLineId: "ln_1" },
      { id: "alloc_c", leadOrderLineId: "ln_2" },
    ]
  );
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  assert.equal(priced.pricing.mode, "multi_line");
  assert.equal(priced.pricing.unitPriceCents, null);
  assert.equal(priced.pricing.commerceAgeBucketKey, null);
  assert.equal(priced.pricing.requestedQuantity, 5);
  assert.equal(priced.pricing.requestedTotalCents, 2400);
  assert.equal(priced.pricing.exportedTotalCents, 1600);
  assert.deepEqual(
    priced.pricing.allocations.map((row) => [row.leadOrderLineId, row.unitPriceCents, row.commerceAgeBucketKey]),
    [
      ["ln_1", 600, "COMMERCE_1_3_MO"],
      ["ln_1", 600, "COMMERCE_1_3_MO"],
      ["ln_2", 400, "COMMERCE_3_6_MO"],
    ]
  );
  assert.equal(
    priced.pricing.lines.reduce((sum, row) => sum + row.exportedTotalCents, 0),
    priced.pricing.exportedTotalCents
  );
});

test("a multi-line allocation without a valid line fails closed", () => {
  const lines = [line("ln_1", "COMMERCE_1_3_MO", 2), line("ln_2", "COMMERCE_3_6_MO", 1)];
  const missing = resolveExportAllocationPricing(lines, [{ id: "alloc_a", leadOrderLineId: null }]);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "export_line_required");

  const unknown = resolveExportAllocationPricing(lines, [{ id: "alloc_b", leadOrderLineId: "ln_missing" }]);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "export_line_not_found");

  const canceled = resolveExportAllocationPricing(
    [line("ln_1", "COMMERCE_1_3_MO", 2), { ...line("ln_2", "COMMERCE_3_6_MO", 1), status: "canceled" }],
    [{ id: "alloc_c", leadOrderLineId: "ln_2" }]
  );
  assert.equal(canceled.ok, false);
  if (!canceled.ok) assert.equal(canceled.code, "export_line_canceled");
});

test("a stored line total that does not match quantity times price is rejected", () => {
  const broken = line("ln_1", "COMMERCE_1_3_MO", 2);
  broken.lineTotalCents = 999;
  const priced = resolveExportAllocationPricing([broken], [{ id: "alloc_a", leadOrderLineId: "ln_1" }]);
  assert.equal(priced.ok, false);
  if (!priced.ok) assert.equal(priced.code, "export_line_total_mismatch");
});
