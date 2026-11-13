import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_LEAD_APPROVE_CONFIRMATION } from "./types.js";
import {
  parseSourceIntakeSearchParams,
  sourceIntakePageHref,
  sourceIntakeToApiParams,
} from "./source-intake-query.js";

test("SOURCE_LEAD_APPROVE_CONFIRMATION is defined for UI", () => {
  assert.equal(SOURCE_LEAD_APPROVE_CONFIRMATION, "APPROVE SOURCE LEAD DELIVERY");
});

test("parseSourceIntakeSearchParams reads provider filter", () => {
  const q = parseSourceIntakeSearchParams({ provider: "leadcapture_io", system: "leadcapture_io_legacy" });
  assert.equal(q.sourceProvider, "leadcapture_io");
  assert.equal(q.sourceSystem, "leadcapture_io_legacy");
});

test("Next keeps the live-failure filter and the other active filters", () => {
  const query = parseSourceIntakeSearchParams({
    status: "delivery_failed",
    liveFailure: "true",
    provider: "leadcapture_io",
    system: "leadcapture_io_nextgen",
    matched: "false",
    client: "client_a",
    limit: "50",
  });
  assert.equal(query.liveFailure, true);
  assert.equal(sourceIntakeToApiParams(query).liveFailure, "true");
  assert.equal(sourceIntakeToApiParams(query).status, "delivery_failed");
  const next = sourceIntakePageHref(query, { cursor: "evt_next" });
  const params = new URLSearchParams(next.split("?")[1]);
  assert.equal(params.get("status"), "delivery_failed");
  assert.equal(params.get("liveFailure"), "true");
  assert.equal(params.get("provider"), "leadcapture_io");
  assert.equal(params.get("system"), "leadcapture_io_nextgen");
  assert.equal(params.get("matched"), "false");
  assert.equal(params.get("client"), "client_a");
  assert.equal(params.get("limit"), "50");
  assert.equal(params.get("cursor"), "evt_next");
});

test("matched filter parses true/false", () => {
  assert.equal(parseSourceIntakeSearchParams({ matched: "true" }).matched, "true");
  assert.equal(parseSourceIntakeSearchParams({ matched: "false" }).matched, "false");
});
