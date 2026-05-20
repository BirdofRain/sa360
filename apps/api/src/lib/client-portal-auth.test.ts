import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  getClientPortalApiKey,
  getClientPortalTenantConfig,
  verifyClientPortalApiKey,
  CLIENT_PORTAL_KEY_HEADER,
} from "./client-portal-auth.js";

test("getClientPortalApiKey returns undefined when unset", () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.CLIENT_PORTAL_API_KEY;
  assert.equal(getClientPortalApiKey(), undefined);
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
});

test("getClientPortalTenantConfig requires CLIENT_PORTAL_CLIENT_ACCOUNT_ID", () => {
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  const prevS = process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL;
  delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  delete process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL;
  assert.equal(getClientPortalTenantConfig(), null);
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_env_test";
  process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL = "loc_env_test";
  assert.deepEqual(getClientPortalTenantConfig(), {
    clientAccountId: "acct_env_test",
    subaccountIdGhl: "loc_env_test",
  });
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL = prevS;
  else delete process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL;
});

test("verifyClientPortalApiKey rejects missing key with 401", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_test";
  const app = Fastify({ logger: false });
  app.get("/probe", async (request, reply) => {
    const ok = await verifyClientPortalApiKey(request, reply);
    return ok ? { ok: true } : null;
  });
  const res = await app.inject({ method: "GET", url: "/probe" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("verifyClientPortalApiKey accepts valid key", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_test";
  const app = Fastify({ logger: false });
  app.get("/probe", async (request, reply) => {
    const ok = await verifyClientPortalApiKey(request, reply);
    return ok ? { ok: true } : null;
  });
  const res = await app.inject({
    method: "GET",
    url: "/probe",
    headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});
