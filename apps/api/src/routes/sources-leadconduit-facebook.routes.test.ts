import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { sourcesLeadConduitFacebookRoutes } from "./sources-leadconduit-facebook.js";
import type { LeadConduitFacebookIntakeResult } from "../services/source-intake/leadconduit-facebook-intake.service.js";

const SECRET = "leadconduit-secret";

const intakeResult: LeadConduitFacebookIntakeResult = {
  ok: true,
  provider: "facebook",
  sourceSystem: "external_vendor",
  sourceLane: "leadconduit_facebook",
  sourceEventId: "sle_lc_001",
  status: "routing_matched",
  sourceRouteKey: "form_123",
  sourceLeadId: "leadgen_001",
  normalizedLeadUid: "leadconduit-facebook-leadgen_001",
  matched: true,
  matchedRuleId: "rule_123",
  destinationClientAccountId: "smart_agent_360_demo_2",
  destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
  routingDryRunDecisionId: "rdr_001",
  replayed: false,
  nextAction: "Review and approve delivery in Admin C.O.C.",
};

async function buildApp(
  processImpl: () => Promise<LeadConduitFacebookIntakeResult> = async () => intakeResult
) {
  const app = Fastify({ logger: false });
  await app.register(sourcesLeadConduitFacebookRoutes, {
    processLeadConduitFacebookIntakeImpl: processImpl,
  });
  return app;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("LeadConduit Facebook webhook rejects production request when secret missing", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_LEADCONDUIT_WEBHOOK_SECRET: process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET,
  };
  process.env.NODE_ENV = "production";
  delete process.env.SA360_ENV;
  delete process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
  let processCalls = 0;
  const app = await buildApp(async () => {
    processCalls += 1;
    return intakeResult;
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: {
      "content-type": "application/json",
    },
    payload: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
    },
  });
  assert.equal(res.statusCode, 503);
  assert.equal(processCalls, 0);
  const body = res.json() as { ok: boolean; error?: string; integration?: string; hint?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "integration_not_configured");
  assert.equal(body.integration, "leadconduit_facebook");
  assert.ok(body.hint?.includes("SA360_LEADCONDUIT_WEBHOOK_SECRET"));
  await app.close();
  restoreEnv(envSnapshot);
});

test("LeadConduit Facebook webhook rejects production request with wrong secret", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_LEADCONDUIT_WEBHOOK_SECRET: process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET,
  };
  process.env.NODE_ENV = "production";
  delete process.env.SA360_ENV;
  process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = SECRET;
  let processCalls = 0;
  const app = await buildApp(async () => {
    processCalls += 1;
    return intakeResult;
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: {
      "x-sa360-leadconduit-key": "wrong-secret",
      "content-type": "application/json",
    },
    payload: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
    },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(processCalls, 0);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.error, "Unauthorized");
  await app.close();
  restoreEnv(envSnapshot);
});

test("LeadConduit Facebook webhook accepts production request with valid header secret", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_LEADCONDUIT_WEBHOOK_SECRET: process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET,
  };
  process.env.NODE_ENV = "production";
  delete process.env.SA360_ENV;
  process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: {
      "x-sa360-leadconduit-key": SECRET,
      "content-type": "application/json",
    },
    payload: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
      form_id: "form_123",
      trustedform_cert_url: "https://cert.trustedform.com/abc123",
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; sourceLane: string; replayed: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.sourceLane, "leadconduit_facebook");
  assert.equal(body.replayed, false);
  await app.close();
  restoreEnv(envSnapshot);
});

test("LeadConduit Facebook webhook accepts production request with valid basic auth", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_LEADCONDUIT_WEBHOOK_SECRET: process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET,
    SA360_LEADCONDUIT_BASIC_AUTH_USERNAME: process.env.SA360_LEADCONDUIT_BASIC_AUTH_USERNAME,
  };
  process.env.NODE_ENV = "production";
  delete process.env.SA360_ENV;
  process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = SECRET;
  process.env.SA360_LEADCONDUIT_BASIC_AUTH_USERNAME = "sa360-leadconduit";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: {
      authorization: basicAuth("sa360-leadconduit", SECRET),
      "content-type": "application/json",
    },
    payload: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
      form_id: "form_123",
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; sourceLane: string };
  assert.equal(body.ok, true);
  assert.equal(body.sourceLane, "leadconduit_facebook");
  await app.close();
  restoreEnv(envSnapshot);
});

test("LeadConduit Facebook webhook keeps dev/test permissive mode explicit", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_LEADCONDUIT_WEBHOOK_SECRET: process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET,
  };
  process.env.NODE_ENV = "test";
  delete process.env.SA360_ENV;
  delete process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: {
      "content-type": "application/json",
    },
    payload: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
      form_id: "form_123",
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; devWarning?: string };
  assert.equal(body.ok, true);
  assert.ok(body.devWarning?.includes("dev only"));
  await app.close();
  restoreEnv(envSnapshot);
});

test("LeadConduit Facebook webhook returns validation error for malformed payload", async () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SA360_ENV: process.env.SA360_ENV,
    SA360_LEADCONDUIT_WEBHOOK_SECRET: process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET,
  };
  process.env.NODE_ENV = "production";
  delete process.env.SA360_ENV;
  process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: {
      "x-sa360-leadconduit-key": SECRET,
      "content-type": "application/json",
    },
    payload: {
      foo: "bar",
    },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.error, "invalid_payload");
  await app.close();
  restoreEnv(envSnapshot);
});
