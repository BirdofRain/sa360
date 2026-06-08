import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../lib/ghl-delivery-adapter-mode.js";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
} from "../lib/direct-demo-delivery-config.js";
import type { DirectDemoDeliveryBody } from "../schemas/lead-delivery-direct-demo.schema.js";
import {
  adminLeadDeliveryDirectDemoRoutes,
  type AdminLeadDeliveryDirectDemoRoutesOptions,
} from "./admin-lead-delivery-direct-demo.js";
import type { DirectDemoDeliveryResult } from "../services/lead-delivery/direct-demo-delivery.service.js";

const HEADER = "x-sa360-admin-key";
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sa360-demo-lead-created.json"
);

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

async function buildApp(
  impl: NonNullable<AdminLeadDeliveryDirectDemoRoutesOptions["runDirectDemoDeliveryImpl"]>
) {
  const app = Fastify({ logger: false });
  await app.register(adminLeadDeliveryDirectDemoRoutes, {
    prefix: "/admin/v1",
    runDirectDemoDeliveryImpl: impl,
  });
  return app;
}

test("POST /admin/v1/lead-delivery/direct-demo → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp(async () => ({
    ok: true,
    mode: "simulate",
    matched: true,
    destinationClientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
    destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
    routingDryRunDecisionId: "dec_1",
    deliveryPlanId: "plan_1",
    adapterRunId: null,
    liveRunId: null,
    externalCallExecuted: false,
    summary: "ok",
    blockers: [],
    warnings: [],
    nextAction: "done",
    matchedRuleId: null,
    duplicateRisk: null,
    readiness: null,
    deliveryPlanStatus: "planned",
    adapterMode: "simulate",
  }));
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-delivery/direct-demo",
    payload: { payload: loadFixture(), mode: "simulate" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/lead-delivery/direct-demo → 400 on malformed body", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp(async () => ({
    ok: true,
    mode: "simulate",
    matched: true,
    destinationClientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
    destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
    routingDryRunDecisionId: "dec_1",
    deliveryPlanId: "plan_1",
    adapterRunId: null,
    liveRunId: null,
    externalCallExecuted: false,
    summary: "ok",
    blockers: [],
    warnings: [],
    nextAction: "done",
    matchedRuleId: null,
    duplicateRisk: null,
    readiness: null,
    deliveryPlanStatus: "planned",
    adapterMode: "simulate",
  }));
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-delivery/direct-demo",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { mode: "simulate" },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/lead-delivery/direct-demo → simulate orchestration success", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp(async (body: DirectDemoDeliveryBody) => ({
    ok: true,
    mode: body.mode,
    matched: true,
    destinationClientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
    destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
    routingDryRunDecisionId: "dec_sim",
    deliveryPlanId: "plan_sim",
    adapterRunId: "adapter_sim",
    liveRunId: null,
    externalCallExecuted: false,
    summary: "Simulation complete",
    blockers: [],
    warnings: [],
    nextAction: "Review simulation",
    matchedRuleId: "rule_1",
    duplicateRisk: null,
    readiness: null,
    deliveryPlanStatus: "planned",
    adapterMode: "simulate",
  }));
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-delivery/direct-demo",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { payload: loadFixture(), mode: "simulate" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { ok: boolean; externalCallExecuted: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.externalCallExecuted, false);
  const text = res.body.toLowerCase();
  assert.ok(!text.includes("token"));
  assert.ok(!text.includes("secret"));
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/lead-delivery/direct-demo → live blocked response", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp(async () => ({
    ok: false,
    error: "delivery_blocked",
    reason: "confirm blocked",
    mode: "live_canary",
    matched: false,
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    routingDryRunDecisionId: null,
    deliveryPlanId: null,
    adapterRunId: null,
    liveRunId: null,
    externalCallExecuted: false,
    blockers: [`operatorConfirmationText must be exactly "${LIVE_CANARY_CONFIRMATION_TEXT}".`],
    warnings: [],
    nextAction: "Confirm",
  }));
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-delivery/direct-demo",
    headers: { [HEADER]: "admin-secret", "content-type": "application/json" },
    payload: {
      payload: loadFixture(),
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: "NOPE",
    },
  });
  assert.equal(res.statusCode, 409);
  const body = res.json() as { ok: boolean; blockers: string[] };
  assert.equal(body.ok, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
