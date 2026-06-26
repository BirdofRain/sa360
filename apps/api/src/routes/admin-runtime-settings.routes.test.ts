import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { adminRuntimeSettingsRoutes } from "./admin-runtime-settings.js";
import {
  __clearInMemoryAdminRuntimeSettingStoreForTests,
  __resetAdminRuntimeSettingStoreForTests,
  __useInMemoryAdminRuntimeSettingStoreForTests,
} from "../repositories/admin-runtime-setting.repository.js";
import {
  REDACTED_VALUE,
  setRuntimeSetting,
} from "../services/admin-runtime-settings.service.js";

const HEADER = "x-sa360-admin-key";
const ADMIN_KEY = "admin-secret";
const STAGING = { environment: "STAGING" as const };

let prevAdminKey: string | undefined;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(adminRuntimeSettingsRoutes, { prefix: "/admin/v1" });
  return app;
}

beforeEach(() => {
  __useInMemoryAdminRuntimeSettingStoreForTests();
  prevAdminKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
});

afterEach(() => {
  __clearInMemoryAdminRuntimeSettingStoreForTests();
  __resetAdminRuntimeSettingStoreForTests();
  if (prevAdminKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prevAdminKey;
});

test("GET /runtime-settings requires admin auth", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/runtime-settings" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("GET /runtime-settings/resolve requires admin auth", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("list returns all known keys safely even with no configured rows", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings",
    headers: { [HEADER]: ADMIN_KEY },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    ok: boolean;
    keys: Array<{ key: string; allowedValues: string[]; defaultValue: string; configured: unknown[] }>;
  };
  assert.equal(body.ok, true);
  const keyNames = body.keys.map((k) => k.key).sort();
  assert.deepEqual(keyNames, [
    "backup_sheet_export.mode",
    "ghl.delivery_mode",
    "meta.dispatch_mode",
    "routing.mode",
  ]);
  const ghl = body.keys.find((k) => k.key === "ghl.delivery_mode")!;
  assert.equal(ghl.defaultValue, "simulate");
  assert.ok(ghl.allowedValues.includes("simulate"));
  assert.deepEqual(ghl.configured, []);
  await app.close();
});

test("list returns configured rows for a key", async () => {
  await setRuntimeSetting("routing.mode", "shadow", STAGING, "ops", "alice");
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings?key=routing.mode&environment=STAGING",
    headers: { [HEADER]: ADMIN_KEY },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    keys: Array<{ key: string; configured: Array<{ value: string; scope: string }> }>;
  };
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0].configured.length, 1);
  assert.equal(body.keys[0].configured[0].value, "shadow");
  assert.equal(body.keys[0].configured[0].scope, "GLOBAL");
  await app.close();
});

test("resolve returns GLOBAL value", async () => {
  await setRuntimeSetting("ghl.delivery_mode", "shadow", STAGING, "ops", "alice");
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve?key=ghl.delivery_mode&environment=STAGING",
    headers: { [HEADER]: ADMIN_KEY },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    resolved: Array<{ key: string; effectiveValue: string; resolvedFrom: string }>;
  };
  assert.equal(body.resolved.length, 1);
  assert.equal(body.resolved[0].effectiveValue, "shadow");
  assert.equal(body.resolved[0].resolvedFrom, "GLOBAL");
  await app.close();
});

test("CLIENT override beats GLOBAL in resolve", async () => {
  await setRuntimeSetting("routing.mode", "shadow", STAGING, "global", "alice");
  await setRuntimeSetting(
    "routing.mode",
    "live",
    { ...STAGING, clientAccountId: "client-123" },
    "client",
    "bob"
  );
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve?key=routing.mode&environment=STAGING&clientAccountId=client-123",
    headers: { [HEADER]: ADMIN_KEY },
  });
  const body = res.json() as {
    resolved: Array<{ effectiveValue: string; resolvedFrom: string }>;
  };
  assert.equal(body.resolved[0].effectiveValue, "live");
  assert.equal(body.resolved[0].resolvedFrom, "CLIENT");
  await app.close();
});

test("SUBACCOUNT override beats CLIENT in resolve", async () => {
  await setRuntimeSetting(
    "ghl.delivery_mode",
    "shadow",
    { ...STAGING, clientAccountId: "client-123" },
    "client",
    "bob"
  );
  await setRuntimeSetting(
    "ghl.delivery_mode",
    "live_canary",
    { ...STAGING, clientAccountId: "client-123", subaccountIdGhl: "loc-abc" },
    "subaccount",
    "carol"
  );
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve?key=ghl.delivery_mode&environment=STAGING&clientAccountId=client-123&subaccountIdGhl=loc-abc",
    headers: { [HEADER]: ADMIN_KEY },
  });
  const body = res.json() as {
    resolved: Array<{ effectiveValue: string; resolvedFrom: string }>;
  };
  assert.equal(body.resolved[0].effectiveValue, "live_canary");
  assert.equal(body.resolved[0].resolvedFrom, "SUBACCOUNT");
  await app.close();
});

test("env fallback is represented as ENV_FALLBACK when no DB value", async () => {
  const prev = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  try {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/runtime-settings/resolve?key=ghl.delivery_mode&environment=STAGING",
      headers: { [HEADER]: ADMIN_KEY },
    });
    const body = res.json() as {
      resolved: Array<{ effectiveValue: string; resolvedFrom: string }>;
    };
    assert.equal(body.resolved[0].effectiveValue, "live_canary");
    assert.equal(body.resolved[0].resolvedFrom, "ENV_FALLBACK");
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.GHL_DELIVERY_ADAPTER_MODE;
    else process.env.GHL_DELIVERY_ADAPTER_MODE = prev;
  }
});

test("safe default is represented as SAFE_DEFAULT with no DB value and no env", async () => {
  const prev = process.env.GHL_DELIVERY_ADAPTER_MODE;
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  try {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/runtime-settings/resolve?key=ghl.delivery_mode&environment=STAGING",
      headers: { [HEADER]: ADMIN_KEY },
    });
    const body = res.json() as {
      resolved: Array<{ effectiveValue: string; resolvedFrom: string }>;
    };
    assert.equal(body.resolved[0].effectiveValue, "simulate");
    assert.equal(body.resolved[0].resolvedFrom, "SAFE_DEFAULT");
    await app.close();
  } finally {
    if (prev !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prev;
  }
});

test("sensitive values are redacted in list and resolve", async () => {
  await setRuntimeSetting(
    "backup_sheet_export.mode",
    "enabled",
    STAGING,
    "enable",
    "alice",
    { isSensitive: true }
  );
  const app = await buildApp();

  const listRes = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings?key=backup_sheet_export.mode&environment=STAGING",
    headers: { [HEADER]: ADMIN_KEY },
  });
  const listBody = listRes.json() as {
    keys: Array<{ configured: Array<{ value: string; isSensitive: boolean }> }>;
  };
  assert.equal(listBody.keys[0].configured[0].isSensitive, true);
  assert.equal(listBody.keys[0].configured[0].value, REDACTED_VALUE);
  assert.notEqual(listBody.keys[0].configured[0].value, "enabled");

  const resolveRes = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve?key=backup_sheet_export.mode&environment=STAGING",
    headers: { [HEADER]: ADMIN_KEY },
  });
  const resolveBody = resolveRes.json() as {
    resolved: Array<{ effectiveValue: string; isSensitive: boolean }>;
  };
  assert.equal(resolveBody.resolved[0].isSensitive, true);
  assert.equal(resolveBody.resolved[0].effectiveValue, REDACTED_VALUE);
  await app.close();
});

test("invalid key returns structured 400 (list)", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings?key=secrets.token",
    headers: { [HEADER]: ADMIN_KEY },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; code: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "INVALID_KEY");
  await app.close();
});

test("invalid key returns structured 400 (resolve)", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve?key=secrets.token",
    headers: { [HEADER]: ADMIN_KEY },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; code: string };
  assert.equal(body.code, "INVALID_KEY");
  await app.close();
});

test("resolve with no optional context resolves all keys to global/default", async () => {
  await setRuntimeSetting("meta.dispatch_mode", "simulate", STAGING, "ops", "alice");
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/runtime-settings/resolve?environment=STAGING",
    headers: { [HEADER]: ADMIN_KEY },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    resolved: Array<{ key: string; effectiveValue: string; resolvedFrom: string }>;
  };
  assert.equal(body.resolved.length, 4);
  const meta = body.resolved.find((r) => r.key === "meta.dispatch_mode")!;
  assert.equal(meta.effectiveValue, "simulate");
  assert.equal(meta.resolvedFrom, "GLOBAL");
  await app.close();
});
