import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sourcesLeadCaptureNextGenRoutes } from "./sources-leadcapture-nextgen.js";
import type { LeadCaptureNextGenIntakeResult } from "../services/source-intake/leadcapture-nextgen-intake.service.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/leadcaptureio");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

const mockResult: LeadCaptureNextGenIntakeResult = {
  ok: true,
  provider: "leadcapture_io",
  sourceSystem: "leadcapture_io_nextgen",
  sourceEventId: "evt_nextgen_1",
  status: "received",
  sourceRouteKey: "LC_VET_FEX_TEST",
  sourceLeadId: "11111111-2222-4333-8444-555555555555",
  normalizedLeadUid: "leadcaptureio-leadcapture_io_nextgen-11111111-2222-4333-8444-555555555555",
  duplicate: false,
  matched: false,
  intakeStage: "capture_only",
  shadowOutboxEnsured: false,
  nextAction: "Stage A capture-only",
};

test("Next-Gen route accepts fixture with auth header", async () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = "ng-secret";
  const app = Fastify({ logger: false });
  await app.register(sourcesLeadCaptureNextGenRoutes, {
    processLeadCaptureNextGenLeadCreatedImpl: async () => mockResult,
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadcapture/nextgen/lead-created",
    headers: { "x-sa360-leadcapture-nextgen-key": "ng-secret" },
    payload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    ok: boolean;
    sourceSystem: string;
    intakeStage: string;
    duplicate: boolean;
  };
  assert.equal(body.ok, true);
  assert.equal(body.sourceSystem, "leadcapture_io_nextgen");
  assert.equal(body.intakeStage, "capture_only");
  assert.equal(body.duplicate, false);
  assert.doesNotMatch(res.body, /ng-secret/);
  assert.doesNotMatch(res.body, /jordan\.veteran/i);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
});

test("Next-Gen route rejects missing auth when secret configured", async () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "development";
  process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = "ng-secret";
  const app = Fastify({ logger: false });
  await app.register(sourcesLeadCaptureNextGenRoutes, {
    processLeadCaptureNextGenLeadCreatedImpl: async () => mockResult,
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadcapture/nextgen/lead-created",
    payload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("Next-Gen route rejects non-UUID lead_id", async () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = "ng-secret";
  const app = Fastify({ logger: false });
  await app.register(sourcesLeadCaptureNextGenRoutes, {
    processLeadCaptureNextGenLeadCreatedImpl: async () => mockResult,
  });
  const payload = {
    ...loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
    lead_id: "12345",
  };
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadcapture/nextgen/lead-created",
    headers: { "x-sa360-leadcapture-nextgen-key": "ng-secret" },
    payload,
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_payload");
  await app.close();
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
});

test("Next-Gen route returns 503 in production without secret", async () => {
  const prevSecret = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  const prevEnv = process.env.SA360_ENV;
  delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_ENV = "production";
  const app = Fastify({ logger: false });
  await app.register(sourcesLeadCaptureNextGenRoutes, {
    processLeadCaptureNextGenLeadCreatedImpl: async () => mockResult,
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/leadcapture/nextgen/lead-created",
    payload: loadFixture("leadcaptureio-webhook-sample-nextgen.json"),
  });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prevSecret !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prevSecret;
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});
