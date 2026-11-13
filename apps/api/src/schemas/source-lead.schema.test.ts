import test from "node:test";
import assert from "node:assert/strict";
import { sourceLeadListQuerySchema } from "./source-lead.schema.js";

test("sourceLeadListQuerySchema rejects an America/New_York receivedAt window", () => {
  const received = sourceLeadListQuerySchema.safeParse({
    receivedFrom: "2026-01-15T05:00:00.000Z",
    receivedTo: "2026-01-16T04:59:59.999Z",
  });
  assert.equal(received.success, false);

  const fromTo = sourceLeadListQuerySchema.safeParse({
    from: "2026-07-15T04:00:00.000Z",
    to: "2026-07-16T03:59:59.999Z",
  });
  assert.equal(fromTo.success, false);

  const live = sourceLeadListQuerySchema.safeParse({ status: "delivery_failed", liveFailure: "true" });
  assert.equal(live.success, true);
  if (live.success) {
    assert.equal(live.data.liveFailure, true);
    assert.equal(live.data.status, "delivery_failed");
  }

  const status = sourceLeadListQuerySchema.safeParse({ status: "delivery_failed" });
  assert.equal(status.success, true);
  if (status.success) {
    assert.equal(status.data.status, "delivery_failed");
    assert.equal("receivedAt" in status.data, false);
    assert.equal("receivedFrom" in status.data, false);
  }
});

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
