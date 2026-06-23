import test, { after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { webhookRoutes, type WebhookRoutesDeps } from "./webhook.js";
import { redis } from "../lib/redis.js";

const SECRET = "test-webhook-secret";

// webhook.ts transitively constructs a BullMQ queue (ioredis) at import time.
// Release that connection so the test process can exit cleanly.
after(() => {
  redis.disconnect();
});

function leadCreatedPayload(
  overrides: { event_name_internal?: string; event_uuid?: string } = {}
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    client_account_id: "lal_master_vet",
    contact: {
      lead_uid: "LAL-TEST-0001",
      first_name: "Test",
      last_name: "Lead",
      email: "test.lead@example.test",
      phone_e164: "+15555550123",
      state: "NC",
      zip: "27513",
    },
    attribution: {
      source_platform: "facebook",
      campaign_id: "camp_test_001",
      ad_id: "ad_test_001",
    },
    state: {
      lead_type: "Final Expense",
      lifecycle_stage: "New Lead",
    },
    event: {
      event_uuid: overrides.event_uuid ?? `evt_test_${Date.now()}_${Math.random()}`,
      event_name_internal: overrides.event_name_internal ?? "lead_created",
      event_name_meta: "Lead",
      event_time_unix: Math.floor(Date.now() / 1000),
      send_to_meta: false,
    },
    ownership: {
      assigned_agent_id: "agent_test",
      assigned_agent_name: "Test Agent",
      updated_by: "route_test",
    },
  };
}

type Tracker = {
  saveCalls: number;
  dryRunCalls: number;
};

function buildDeps(
  tracker: Tracker,
  overrides: Partial<WebhookRoutesDeps> = {}
): Partial<WebhookRoutesDeps> {
  return {
    startLog: async () => ({ id: "log_test_1", receivedAt: new Date() }),
    completeLog: async () => {},
    lifecycleEventExists: async () => false,
    saveLifecycleEvent: async () => {
      tracker.saveCalls += 1;
      return undefined as never;
    },
    upsertLeadAttribution: async () => undefined as never,
    upsertFromLifecyclePayload: async () => true,
    runRoutingDryRun: async () => {
      tracker.dryRunCalls += 1;
      return {
        decisionId: "dec_test_1",
        matched: true,
        confidence: "high",
        reason: "test",
        destinationClientAccountId: "smart_agent_360_demo",
        destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
        matchedRuleId: "rule_test_1",
        deliveryMode: "dry_run",
        routingEventNameInternal: "lead_matched",
        lifecycleEventsEmitted: [],
      } as Awaited<ReturnType<WebhookRoutesDeps["runRoutingDryRun"]>>;
    },
    evaluateOrphanAppointmentFromPayload: async () => null,
    enqueueMetaDispatch: (async () =>
      undefined) as unknown as WebhookRoutesDeps["enqueueMetaDispatch"],
    ...overrides,
  };
}

async function buildApp(deps: Partial<WebhookRoutesDeps>) {
  const app = Fastify({ logger: false });
  await app.register(webhookRoutes, { deps });
  return app;
}

function withSecret(value: string | undefined): () => void {
  const prev = process.env.WEBHOOK_SECRET;
  if (value === undefined) delete process.env.WEBHOOK_SECRET;
  else process.env.WEBHOOK_SECRET = value;
  return () => {
    if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
    else delete process.env.WEBHOOK_SECRET;
  };
}

test("lifecycle webhook → 401 when secret missing, no lifecycle save", async () => {
  const restore = withSecret(SECRET);
  const tracker: Tracker = { saveCalls: 0, dryRunCalls: 0 };
  const app = await buildApp(buildDeps(tracker));
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/ghl/lifecycle-event",
    payload: leadCreatedPayload(),
  });
  assert.equal(res.statusCode, 401);
  assert.equal(tracker.saveCalls, 0);
  assert.equal(tracker.dryRunCalls, 0);
  await app.close();
  restore();
});

test("lifecycle webhook → 400 on invalid payload", async () => {
  const restore = withSecret(SECRET);
  const tracker: Tracker = { saveCalls: 0, dryRunCalls: 0 };
  const app = await buildApp(buildDeps(tracker));
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/ghl/lifecycle-event",
    headers: { "x-sa360-secret": SECRET, "content-type": "application/json" },
    payload: { not: "a valid lifecycle event" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(tracker.saveCalls, 0);
  assert.equal(tracker.dryRunCalls, 0);
  await app.close();
  restore();
});

test("lifecycle webhook → stores non-lead_created event without running dry-run", async () => {
  const restore = withSecret(SECRET);
  const tracker: Tracker = { saveCalls: 0, dryRunCalls: 0 };
  const app = await buildApp(buildDeps(tracker));
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/ghl/lifecycle-event",
    headers: { "x-sa360-secret": SECRET, "content-type": "application/json" },
    payload: leadCreatedPayload({ event_name_internal: "appointment_set" }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(tracker.saveCalls, 1);
  assert.equal(tracker.dryRunCalls, 0);
  await app.close();
  restore();
});

test("lifecycle webhook → lead_created stores event and triggers routing dry-run", async () => {
  const restore = withSecret(SECRET);
  const tracker: Tracker = { saveCalls: 0, dryRunCalls: 0 };
  const app = await buildApp(buildDeps(tracker));
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/ghl/lifecycle-event",
    headers: { "x-sa360-secret": SECRET, "content-type": "application/json" },
    payload: leadCreatedPayload({ event_name_internal: "lead_created" }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(tracker.saveCalls, 1);
  assert.equal(tracker.dryRunCalls, 1);
  const body = res.json() as { ok: boolean };
  assert.equal(body.ok, true);
  await app.close();
  restore();
});

test("lifecycle webhook → dry-run failure does not fail the webhook", async () => {
  const restore = withSecret(SECRET);
  const tracker: Tracker = { saveCalls: 0, dryRunCalls: 0 };
  const app = await buildApp(
    buildDeps(tracker, {
      runRoutingDryRun: async () => {
        throw new Error("dry-run boom");
      },
    })
  );
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/ghl/lifecycle-event",
    headers: { "x-sa360-secret": SECRET, "content-type": "application/json" },
    payload: leadCreatedPayload({ event_name_internal: "lead_created" }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(tracker.saveCalls, 1);
  const body = res.json() as { ok: boolean };
  assert.equal(body.ok, true);
  await app.close();
  restore();
});
