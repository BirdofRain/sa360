import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAuthoritativeRequestedQuantity } from "./priced-quantity-enforcement.js";

test("priced order uses LeadOrderLine.requestedQuantity", () => {
  const resolved = resolveAuthoritativeRequestedQuantity({
    requestQuantity: undefined,
    pricedRequestedQuantity: 10,
    orderRequestedQuantity: 10,
    orderLeadVolume: 10,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.requestedQuantity, 10);
  assert.equal(resolved.source, "priced_line");
});

test("priced order rejects request quantity mismatch", () => {
  const resolved = resolveAuthoritativeRequestedQuantity({
    requestQuantity: 100,
    pricedRequestedQuantity: 10,
    orderRequestedQuantity: 10,
    orderLeadVolume: 10,
  });
  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.code, "priced_quantity_mismatch");
  assert.equal(resolved.requestedQuantity, 10);
});

test("legacy unpriced order may use request quantity", () => {
  const resolved = resolveAuthoritativeRequestedQuantity({
    requestQuantity: 7,
    pricedRequestedQuantity: null,
    orderRequestedQuantity: 5,
    orderLeadVolume: 5,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.requestedQuantity, 7);
  assert.equal(resolved.source, "legacy_order");
});
