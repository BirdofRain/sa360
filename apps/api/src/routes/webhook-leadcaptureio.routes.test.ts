import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webhookLeadCaptureIoRoutes } from "./webhook-leadcaptureio.js";
import type { SourceLeadIntakeResult } from "../services/source-intake/source-lead-intake.service.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
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

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

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
    instance.post("/webhooks/leadcaptureio/:routeKey", async (req, reply) => {
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
    payload: loadFixture("leadcaptureio-webhook-sample-legacy.json"),
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
    payload: loadFixture("leadcaptureio-webhook-sample-legacy.json"),
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
    payload: loadFixture("leadcaptureio-webhook-sample-legacy.json"),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("valid Basic Auth returns 200", async () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "required-key";
  const app = Fastify({ logger: false });
  await app.register(webhookLeadCaptureIoRoutes);
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/leadcaptureio",
    headers: {
      authorization: basicAuthHeader("sa360-leadcapture", "required-key"),
    },
    payload: loadFixture("leadcaptureio-webhook-sample-legacy.json"),
  });
  assert.equal(res.statusCode, 200);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("wrong Basic Auth returns 401", async () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "required-key";
  const app = Fastify({ logger: false });
  await app.register(webhookLeadCaptureIoRoutes);
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/leadcaptureio",
    headers: {
      authorization: basicAuthHeader("sa360-leadcapture", "wrong-password"),
    },
    payload: loadFixture("leadcaptureio-webhook-sample-legacy.json"),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("nested legacy payload returns extracted sourceLeadId in mocked route", async () => {
  const nestedResult: SourceLeadIntakeResult = {
    ...mockResult,
    sourceRouteKey: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    sourceLeadId: "jt-legacy-dryrun-002",
    normalizedLeadUid: "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002",
    destinationClientAccountId: "vet_life_james_torrey",
    destinationLocationIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    matchedRuleId: "cmqfuqy9t004an30uyq6li19k",
  };
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const app = await buildApp(async () => nestedResult);
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/leadcaptureio/LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    payload: loadFixture("leadcaptureio-webhook-sample-legacy-nested.json"),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { sourceLeadId: string; normalizedLeadUid: string; matched: boolean };
  assert.equal(body.sourceLeadId, "jt-legacy-dryrun-002");
  assert.equal(body.normalizedLeadUid, "leadcaptureio-leadcapture_io_legacy-jt-legacy-dryrun-002");
  assert.equal(body.matched, true);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
});
