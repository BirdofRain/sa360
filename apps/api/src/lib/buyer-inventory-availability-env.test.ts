import assert from "node:assert/strict";
import test from "node:test";

import { isBuyerInventoryAvailabilityEnabled } from "./buyer-inventory-availability-env.js";

test("buyer inventory availability flag defaults off", () => {
  const previous = process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
  delete process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
  try {
    assert.equal(isBuyerInventoryAvailabilityEnabled(), false);
    process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = "false";
    assert.equal(isBuyerInventoryAvailabilityEnabled(), false);
    process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = "1";
    assert.equal(isBuyerInventoryAvailabilityEnabled(), false);
    process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = "true";
    assert.equal(isBuyerInventoryAvailabilityEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED;
    else process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED = previous;
  }
});
