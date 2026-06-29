import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { sourcesGoogleSheetRoutes } from "./sources-google-sheet.js";
import type { GoogleSheetLeadIntakeResult } from "../services/source-intake/google-sheet-lead-intake.service.js";

const SECRET = "gsheet-test-secret";

const intakeResult: GoogleSheetLeadIntakeResult = {
  ok: true,
  provider: "google_sheets",
  sourceEventId: "evt_gs_1",
  status: "routing_matched",
  sourceRouteKey: "campaign_123",
  normalizedLeadUid: "google-sheet-google_sheet_import-abc123",
  eventUuid: "GSHEET-google-sheet-google_sheet_import-abc123",
  lifecycleEventStored: true,
  attributionUpserted: true,
  contactIndexUpserted: true,
  matched: true,
  matchedRule: {
    ruleId: "rule_1",
    destinationClientAccountId: "sa360_demo",
    destinationLocationIdGhl: "loc_demo",
    matchType: "campaign_id",
    reason: "Matched routing rule (campaign_id) -> SA360 Demo",
  },
  routingDryRunDecisionId: "dec_1",
  deliveryMode: "shadow",
  deliveryPlanId: "plan_1",
  liveDeliverySuppressed: false,
  nextAction: "Review and approve simulation in Admin C.O.C. (Google Sheet cutover rehearsal).",
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "MASTER 2.0",
    client_account_id: "lal_master_demo",
    contact: {
      lead_uid: "GS-LEAD-0001",
      first_name: "Dana",
      last_name: "Sheets",
      email: "dana@example.test",
      phone: "+14155550199",
      state: "NC",
    },
    attribution: { source_platform: "google_sheets", campaign_id: "campaign_123" },
    state: { lifecycle_stage: "NEW" },
    event: { event_name_meta: "Lead" },
    ownership: { updated_by: "apps_script" },
    routing: { routing_mode: "shadow" },
    rehearsal: { rehearsal_id: "reh_1", source_row_number: 2, dry_run: true },
    raw: { row: ["Dana", "Sheets"] },
    ...overrides,
  };
}

async function buildApp(
  processImpl: () => Promise<GoogleSheetLeadIntakeResult> = async () => intakeResult
) {
  const app = Fastify({ logger: false });
  await app.register(sourcesGoogleSheetRoutes, {
    processGoogleSheetSourceLeadImpl: processImpl,
  });
  return app;
}

test("returns 401 when X-SA360-Secret missing", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/google-sheet/lead-created",
    payload: validPayload(),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  else delete process.env.WEBHOOK_SECRET;
});

test("returns 401 when X-SA360-Secret is wrong", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/google-sheet/lead-created",
    headers: { "x-sa360-secret": "nope" },
    payload: validPayload(),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  else delete process.env.WEBHOOK_SECRET;
});

test("returns 400 on invalid payload (missing client_account_id)", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const { client_account_id: _omit, ...rest } = validPayload();
  const res = await app.inject({
    method: "POST",
    url: "/sources/google-sheet/lead-created",
    headers: { "x-sa360-secret": SECRET },
    payload: rest,
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "Invalid payload");
  await app.close();
  if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  else delete process.env.WEBHOOK_SECRET;
});

test("authorized valid payload returns structured shadow result", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  let captured: unknown = null;
  const app = await buildApp(async () => {
    captured = true;
    return intakeResult;
  });
  const res = await app.inject({
    method: "POST",
    url: "/sources/google-sheet/lead-created",
    headers: { "x-sa360-secret": SECRET },
    payload: validPayload(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    ok: boolean;
    matched: boolean;
    deliveryMode: string;
    deliveryPlanId: string;
    matchedRule: { ruleId: string };
    status: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.matched, true);
  assert.equal(body.deliveryMode, "shadow");
  assert.equal(body.deliveryPlanId, "plan_1");
  assert.equal(body.matchedRule.ruleId, "rule_1");
  assert.equal(body.status, "routing_matched");
  assert.equal(captured, true);
  await app.close();
  if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  else delete process.env.WEBHOOK_SECRET;
});

test("response does not echo the shared secret", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/sources/google-sheet/lead-created",
    headers: { "x-sa360-secret": SECRET },
    payload: validPayload(),
  });
  assert.doesNotMatch(res.body, new RegExp(SECRET));
  await app.close();
  if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  else delete process.env.WEBHOOK_SECRET;
});
