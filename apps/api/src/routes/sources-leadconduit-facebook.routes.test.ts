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

test("LeadConduit Facebook webhook accepts authenticated payload", async () => {
  const prevSecret = process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
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
  if (prevSecret !== undefined) process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = prevSecret;
  else delete process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
});

test("LeadConduit Facebook webhook rejects invalid authentication", async () => {
  const prevSecret = process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
  process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadconduit/facebook-lead",
    headers: { "content-type": "application/json" },
    payload: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
    },
  });
  assert.equal(res.statusCode, 401);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.error, "Unauthorized");
  await app.close();
  if (prevSecret !== undefined) process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = prevSecret;
  else delete process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
});

test("LeadConduit Facebook webhook returns validation error for malformed payload", async () => {
  const prevSecret = process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
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
  if (prevSecret !== undefined) process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET = prevSecret;
  else delete process.env.SA360_LEADCONDUIT_WEBHOOK_SECRET;
});
