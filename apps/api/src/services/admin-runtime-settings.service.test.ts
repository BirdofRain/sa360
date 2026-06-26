import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __clearInMemoryAdminRuntimeSettingStoreForTests,
  __resetAdminRuntimeSettingStoreForTests,
  __useInMemoryAdminRuntimeSettingStoreForTests,
} from "../repositories/admin-runtime-setting.repository.js";
import {
  getRuntimeSetting,
  PRODUCTION_LIVE_CONFIRMATION_TEXT,
  presentRuntimeSettingForAdmin,
  REDACTED_VALUE,
  resolveRuntimeSetting,
  setRuntimeSetting,
} from "./admin-runtime-settings.service.js";

const STAGING = { environment: "STAGING" as const };

beforeEach(() => {
  __useInMemoryAdminRuntimeSettingStoreForTests();
});

afterEach(() => {
  __clearInMemoryAdminRuntimeSettingStoreForTests();
  __resetAdminRuntimeSettingStoreForTests();
});

test("resolves GLOBAL setting", async () => {
  const set = await setRuntimeSetting("ghl.delivery_mode", "shadow", STAGING, "ops", "alice");
  assert.equal(set.ok, true);

  const resolved = await resolveRuntimeSetting("ghl.delivery_mode", STAGING);
  assert.equal(resolved.value, "shadow");
  assert.equal(resolved.source, "global");
});

test("CLIENT setting overrides GLOBAL", async () => {
  await setRuntimeSetting("routing.mode", "shadow", STAGING, "global default", "alice");
  await setRuntimeSetting(
    "routing.mode",
    "live",
    { ...STAGING, clientAccountId: "client-123" },
    "client override",
    "bob"
  );

  const globalResolved = await resolveRuntimeSetting("routing.mode", STAGING);
  assert.equal(globalResolved.value, "shadow");
  assert.equal(globalResolved.source, "global");

  const clientResolved = await resolveRuntimeSetting("routing.mode", {
    ...STAGING,
    clientAccountId: "client-123",
  });
  assert.equal(clientResolved.value, "live");
  assert.equal(clientResolved.source, "client");
});

test("SUBACCOUNT setting overrides CLIENT", async () => {
  await setRuntimeSetting(
    "ghl.delivery_mode",
    "shadow",
    { ...STAGING, clientAccountId: "client-123" },
    "client level",
    "bob"
  );
  await setRuntimeSetting(
    "ghl.delivery_mode",
    "live_canary",
    { ...STAGING, clientAccountId: "client-123", subaccountIdGhl: "loc-abc" },
    "subaccount level",
    "carol"
  );

  const resolved = await resolveRuntimeSetting("ghl.delivery_mode", {
    ...STAGING,
    clientAccountId: "client-123",
    subaccountIdGhl: "loc-abc",
  });
  assert.equal(resolved.value, "live_canary");
  assert.equal(resolved.source, "subaccount");
});

test("env fallback applies when no DB setting exists", async () => {
  const prev = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  try {
    const resolved = await resolveRuntimeSetting("ghl.delivery_mode", STAGING);
    assert.equal(resolved.value, "live_canary");
    assert.equal(resolved.source, "env");
  } finally {
    if (prev === undefined) delete process.env.GHL_DELIVERY_ADAPTER_MODE;
    else process.env.GHL_DELIVERY_ADAPTER_MODE = prev;
  }
});

test("safe default applies when no DB setting and no env var", async () => {
  const prev = process.env.GHL_DELIVERY_ADAPTER_MODE;
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  try {
    const resolved = await resolveRuntimeSetting("ghl.delivery_mode", STAGING);
    assert.equal(resolved.value, "simulate");
    assert.equal(resolved.source, "default");
  } finally {
    if (prev !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prev;
  }
});

test("invalid delivery mode is rejected", async () => {
  const res = await setRuntimeSetting("ghl.delivery_mode", "ludicrous_speed", STAGING);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "INVALID_VALUE");
});

test("unknown key is rejected", async () => {
  const res = await setRuntimeSetting("secrets.token", "abc", STAGING);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "UNKNOWN_KEY");
});

test("PRODUCTION live value requires confirmation string", async () => {
  const blocked = await setRuntimeSetting(
    "ghl.delivery_mode",
    "live",
    { environment: "PRODUCTION" },
    "go live",
    "alice"
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, "CONFIRMATION");

  const allowed = await setRuntimeSetting(
    "ghl.delivery_mode",
    "live",
    { environment: "PRODUCTION" },
    "go live",
    "alice",
    { confirmationText: PRODUCTION_LIVE_CONFIRMATION_TEXT }
  );
  assert.equal(allowed.ok, true);
});

test("sensitive settings are not exposed through admin read view", async () => {
  const res = await setRuntimeSetting(
    "backup_sheet_export.mode",
    "enabled",
    STAGING,
    "enable export",
    "alice",
    { isSensitive: true }
  );
  assert.equal(res.ok, true);

  const row = await getRuntimeSetting("backup_sheet_export.mode", STAGING);
  assert.ok(row);
  const view = presentRuntimeSettingForAdmin(row!);
  assert.equal(view.isSensitive, true);
  assert.equal(view.value, REDACTED_VALUE);
  assert.notEqual(view.value, "enabled");
});

test("non-editable settings cannot be changed", async () => {
  await setRuntimeSetting("routing.mode", "shadow", STAGING, "lock it", "alice", {
    isEditable: false,
  });
  const res = await setRuntimeSetting("routing.mode", "live", STAGING, "try change", "bob");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "NOT_EDITABLE");
});
