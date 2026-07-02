import test from "node:test";
import assert from "node:assert/strict";
import { sourceLeadListQuerySchema } from "./source-lead.schema.js";

test("sourceLeadListQuerySchema parses cleanup filters", () => {
  const parsed = sourceLeadListQuerySchema.safeParse({
    includeCleanup: "true",
    cleanupStatus: "INCOMPLETE_MISSING_CLIENT_AND_NAME",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.includeCleanup, true);
    assert.equal(parsed.data.cleanupStatus, "INCOMPLETE_MISSING_CLIENT_AND_NAME");
  }
});
