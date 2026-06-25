import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMirrorLiveGuardrails } from "./client-channel-profile-env.js";

const ENV_KEYS = [
  "GHL_ADMIN_CONFIG_WRITE_MODE",
  "SA360_CLIENT_PROFILE_SETTINGS_ENABLED",
  "SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS",
  "SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS",
] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

const DEMO_CLIENT = "smart_agent_360_demo";
const DEMO_LOCATION = "VPuMIhN6JpxdoXvvlekZ";

test("live blocked when effective mode != live", () => {
  withEnv(
    {
      GHL_ADMIN_CONFIG_WRITE_MODE: "live",
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS: DEMO_CLIENT,
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS: DEMO_LOCATION,
    },
    () => {
      const r = evaluateMirrorLiveGuardrails({
        clientAccountId: DEMO_CLIENT,
        locationId: DEMO_LOCATION,
        effectiveMode: "simulate",
      });
      assert.equal(r.liveAllowed, false);
    }
  );
});

test("live blocked when env max mode != live", () => {
  withEnv(
    {
      GHL_ADMIN_CONFIG_WRITE_MODE: "simulate",
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS: DEMO_CLIENT,
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS: DEMO_LOCATION,
    },
    () => {
      // effectiveMode can't actually exceed max, but guardrails should still block.
      const r = evaluateMirrorLiveGuardrails({
        clientAccountId: DEMO_CLIENT,
        locationId: DEMO_LOCATION,
        effectiveMode: "live",
      });
      assert.equal(r.liveAllowed, false);
      assert.equal(r.checks.maxModeIsLive, false);
    }
  );
});

test("live blocked without allowlist envs", () => {
  withEnv({ GHL_ADMIN_CONFIG_WRITE_MODE: "live" }, () => {
    const r = evaluateMirrorLiveGuardrails({
      clientAccountId: DEMO_CLIENT,
      locationId: DEMO_LOCATION,
      effectiveMode: "live",
    });
    assert.equal(r.liveAllowed, false);
    assert.equal(r.checks.hasClientAllowlist, false);
    assert.equal(r.checks.hasLocationAllowlist, false);
  });
});

test("live blocked when client not allowlisted", () => {
  withEnv(
    {
      GHL_ADMIN_CONFIG_WRITE_MODE: "live",
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS: "some_other_client",
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS: DEMO_LOCATION,
    },
    () => {
      const r = evaluateMirrorLiveGuardrails({
        clientAccountId: DEMO_CLIENT,
        locationId: DEMO_LOCATION,
        effectiveMode: "live",
      });
      assert.equal(r.liveAllowed, false);
      assert.equal(r.checks.clientAllowlisted, false);
    }
  );
});

test("live blocked when location not allowlisted", () => {
  withEnv(
    {
      GHL_ADMIN_CONFIG_WRITE_MODE: "live",
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS: DEMO_CLIENT,
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS: "some_other_location",
    },
    () => {
      const r = evaluateMirrorLiveGuardrails({
        clientAccountId: DEMO_CLIENT,
        locationId: DEMO_LOCATION,
        effectiveMode: "live",
      });
      assert.equal(r.liveAllowed, false);
      assert.equal(r.checks.locationAllowlisted, false);
    }
  );
});

test("live permitted only for fully allowlisted demo target", () => {
  withEnv(
    {
      GHL_ADMIN_CONFIG_WRITE_MODE: "live",
      SA360_CLIENT_PROFILE_SETTINGS_ENABLED: "true",
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_CLIENTS: DEMO_CLIENT,
      SA360_GHL_CONFIG_WRITE_ALLOWLIST_LOCATIONS: DEMO_LOCATION,
    },
    () => {
      const r = evaluateMirrorLiveGuardrails({
        clientAccountId: DEMO_CLIENT,
        locationId: DEMO_LOCATION,
        effectiveMode: "live",
      });
      assert.equal(r.liveAllowed, true);
      assert.equal(r.blockers.length, 0);
    }
  );
});
