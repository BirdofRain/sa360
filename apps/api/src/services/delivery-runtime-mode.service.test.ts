import test from "node:test";
import assert from "node:assert/strict";
import {
  getGhlDeliveryAdapterMaxMode,
  __setEffectiveAdapterModeForTests,
} from "../lib/ghl-delivery-adapter-mode.js";
import {
  ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
  RETURN_TO_SIMULATE_CONFIRMATION_TEXT,
  resolveDeliveryRuntimeMode,
  setDeliveryRuntimeMode,
  setDeliveryRuntimeModeForTests,
  invalidateDeliveryRuntimeModeCache,
} from "./delivery-runtime-mode.service.js";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const v = vars[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  invalidateDeliveryRuntimeModeCache();
  setDeliveryRuntimeModeForTests(null);
  __setEffectiveAdapterModeForTests(null);
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    invalidateDeliveryRuntimeModeCache();
    setDeliveryRuntimeModeForTests(null);
    __setEffectiveAdapterModeForTests(null);
  });
}

test("default max mode is simulate when env missing", async () => {
  await withEnv(
    {
      GHL_DELIVERY_ADAPTER_MODE: undefined,
      GHL_DELIVERY_ADAPTER_MAX_MODE: undefined,
      SA360_GHL_LIVE_CANARY_ALLOWED: undefined,
    },
    () => {
      assert.equal(getGhlDeliveryAdapterMaxMode(), "simulate");
    }
  );
});

test("env max simulate blocks live_canary even when DB runtime is live_canary", async () => {
  await withEnv(
    {
      GHL_DELIVERY_ADAPTER_MAX_MODE: "simulate",
      GHL_DELIVERY_ADAPTER_MODE: undefined,
    },
    async () => {
      setDeliveryRuntimeModeForTests({
        configuredRuntimeMode: "live_canary",
        liveCanaryEnabledUntil: new Date(Date.now() + 60_000),
        reason: "test",
      });
      const resolved = await resolveDeliveryRuntimeMode(true);
      assert.equal(resolved.effectiveMode, "simulate");
      assert.equal(resolved.canRunLiveCanary, false);
    }
  );
});

test("enabling live_canary requires exact ENABLE LIVE CANARY", async () => {
  await withEnv({ GHL_DELIVERY_ADAPTER_MAX_MODE: "live_canary" }, async () => {
    const bad = await setDeliveryRuntimeMode({
      mode: "live_canary",
      durationMinutes: 15,
      operatorConfirmationText: "wrong",
      reason: "demo",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "CONFIRMATION");
  });
});

test("enable duration cannot exceed 30 minutes", async () => {
  await withEnv({ GHL_DELIVERY_ADAPTER_MAX_MODE: "live_canary" }, async () => {
    const bad = await setDeliveryRuntimeMode({
      mode: "live_canary",
      durationMinutes: 45,
      operatorConfirmationText: ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
      reason: "demo",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "VALIDATION");
  });
});

test("expired live_canary resolves to simulate", async () => {
  await withEnv({ GHL_DELIVERY_ADAPTER_MAX_MODE: "live_canary" }, async () => {
    setDeliveryRuntimeModeForTests({
      configuredRuntimeMode: "live_canary",
      liveCanaryEnabledUntil: new Date(Date.now() - 60_000),
      reason: "expired test",
    });
    const resolved = await resolveDeliveryRuntimeMode(true);
    assert.equal(resolved.expired, true);
    assert.equal(resolved.effectiveMode, "simulate");
    assert.equal(resolved.canRunLiveCanary, false);
  });
});

test("return to simulate requires exact confirmation text", async () => {
  await withEnv({ GHL_DELIVERY_ADAPTER_MAX_MODE: "live_canary" }, async () => {
    const bad = await setDeliveryRuntimeMode({
      mode: "simulate",
      operatorConfirmationText: "nope",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "CONFIRMATION");

    await setDeliveryRuntimeMode({
      mode: "live_canary",
      durationMinutes: 15,
      operatorConfirmationText: ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
      reason: "setup for return test",
    });
    setDeliveryRuntimeModeForTests(null);
    invalidateDeliveryRuntimeModeCache();
    const ok = await setDeliveryRuntimeMode({
      mode: "simulate",
      operatorConfirmationText: RETURN_TO_SIMULATE_CONFIRMATION_TEXT,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.status.effectiveMode, "simulate");
  });
});

test("SA360_GHL_LIVE_CANARY_ALLOWED=false caps max at simulate", async () => {
  await withEnv(
    {
      SA360_GHL_LIVE_CANARY_ALLOWED: "false",
      GHL_DELIVERY_ADAPTER_MAX_MODE: undefined,
      GHL_DELIVERY_ADAPTER_MODE: undefined,
    },
    () => {
      assert.equal(getGhlDeliveryAdapterMaxMode(), "simulate");
    }
  );
});
