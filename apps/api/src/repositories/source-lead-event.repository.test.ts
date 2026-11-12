import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceLeadEventWhere } from "./source-lead-event.repository.js";

test("buildSourceLeadEventWhere cannot bound receivedAt to an Eastern day", () => {
  const all = buildSourceLeadEventWhere({});
  assert.equal(Object.prototype.hasOwnProperty.call(all, "receivedAt"), false);

  const failures = buildSourceLeadEventWhere({ status: "delivery_failed" });
  assert.equal(failures.status, "delivery_failed");
  assert.equal(Object.prototype.hasOwnProperty.call(failures, "receivedAt"), false);

  const duplicates = buildSourceLeadEventWhere({ status: "duplicate_blocked" });
  assert.equal(duplicates.status, "duplicate_blocked");
  assert.notEqual(duplicates.status, failures.status);
});

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
