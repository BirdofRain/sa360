import test from "node:test";
import assert from "node:assert/strict";

import {
  firstPortalSearchParam,
  parsePortalLeadListStatus,
  portalLeadListApiStatus,
  portalLeadListEmptyCopy,
  portalLeadListPath,
  PORTAL_LEAD_LIST_STATUS_OPTIONS,
} from "./portal-lead-list-status.ts";

test("default All state omits the status query", () => {
  assert.equal(parsePortalLeadListStatus(undefined), "all");
  assert.equal(parsePortalLeadListStatus(""), "all");
  assert.equal(parsePortalLeadListStatus("   "), "all");
  assert.equal(portalLeadListPath("all"), "/portal/leads");
  assert.equal(portalLeadListApiStatus("all"), undefined);
});

test("supported delivered filter serializes to the existing status query", () => {
  assert.equal(parsePortalLeadListStatus("delivered"), "delivered");
  assert.equal(parsePortalLeadListStatus("Delivered"), "delivered");
  assert.equal(parsePortalLeadListStatus("  DELIVERED  "), "delivered");
  assert.equal(portalLeadListPath("delivered"), "/portal/leads?status=delivered");
  assert.equal(portalLeadListApiStatus("delivered"), "delivered");
});

test("unsupported and invalid status values fall back to All and are not forwarded", () => {
  for (const raw of [
    "pending",
    "failed",
    "needs_attention",
    "approved",
    "delivery_failed",
    "routing_matched",
    "not_started",
    "skipped",
    "bogus",
    "true",
  ]) {
    assert.equal(parsePortalLeadListStatus(raw), "all", raw);
    assert.equal(portalLeadListApiStatus(parsePortalLeadListStatus(raw)), undefined, raw);
  }
});

test("customer-safe options stay All and Delivered only", () => {
  assert.deepEqual(
    PORTAL_LEAD_LIST_STATUS_OPTIONS.map((option) => option.value),
    ["all", "delivered"]
  );
});

test("filtered empty copy is distinct from the unfiltered empty copy", () => {
  const all = portalLeadListEmptyCopy("all");
  const delivered = portalLeadListEmptyCopy("delivered");
  assert.equal(all.title, "No delivered leads yet");
  assert.equal(delivered.title, "No delivered leads match this filter.");
  assert.notEqual(all.title, delivered.title);
});

test("firstPortalSearchParam reads a single query value", () => {
  assert.equal(firstPortalSearchParam("delivered"), "delivered");
  assert.equal(firstPortalSearchParam(["delivered", "pending"]), "delivered");
  assert.equal(firstPortalSearchParam(undefined), undefined);
});
