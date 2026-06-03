import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { integrationsGhlRoutes } from "./routes/integrations-ghl.js";
import { clearGhlOAuthDebugForTests } from "./services/ghl-oauth/ghl-oauth-debug.service.js";

/** Same plugin + prefix as `buildApp()` in app.ts: `register(integrationsGhlRoutes, { prefix: "/integrations" })`. */
async function registerIntegrationsRoutes(app: ReturnType<typeof Fastify>) {
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
}

test("GET /integrations/oauth/callback is registered (app.ts integrations plugin, not 404)", async () => {
  const prevCoc = process.env.ADMIN_COC_BASE_URL;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await registerIntegrationsRoutes(app);
  const res = await app.inject({
    method: "GET",
    url: "/integrations/oauth/callback",
  });

  assert.notEqual(res.statusCode, 404);
  assert.equal(res.statusCode, 302);
  const location = res.headers.location as string;
  assert.match(location, /ghl_oauth=error/);
  assert.match(location, /reason=missing_code_or_state/);

  await app.close();
  clearGhlOAuthDebugForTests();
  if (prevCoc !== undefined) process.env.ADMIN_COC_BASE_URL = prevCoc;
  else delete process.env.ADMIN_COC_BASE_URL;
});

test("GET /integrations/ghl/oauth/callback alias is registered (not 404)", async () => {
  const prevCoc = process.env.ADMIN_COC_BASE_URL;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";
  clearGhlOAuthDebugForTests();

  const app = Fastify({ logger: false });
  await registerIntegrationsRoutes(app);
  const res = await app.inject({
    method: "GET",
    url: "/integrations/ghl/oauth/callback",
  });

  assert.notEqual(res.statusCode, 404);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location as string, /reason=missing_code_or_state/);

  await app.close();
  clearGhlOAuthDebugForTests();
  if (prevCoc !== undefined) process.env.ADMIN_COC_BASE_URL = prevCoc;
  else delete process.env.ADMIN_COC_BASE_URL;
});
