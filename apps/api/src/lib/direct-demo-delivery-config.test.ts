import test from "node:test";
import assert from "node:assert/strict";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
  getDirectDeliveryAllowedClientIds,
  isDirectDemoDestinationAllowed,
  isDirectLiveDeliveryEnvConfigured,
} from "./direct-demo-delivery-config.js";

test("canonical demo destination is allowlisted by default", () => {
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  assert.equal(
    isDirectDemoDestinationAllowed(
      DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
      DIRECT_DEMO_CANONICAL_LOCATION_ID
    ),
    true
  );
  assert.equal(isDirectDemoDestinationAllowed("breanna_kimberling", DIRECT_DEMO_CANONICAL_LOCATION_ID), false);
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
});

test("live direct delivery requires explicit env allowlist", () => {
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  assert.equal(isDirectLiveDeliveryEnvConfigured(), false);
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = "smart_agent_360_demo";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = "VPuMIhN6JpxdoXvvlekZ";
  assert.equal(isDirectLiveDeliveryEnvConfigured(), true);
  assert.ok(getDirectDeliveryAllowedClientIds().has("smart_agent_360_demo"));
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});
