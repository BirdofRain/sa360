import { test } from "node:test";
import assert from "node:assert/strict";

import { bucketAvailabilityLabel } from "./lead-inventory-client-availability.helpers.js";

test("client availability labels bucket quantities without exposing exact counts in label", () => {
  assert.equal(bucketAvailabilityLabel(0), "Currently unavailable");
  assert.equal(bucketAvailabilityLabel(3), "Limited");
  assert.equal(bucketAvailabilityLabel(12), "Available");
});
