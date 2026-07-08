import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { sourcesFacebookRoutes } from "./sources-facebook.js";
import type { MetaWebhookConfig } from "../lib/meta-webhook.js";
import type { FacebookLeadIntakeResult } from "../services/source-intake/facebook-lead-intake.service.js";

function config(overrides: Partial<MetaWebhookConfig> = {}): MetaWebhookConfig {
  return {
    verifyToken: "vt-123",
    appSecret: null,
    accessToken: "tok",
    graphApiVersion: "v22.0",
    masterClientAccountId: "lal_master_vet",
    directIntakeEnabled: false,
    ...overrides,
  };
}

const intakeResult: FacebookLeadIntakeResult = {
  ok: true,
  provider: "facebook",
  sourceEventId: "evt_fb_1",
  status: "routing_matched",
  sourceRouteKey: "form_9",
  leadgenId: "lead_001",
  normalizedLeadUid: "facebook-meta_lead_ads-lead_001",
  matched: true,
  matchedRuleId: "rule_1",
  destinationClientAccountId: "sa360_demo",
  destinationLocationIdGhl: "loc_demo",
  routingDryRunDecisionId: "dec_1",
  nextAction: "Review and approve simulation in Admin C.O.C. (source-intake).",
};

async function buildApp(
  cfg: MetaWebhookConfig,
  processImpl: () => Promise<FacebookLeadIntakeResult> = async () => intakeResult
) {
  const app = Fastify({ logger: false });
  await app.register(sourcesFacebookRoutes, {
    getMetaWebhookConfigImpl: () => cfg,
    processFacebookSourceLeadImpl: processImpl,
    fetchMetaLeadDetailsImpl: async () => ({
      ok: true,
      status: 200,
      body: { id: "lead_001", campaign_id: "120243339037000760", field_data: [] },
    }),
  });
  return app;
}

test("GET verify echoes hub.challenge on valid token", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "GET",
    url: "/sources/facebook/lead-created?hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=987654",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "987654");
  await app.close();
});

test("GET verify returns 403 on bad token", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "GET",
    url: "/sources/facebook/lead-created?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=987654",
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("POST with invalid JSON body logs failure and does not crash", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "POST",
    url: "/sources/facebook/lead-created",
    headers: { "content-type": "application/json" },
    payload: "{ this is not valid json",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_payload");
  await app.close();
});

test("POST returns 401 when signature missing but app secret configured", async () => {
  const app = await buildApp(config({ appSecret: "s3cr3t" }));
  const res = await app.inject({
    method: "POST",
    url: "/sources/facebook/lead-created",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ entry: [] }),
  });
  assert.equal(res.statusCode, 401);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.error, "invalid_signature");
  await app.close();
});

test("POST returns 503 when META_APP_SECRET is missing in production", async () => {
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "production";

  const app = await buildApp(config({ appSecret: null }));
  const res = await app.inject({
    method: "POST",
    url: "/sources/facebook/lead-created",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ entry: [] }),
  });

  assert.equal(res.statusCode, 503);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "integration_not_configured");
  await app.close();

  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("POST with no leadgen changes acknowledges with processed=0", async () => {
  const app = await buildApp(config({ directIntakeEnabled: true }));
  const res = await app.inject({
    method: "POST",
    url: "/sources/facebook/lead-created",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ object: "page", entry: [{ id: "p1", changes: [] }] }),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; processed: number };
  assert.equal(body.ok, true);
  assert.equal(body.processed, 0);
  await app.close();
});

test("test-lead endpoint runs normalize->match via injected intake", async () => {
  let captured: unknown = null;
  const app = await buildApp(config(), async () => {
    captured = true;
    return intakeResult;
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/facebook/test-lead",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      leadgen_id: "lead_001",
      campaign_id: "120243339037000760",
      first_name: "Jane",
      phone_number: "+14155550100",
    }),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as FacebookLeadIntakeResult;
  assert.equal(body.provider, "facebook");
  assert.equal(body.matched, true);
  assert.equal(captured, true);
  await app.close();
});

test("test-lead endpoint rejects non-object bodies with 400", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "POST",
    url: "/sources/facebook/test-lead",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify("just a string"),
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
