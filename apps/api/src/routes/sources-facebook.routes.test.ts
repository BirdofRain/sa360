import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import {
  FACEBOOK_LEAD_CREATED_ROUTE,
  FACEBOOK_TEST_LEAD_ROUTE,
  META_LEADGEN_ROUTE,
  sourcesFacebookRoutes,
} from "./sources-facebook.js";
import type { MetaWebhookConfig } from "../lib/meta-webhook.js";
import type { CompleteLogInput, StartLogInput } from "../services/webhook-request-log.service.js";
import type { FacebookLeadIntakeResult } from "../services/source-intake/facebook-lead-intake.service.js";
import type { FacebookLeadReplayRow } from "../services/source-intake/facebook-lead-intake.service.js";

function config(overrides: Partial<MetaWebhookConfig> = {}): MetaWebhookConfig {
  const intakeEnabled = overrides.intakeEnabled ?? overrides.directIntakeEnabled ?? false;
  const graphFetchEnabled = overrides.graphFetchEnabled ?? overrides.directIntakeEnabled ?? false;
  const routingEnabled = overrides.routingEnabled ?? overrides.directIntakeEnabled ?? false;
  return {
    verifyToken: "vt-123",
    appSecret: null,
    accessToken: "tok",
    graphApiVersion: "v22.0",
    masterClientAccountId: "lal_master_vet",
    directIntakeEnabled: intakeEnabled,
    intakeEnabled,
    graphFetchEnabled,
    routingEnabled,
    fixtureEnabled: true,
    ...overrides,
    intakeEnabled: overrides.intakeEnabled ?? overrides.directIntakeEnabled ?? false,
    graphFetchEnabled: overrides.graphFetchEnabled ?? overrides.directIntakeEnabled ?? false,
    routingEnabled: overrides.routingEnabled ?? overrides.directIntakeEnabled ?? false,
    fixtureEnabled: overrides.fixtureEnabled ?? true,
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
  replayed: false,
};

function leadgenPayload(leadgenId = "lead_001") {
  return {
    object: "page",
    entry: [
      {
        id: "page_1",
        time: 1_710_000_000,
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: leadgenId,
              form_id: "form_9",
              ad_id: "ad_1",
              created_time: 1_710_000_000,
            },
          },
        ],
      },
    ],
  };
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

type CapturedLog = { start: StartLogInput; complete?: CompleteLogInput; handleId: string };

async function buildApp(
  cfg: MetaWebhookConfig,
  extras: {
    processImpl?: () => Promise<FacebookLeadIntakeResult>;
    fetchImpl?: () => Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }>;
    findReplayImpl?: (leadgenId: string) => Promise<FacebookLeadReplayRow | null>;
    logs?: CapturedLog[];
  } = {}
) {
  const app = Fastify({ logger: false });
  const logs = extras.logs;
  await app.register(sourcesFacebookRoutes, {
    getMetaWebhookConfigImpl: () => cfg,
    processFacebookSourceLeadImpl: extras.processImpl ?? (async () => intakeResult),
    fetchMetaLeadDetailsImpl:
      extras.fetchImpl ??
      (async () => ({
        ok: true,
        status: 200,
        body: { id: "lead_001", campaign_id: "120243339037000760", field_data: [] },
      })),
    findFacebookLeadReplayImpl: extras.findReplayImpl ?? (async () => null),
    claimFacebookLeadgenImpl: async (data) => ({
      event: {
        id: "evt_claimed",
        sourceLeadId: typeof data.sourceLeadId === "string" ? data.sourceLeadId : "lead_001",
        status: "received",
        sourceRouteKey: data.sourceRouteKey ?? "form_9",
        sourceLeadUid: "facebook-meta_lead_ads-lead_001",
        normalizedAt: null,
        routingDryRunDecisionId: null,
        routingRuleIdResolved: null,
        clientAccountIdResolved: null,
        destinationLocationIdResolved: null,
        errorSummary: null,
      } as never,
      created: true,
    }),
    startLogImpl: logs
      ? async (input) => {
          const handle = { id: `log_${logs.length + 1}`, receivedAt: new Date() };
          logs.push({ start: input, handleId: handle.id });
          return handle;
        }
      : async () => null,
    completeLogImpl: logs
      ? async (handle, input) => {
          const row = logs.find((l) => l.handleId === handle?.id) ?? logs[logs.length - 1];
          if (row) row.complete = input;
        }
      : async () => undefined,
  });
  return app;
}

test("GET verify echoes hub.challenge on valid token", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "GET",
    url: `${FACEBOOK_LEAD_CREATED_ROUTE}?hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=987654`,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "987654");
  await app.close();
});

test("GET /webhooks/meta/leadgen echoes hub.challenge on valid token", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "GET",
    url: `${META_LEADGEN_ROUTE}?hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=echo-alias`,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "echo-alias");
  await app.close();
});

test("GET verify returns 403 on bad token", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "GET",
    url: `${FACEBOOK_LEAD_CREATED_ROUTE}?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=987654`,
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("GET /webhooks/meta/leadgen returns 403 on invalid verify token", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "GET",
    url: `${META_LEADGEN_ROUTE}?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=987654`,
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("GET handshake_ok and handshake_denied are logged without the verify token", async () => {
  const logs: CapturedLog[] = [];
  const app = await buildApp(config(), { logs });
  const ok = await app.inject({
    method: "GET",
    url: `${META_LEADGEN_ROUTE}?hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=ok-challenge`,
  });
  const denied = await app.inject({
    method: "GET",
    url: `${META_LEADGEN_ROUTE}?hub.mode=subscribe&hub.verify_token=leaked-secret-token&hub.challenge=nope`,
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(denied.statusCode, 403);
  assert.equal(logs.length, 2);
  assert.equal(logs[0]?.complete?.processingStatus, "handshake_ok");
  assert.equal(logs[1]?.complete?.processingStatus, "handshake_denied");
  for (const row of logs) {
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes("vt-123"), false);
    assert.equal(serialized.includes("leaked-secret-token"), false);
    assert.equal("hub.verify_token" in (row.start.rawBody as object), false);
  }
  await app.close();
});

test("POST with invalid JSON body logs failure and does not crash", async () => {
  const app = await buildApp(config());
  const res = await app.inject({
    method: "POST",
    url: FACEBOOK_LEAD_CREATED_ROUTE,
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
    url: FACEBOOK_LEAD_CREATED_ROUTE,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ entry: [] }),
  });
  assert.equal(res.statusCode, 401);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.error, "invalid_signature");
  await app.close();
});

test("POST /webhooks/meta/leadgen rejects invalid signature (fail closed)", async () => {
  const logs: CapturedLog[] = [];
  const app = await buildApp(config({ appSecret: "s3cr3t" }), { logs });
  const payload = JSON.stringify(leadgenPayload());
  const res = await app.inject({
    method: "POST",
    url: META_LEADGEN_ROUTE,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=deadbeef",
    },
    payload,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "invalid_signature");
  assert.equal(logs[0]?.complete?.processingStatus, "signature_invalid");
  await app.close();
});

test("POST /webhooks/meta/leadgen accepts a valid signed payload", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_001"));
  let processCalls = 0;
  let fetchCalls = 0;
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
      routingEnabled: true,
    }),
    {
      processImpl: async () => {
        processCalls += 1;
        return intakeResult;
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          body: { id: "lead_001", campaign_id: "120243339037000760", field_data: [] },
        };
      },
    }
  );
  const res = await app.inject({
    method: "POST",
    url: META_LEADGEN_ROUTE,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(secret, payload),
    },
    payload,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; processed: number; intakeEnabled: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.processed, 1);
  assert.equal(body.intakeEnabled, true);
  assert.equal(processCalls, 1);
  assert.equal(fetchCalls, 1);
  await app.close();
});

test("POST returns 503 when META_APP_SECRET is missing in production", async () => {
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "production";

  const app = await buildApp(config({ appSecret: null }));
  const res = await app.inject({
    method: "POST",
    url: FACEBOOK_LEAD_CREATED_ROUTE,
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
    url: FACEBOOK_LEAD_CREATED_ROUTE,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ object: "page", entry: [{ id: "p1", changes: [] }] }),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; processed: number };
  assert.equal(body.ok, true);
  assert.equal(body.processed, 0);
  await app.close();
});

test("existing /sources/facebook/lead-created still processes a signed leadgen", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_legacy"));
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
      routingEnabled: true,
    })
  );
  const res = await app.inject({
    method: "POST",
    url: FACEBOOK_LEAD_CREATED_ROUTE,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(secret, payload),
    },
    payload,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  await app.close();
});

test("same leadgen_id retry skips Graph and does not create a second canonical processing event", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_replay"));
  const processed = new Set<string>();
  let processCalls = 0;
  let fetchCalls = 0;
  const logs: CapturedLog[] = [];
  const processedRow: FacebookLeadReplayRow = {
    id: "evt_fb_1",
    status: "routing_matched",
    sourceRouteKey: "form_9",
    sourceLeadId: "lead_replay",
    sourceLeadUid: "facebook-meta_lead_ads-lead_replay",
    normalizedAt: new Date(),
    routingDryRunDecisionId: "dec_1",
    routingRuleIdResolved: "rule_1",
    clientAccountIdResolved: "sa360_demo",
    destinationLocationIdResolved: "loc_demo",
    errorSummary: null,
  };
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
      routingEnabled: true,
    }),
    {
      logs,
      findReplayImpl: async (leadgenId) => (processed.has(leadgenId) ? processedRow : null),
      processImpl: async () => {
        processCalls += 1;
        processed.add("lead_replay");
        return { ...intakeResult, leadgenId: "lead_replay" };
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          body: { id: "lead_replay", campaign_id: "camp", field_data: [] },
        };
      },
    }
  );

  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(secret, payload),
  };
  const first = await app.inject({ method: "POST", url: META_LEADGEN_ROUTE, headers, payload });
  const second = await app.inject({ method: "POST", url: META_LEADGEN_ROUTE, headers, payload });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(processCalls, 1);
  assert.equal(fetchCalls, 1);
  const secondBody = second.json() as { replayed: number; results: Array<{ replayed?: boolean; sourceEventId?: string }> };
  assert.equal(secondBody.replayed, 1);
  assert.equal(secondBody.results[0]?.replayed, true);
  assert.equal(secondBody.results[0]?.sourceEventId, "evt_fb_1");
  assert.equal(logs[1]?.complete?.processingStatus, "duplicate");
  await app.close();
});

test("test-lead endpoint runs normalize->match via injected intake", async () => {
  let captured: unknown = null;
  const app = await buildApp(config(), {
    processImpl: async () => {
      captured = true;
      return intakeResult;
    },
  });
  const res = await app.inject({
    method: "POST",
    url: FACEBOOK_TEST_LEAD_ROUTE,
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
    url: FACEBOOK_TEST_LEAD_ROUTE,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify("just a string"),
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("test-lead fixture is disabled when SA360_META_LEAD_ADS_FIXTURE_ENABLED is false", async () => {
  const app = await buildApp(config({ fixtureEnabled: false }));
  const res = await app.inject({
    method: "POST",
    url: FACEBOOK_TEST_LEAD_ROUTE,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ leadgen_id: "lead_001" }),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "processing_disabled");
  await app.close();
});
