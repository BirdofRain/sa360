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
