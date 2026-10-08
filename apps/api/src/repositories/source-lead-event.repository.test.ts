import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceLeadEventWhere } from "./source-lead-event.repository.js";

test("buildSourceLeadEventWhere excludes cleanup rows by default", () => {
  const where = buildSourceLeadEventWhere({});
  assert.equal(where.cleanupStatus, null);
});

test("buildSourceLeadEventWhere can include cleanup rows explicitly", () => {
  const where = buildSourceLeadEventWhere({ includeCleanup: true });
  assert.equal(where.cleanupStatus, undefined);
});

test("buildSourceLeadEventWhere can filter to a cleanup status", () => {
  const where = buildSourceLeadEventWhere({
    cleanupStatus: "INCOMPLETE_MISSING_CLIENT_AND_NAME",
  });
  assert.equal(where.cleanupStatus, "INCOMPLETE_MISSING_CLIENT_AND_NAME");
});

test("matched filter includes persisted routing matches such as source associations", () => {
  const where = buildSourceLeadEventWhere({ matched: true });
  assert.deepEqual(where.status, {
    in: ["routing_matched", "needs_review", "approved", "delivered"],
  });
});

test("unmatched filter excludes routing_matched while retaining pre-routing states", () => {
  const where = buildSourceLeadEventWhere({ matched: false });
  assert.deepEqual(where.status, {
    in: ["routing_unmatched", "received", "normalized"],
  });
});
