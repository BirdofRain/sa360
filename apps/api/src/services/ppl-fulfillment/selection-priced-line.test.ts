import assert from "node:assert/strict";
import test from "node:test";

import { resolveSelectionPricedLine } from "./ppl-order-pricing.js";

const line = (id: string, bucket: string, quantity: number) => ({
  id,
  lineNumber: quantity,
  status: "active",
  requestedQuantity: quantity,
  unitPriceCents: bucket === "COMMERCE_1_3_MO" ? 600 : 400,
  lineTotalCents: quantity * (bucket === "COMMERCE_1_3_MO" ? 600 : 400),
  metadataJson: {
    schema: "ppl_order_line_pricing_v1",
    pricingVersion: "ppl_aged_beta_2026_08_v1",
    commerceAgeBucketKey: bucket,
    unitPriceCents: bucket === "COMMERCE_1_3_MO" ? 600 : 400,
  },
  ageBandKeysJson: [bucket],
});

test("a single priced line remains selectable without a line id", () => {
  const resolved = resolveSelectionPricedLine([line("ln_1", "COMMERCE_1_3_MO", 2)]);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.line?.lineId, "ln_1");
});

test("multiple priced lines fail closed unless the requested line is named", () => {
  const lines = [line("ln_1", "COMMERCE_1_3_MO", 2), line("ln_2", "COMMERCE_3_6_MO", 3)];
  const missing = resolveSelectionPricedLine(lines);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "order_line_required");
  const selected = resolveSelectionPricedLine(lines, "ln_2");
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.line?.commerceAgeBucketKey, "COMMERCE_3_6_MO");
    assert.equal(selected.line?.requestedQuantity, 3);
    assert.equal(selected.line?.unitPriceCents, 400);
  }
  const unknown = resolveSelectionPricedLine(lines, "ln_missing");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "order_line_not_found");
});
