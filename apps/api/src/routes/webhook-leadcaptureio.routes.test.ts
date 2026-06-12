import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webhookLeadCaptureIoRoutes } from "./webhook-leadcaptureio.js";
import type { SourceLeadIntakeResult } from "../services/source-intake/source-lead-intake.service.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy.json"
);

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

const mockResult: SourceLeadIntakeResult = {
  ok: true,
  provider: "leadcapture_io",
  sourceEventId: "evt_test_1",
  status: "routing_matched",
  sourceRouteKey: "LC_VET_FEX_TEST",
  sourceLeadId: "lc_demo_legacy_001",
  normalizedLeadUid: "leadcaptureio-leadcapture_io_legacy-lc_demo_legacy_001",
  matched: true,
  matchedRuleId: "rule_1",
  destinationClientAccountId: "smart_agent_360_demo",
  destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
  nextAction: "Review and approve delivery in Admin C.O.C.",
};

async function buildApp(
  processImpl: () => Promise<SourceLeadIntakeResult> = async () => mockResult
) {
  const app = Fastify({ logger: false });
  await app.register(async (instance) => {
    instance.post("/webhooks/leadcaptureio", async (req, reply) => {
      const result = await processImpl();
      return reply.send({
        ok: true,
        provider: result.provider,
        sourceEventId: result.sourceEventId,
        status: result.status,
        sourceRouteKey: result.sourceRouteKey,
        sourceLeadId: result.sourceLeadId,
        normalizedLeadUid: result.normalizedLeadUid,
        matched: result.matched,
        matchedRuleId: result.matchedRuleId ?? null,
        destinationClientAccountId: result.destinationClientAccountId ?? null,
        destinationLocationIdGhl: result.destinationLocationIdGhl ?? null,
        nextAction: result.nextAction,
      });
    });
  });
  return app;
}

test("LeadCapture.io webhook accepts valid legacy JSON payload shape", async () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/leadcaptureio",
    payload: loadFixture(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; provider: string; matched: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.provider, "leadcapture_io");
  assert.equal(body.matched, true);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
});

test("webhook response does not include secrets", async () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "super-secret-key";
  const app = Fastify({ logger: false });
  await app.register(webhookLeadCaptureIoRoutes);
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/leadcaptureio",
    headers: { "x-sa360-leadcapture-key": "super-secret-key" },
    payload: loadFixture(),
  });
  const text = res.body;
  assert.doesNotMatch(text, /super-secret-key/);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("secret missing returns 401 when env is set", async () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "required-key";
  const app = Fastify({ logger: false });
  await app.register(webhookLeadCaptureIoRoutes);
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/leadcaptureio",
    payload: loadFixture(),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});
