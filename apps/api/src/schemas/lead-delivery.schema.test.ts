import test from "node:test";
import assert from "node:assert/strict";
import { leadDeliveryListQuerySchema } from "./lead-delivery.schema.js";

test("leadDeliveryListQuerySchema parses cleanup filters", () => {
  const parsed = leadDeliveryListQuerySchema.safeParse({
    includeCleanup: "true",
    cleanupStatus: "INCOMPLETE_MISSING_CLIENT_AND_NAME",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.includeCleanup, true);
    assert.equal(parsed.data.cleanupStatus, "INCOMPLETE_MISSING_CLIENT_AND_NAME");
  }
});
