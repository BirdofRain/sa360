import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_LEAD_APPROVE_CONFIRMATION } from "./types.js";
import { parseSourceIntakeSearchParams } from "./source-intake-query.js";

test("SOURCE_LEAD_APPROVE_CONFIRMATION is defined for UI", () => {
  assert.equal(SOURCE_LEAD_APPROVE_CONFIRMATION, "APPROVE SOURCE LEAD DELIVERY");
});

test("parseSourceIntakeSearchParams reads provider filter", () => {
  const q = parseSourceIntakeSearchParams({ provider: "leadcapture_io", system: "leadcapture_io_legacy" });
  assert.equal(q.sourceProvider, "leadcapture_io");
  assert.equal(q.sourceSystem, "leadcapture_io_legacy");
});

test("matched filter parses true/false", () => {
  assert.equal(parseSourceIntakeSearchParams({ matched: "true" }).matched, "true");
  assert.equal(parseSourceIntakeSearchParams({ matched: "false" }).matched, "false");
});
