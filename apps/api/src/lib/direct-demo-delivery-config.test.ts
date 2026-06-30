import test from "node:test";
import assert from "node:assert/strict";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
  LIVE_CANARY_DESTINATION_ALLOWLIST_ENV,
  getDirectDeliveryAllowedClientIds,
  getLiveCanaryAllowedDestinationPairs,
  isDestinationAllowedForLiveCanary,
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

test("live canary optional destination allowlist accepts CSV pairs", () => {
  const prev = process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
  process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] =
    "vet_life_james_torrey:9xSNvQCbGaPE9YNxgl4B,smart_agent_360_demo_2:VPuMIhN6JpxdoXvvlekZ";
  const pairs = getLiveCanaryAllowedDestinationPairs();
  assert.ok(pairs);
  assert.equal(pairs!.has("vet_life_james_torrey:9xSNvQCbGaPE9YNxgl4B"), true);
  assert.equal(pairs!.has("smart_agent_360_demo_2:VPuMIhN6JpxdoXvvlekZ"), true);
  if (prev !== undefined) process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] = prev;
  else delete process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
});

test("live canary destination allowlist accepts JSON object", () => {
  const prev = process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
  process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] = JSON.stringify({
    vet_life_james_torrey: "9xSNvQCbGaPE9YNxgl4B",
    smart_agent_360_demo_2: "VPuMIhN6JpxdoXvvlekZ",
  });
  const pairs = getLiveCanaryAllowedDestinationPairs();
  assert.ok(pairs);
  assert.equal(pairs!.has("vet_life_james_torrey:9xSNvQCbGaPE9YNxgl4B"), true);
  if (prev !== undefined) process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] = prev;
  else delete process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
});

test("live canary allowlist is optional when env absent", () => {
  const prev = process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
  delete process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
  const check = isDestinationAllowedForLiveCanary("vet_life_james_torrey", "9xSNvQCbGaPE9YNxgl4B");
  assert.equal(check.configured, false);
  assert.equal(check.allowed, true);
  if (prev !== undefined) process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] = prev;
});

test("live canary allowlist blocks non-listed destination when configured", () => {
  const prev = process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
  process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] =
    "smart_agent_360_demo_2:VPuMIhN6JpxdoXvvlekZ";
  const listed = isDestinationAllowedForLiveCanary("smart_agent_360_demo_2", "VPuMIhN6JpxdoXvvlekZ");
  const blocked = isDestinationAllowedForLiveCanary(
    "vet_life_james_torrey",
    "9xSNvQCbGaPE9YNxgl4B"
  );
  assert.deepEqual(listed, { configured: true, allowed: true });
  assert.deepEqual(blocked, { configured: true, allowed: false });
  if (prev !== undefined) process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] = prev;
  else delete process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
});
