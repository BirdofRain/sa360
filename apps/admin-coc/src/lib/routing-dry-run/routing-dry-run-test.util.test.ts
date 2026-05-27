import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRoutingDryRunApiError,
  parseRoutingDryRunTestJson,
} from "./routing-dry-run-test.util.ts";

test("parseRoutingDryRunTestJson accepts object payload", () => {
  const r = parseRoutingDryRunTestJson('{"event":{"event_name_internal":"lead_created"}}');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.payload.event?.event_name_internal, "lead_created");
});

test("parseRoutingDryRunTestJson rejects invalid JSON", () => {
  const r = parseRoutingDryRunTestJson("{ not json");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Invalid JSON/i);
});

test("parseRoutingDryRunTestJson rejects empty input", () => {
  const r = parseRoutingDryRunTestJson("   ");
  assert.equal(r.ok, false);
});

test("formatRoutingDryRunApiError maps 400 with error body", () => {
  const msg = formatRoutingDryRunApiError(400, JSON.stringify({ error: "Invalid body" }));
  assert.equal(msg, "Invalid body");
});
