import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateLf2GhlCanaryAllowlists,
  LF2_EXECUTION_ENABLED_ENV,
  LF2_GHL_ALLOWED_CLIENT_IDS_ENV,
  LF2_GHL_ALLOWED_LOCATION_IDS_ENV,
  LF2_GHL_ALLOWED_ORDER_IDS_ENV,
  LF2_GHL_ALLOWED_SOURCE_LANES_ENV,
  LF2_GHL_CANARY_ENABLED_ENV,
} from "./lf2-ghl-canary-config.js";

const baseInput = {
  clientAccountId: "client_a",
  locationIdGhl: "loc_123",
  leadOrderId: "order_1",
  sourceLane: "manual_import",
};

test("LF2 GHL allowlists deny when unset or empty", () => {
  delete process.env[LF2_EXECUTION_ENABLED_ENV];
  delete process.env[LF2_GHL_CANARY_ENABLED_ENV];
  delete process.env[LF2_GHL_ALLOWED_CLIENT_IDS_ENV];
  delete process.env[LF2_GHL_ALLOWED_LOCATION_IDS_ENV];
  delete process.env[LF2_GHL_ALLOWED_ORDER_IDS_ENV];
  delete process.env[LF2_GHL_ALLOWED_SOURCE_LANES_ENV];

  const result = evaluateLf2GhlCanaryAllowlists(baseInput);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.length >= 5);
});

test("LF2 GHL allowlists permit only explicit matches", () => {
  process.env[LF2_EXECUTION_ENABLED_ENV] = "true";
  process.env[LF2_GHL_CANARY_ENABLED_ENV] = "true";
  process.env[LF2_GHL_ALLOWED_CLIENT_IDS_ENV] = "client_a";
  process.env[LF2_GHL_ALLOWED_LOCATION_IDS_ENV] = "loc_123";
  process.env[LF2_GHL_ALLOWED_ORDER_IDS_ENV] = "order_1";
  process.env[LF2_GHL_ALLOWED_SOURCE_LANES_ENV] = "manual_import";

  const allowed = evaluateLf2GhlCanaryAllowlists(baseInput);
  assert.equal(allowed.allowed, true);

  const denied = evaluateLf2GhlCanaryAllowlists({ ...baseInput, leadOrderId: "order_2" });
  assert.equal(denied.allowed, false);
});

test("malformed empty CSV allowlists deny execution", () => {
  process.env[LF2_EXECUTION_ENABLED_ENV] = "true";
  process.env[LF2_GHL_CANARY_ENABLED_ENV] = "true";
  process.env[LF2_GHL_ALLOWED_CLIENT_IDS_ENV] = " , ";
  process.env[LF2_GHL_ALLOWED_LOCATION_IDS_ENV] = "";
  process.env[LF2_GHL_ALLOWED_ORDER_IDS_ENV] = "order_1";
  process.env[LF2_GHL_ALLOWED_SOURCE_LANES_ENV] = "manual_import";

  const result = evaluateLf2GhlCanaryAllowlists(baseInput);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((entry) => entry.includes(LF2_GHL_ALLOWED_CLIENT_IDS_ENV)));
});
