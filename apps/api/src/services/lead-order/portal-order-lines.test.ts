import assert from "node:assert/strict";
import test from "node:test";

import { validatePortalOrderLines } from "./portal-order-lines.js";

test("portal order lines reject malformed quantities and duplicate buckets", () => {
  assert.equal(
    validatePortalOrderLines({ lines: [], leadVolume: 1 }).ok,
    false
  );
  assert.equal(
    validatePortalOrderLines({
      lines: [{ commerceAgeBucketKey: "COMMERCE_6_12_MO", requestedQuantity: 1 }],
      leadVolume: 1,
    }).ok,
    false
  );
  assert.equal(
    validatePortalOrderLines({
      lines: [
        { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
        { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
      ],
      leadVolume: 4,
    }).ok,
    false
  );
  for (const requestedQuantity of [0, -1, 1.5, 1_000_001]) {
    const result = validatePortalOrderLines({
      lines: [{ commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity }],
      leadVolume: requestedQuantity,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_quantity");
  }
  const mismatch = validatePortalOrderLines({
    lines: [
      { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
      { commerceAgeBucketKey: "COMMERCE_3_6_MO", requestedQuantity: 3 },
    ],
    leadVolume: 4,
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "quantity_mismatch");
});

test("portal order lines accept one quantity per purchasable bucket", () => {
  const result = validatePortalOrderLines({
    lines: [
      { commerceAgeBucketKey: "COMMERCE_3_6_MO", requestedQuantity: 3 },
      { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
    ],
    leadVolume: 5,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.totalQuantity, 5);
});
