import test from "node:test";
import assert from "node:assert/strict";

import {
  isPortalLeadNotFoundStatus,
  parsePortalLeadId,
  portalLeadDetailPath,
} from "./portal-lead-detail.ts";

test("parsePortalLeadId accepts a simple id and rejects traversal", () => {
  assert.equal(parsePortalLeadId("lead_1"), "lead_1");
  assert.equal(parsePortalLeadId("  evt_abc  "), "evt_abc");
  assert.equal(parsePortalLeadId("../secret"), null);
  assert.equal(parsePortalLeadId("a/b"), null);
  assert.equal(parsePortalLeadId(""), null);
  assert.equal(parsePortalLeadId(undefined), null);
});

test("portalLeadDetailPath encodes the lead id", () => {
  assert.equal(portalLeadDetailPath("lead_1"), "/portal/leads/lead_1");
  assert.equal(portalLeadDetailPath("a b"), "/portal/leads/a%20b");
});

test("portalLeadDetailPath preserves only the supported list status", () => {
  assert.equal(portalLeadDetailPath("lead_1", "all"), "/portal/leads/lead_1");
  assert.equal(portalLeadDetailPath("lead_1", "delivered"), "/portal/leads/lead_1?status=delivered");
  assert.equal(portalLeadDetailPath("lead_1", "bogus"), "/portal/leads/lead_1");
  assert.equal(portalLeadDetailPath("lead_1", "pending"), "/portal/leads/lead_1");
});

test("not-found statuses include missing and denied leads without leaking tenant", () => {
  assert.equal(isPortalLeadNotFoundStatus(404), true);
  assert.equal(isPortalLeadNotFoundStatus(403), true);
  assert.equal(isPortalLeadNotFoundStatus(401), true);
  assert.equal(isPortalLeadNotFoundStatus(400), true);
  assert.equal(isPortalLeadNotFoundStatus(502), false);
  assert.equal(isPortalLeadNotFoundStatus(0), false);
});
