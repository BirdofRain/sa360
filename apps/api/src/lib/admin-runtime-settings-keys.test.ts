import test from "node:test";
import assert from "node:assert/strict";
import {
  getEnvFallbackForKey,
  getSafeDefaultForKey,
  isAllowedRuntimeSettingKey,
  isLiveRuntimeSettingValue,
  RUNTIME_SETTING_KEYS,
  validateRuntimeSettingValue,
} from "./admin-runtime-settings-keys.js";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const v = vars[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("all four documented keys are registered", () => {
  assert.deepEqual(
    [...RUNTIME_SETTING_KEYS].sort(),
    [
      "backup_sheet_export.mode",
      "ghl.delivery_mode",
      "meta.dispatch_mode",
      "routing.mode",
    ].sort()
  );
});

test("safe defaults are the conservative options", () => {
  assert.equal(getSafeDefaultForKey("ghl.delivery_mode"), "simulate");
  assert.equal(getSafeDefaultForKey("meta.dispatch_mode"), "disabled");
  assert.equal(getSafeDefaultForKey("routing.mode"), "dry_run");
  assert.equal(getSafeDefaultForKey("backup_sheet_export.mode"), "disabled");
});

test("invalid delivery mode value is rejected", () => {
  const bad = validateRuntimeSettingValue("ghl.delivery_mode", "turbo");
  assert.equal(bad.ok, false);
  const good = validateRuntimeSettingValue("ghl.delivery_mode", "shadow");
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value, "shadow");
});

test("unknown key is rejected and not allowed", () => {
  assert.equal(isAllowedRuntimeSettingKey("secrets.api_token"), false);
  const res = validateRuntimeSettingValue("secrets.api_token", "anything");
  assert.equal(res.ok, false);
});

test("non-string values are rejected", () => {
  assert.equal(validateRuntimeSettingValue("routing.mode", 123).ok, false);
  assert.equal(validateRuntimeSettingValue("routing.mode", { mode: "live" }).ok, false);
});

test("live values are flagged for escalation", () => {
  assert.equal(isLiveRuntimeSettingValue("ghl.delivery_mode", "live"), true);
  assert.equal(isLiveRuntimeSettingValue("ghl.delivery_mode", "live_canary"), true);
  assert.equal(isLiveRuntimeSettingValue("ghl.delivery_mode", "simulate"), false);
  assert.equal(isLiveRuntimeSettingValue("routing.mode", "live"), true);
});

test("env fallback maps legacy GHL_DELIVERY_ADAPTER_MODE", () => {
  withEnv({ GHL_DELIVERY_ADAPTER_MODE: "live_canary" }, () => {
    assert.equal(getEnvFallbackForKey("ghl.delivery_mode"), "live_canary");
  });
  withEnv({ GHL_DELIVERY_ADAPTER_MODE: "readonly_probe" }, () => {
    // Not part of delivery_mode value set → no env override (safe default applies later).
    assert.equal(getEnvFallbackForKey("ghl.delivery_mode"), null);
  });
});

test("meta dispatch env fallback never escalates to live", () => {
  withEnv({ META_SYNC_ENABLED: "true", META_DISPATCH_MODE: undefined }, () => {
    assert.equal(getEnvFallbackForKey("meta.dispatch_mode"), "simulate");
  });
  withEnv({ META_SYNC_ENABLED: "false", META_DISPATCH_MODE: undefined }, () => {
    assert.equal(getEnvFallbackForKey("meta.dispatch_mode"), "disabled");
  });
  withEnv({ META_DISPATCH_MODE: "live" }, () => {
    assert.equal(getEnvFallbackForKey("meta.dispatch_mode"), "live");
  });
});
