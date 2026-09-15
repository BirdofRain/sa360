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
import type { Prisma } from "@prisma/client";
import type { CompleteLogInput, StartLogInput, WebhookRequestLogHandle } from "../services/webhook-request-log.service.js";
import type { FacebookLeadIntakeResult } from "../services/source-intake/facebook-lead-intake.service.js";
import type { FacebookLeadReplayRow } from "../services/source-intake/facebook-lead-intake.service.js";
import type { ProcessMetaLeadgenFetchInput } from "../services/source-intake/meta-leadgen-fetch.service.js";

function config(overrides: Partial<MetaWebhookConfig> = {}): MetaWebhookConfig {
  const {
    intakeEnabled: intakeOverride,
    graphFetchEnabled: graphOverride,
    routingEnabled: routingOverride,
    fixtureEnabled: fixtureOverride,
    directIntakeEnabled: directOverride,
    ...rest
  } = overrides;
  const intakeEnabled = intakeOverride ?? directOverride ?? false;
  const graphFetchEnabled = graphOverride ?? directOverride ?? false;
  const routingEnabled = routingOverride ?? directOverride ?? false;
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
    fixtureEnabled: fixtureOverride ?? true,
    ...rest,
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
    claimImpl?: (data: Prisma.SourceLeadEventCreateInput) => Promise<{
      event: FacebookLeadReplayRow;
      created: boolean;
    }>;
    enqueueImpl?: (data: {
      leadgenId: string;
      sourceLeadEventId: string;
      fixture?: boolean;
    }) => Promise<{ enqueued: boolean; jobId: string; skipped?: boolean }>;
    processFetchImpl?: (
      input: ProcessMetaLeadgenFetchInput
    ) => Promise<{
      ok: true;
      graphFetched: boolean;
      intake?: FacebookLeadIntakeResult;
      skipped?: "already_processed" | "in_flight" | "flags_disabled";
    }>;
    logs?: CapturedLog[];
  } = {}
) {
  const app = Fastify({ logger: false });
  const logs = extras.logs;
  const processImpl = extras.processImpl ?? (async () => intakeResult);
  await app.register(sourcesFacebookRoutes, {
    getMetaWebhookConfigImpl: () => cfg,
    processFacebookSourceLeadImpl: processImpl,
    fetchMetaLeadDetailsImpl:
      extras.fetchImpl ??
      (async () => ({
        ok: true,
        status: 200,
        body: { id: "lead_001", campaign_id: "120243339037000760", field_data: [] },
      })),
    findFacebookLeadReplayImpl: extras.findReplayImpl ?? (async () => null),
    claimFacebookLeadgenImpl:
      extras.claimImpl ??
      (async (data: Prisma.SourceLeadEventCreateInput) => ({
        event: {
          id: "evt_claimed",
          sourceLeadId: typeof data.sourceLeadId === "string" ? data.sourceLeadId : "lead_001",
          status: "received",
          sourceRouteKey: data.sourceRouteKey ?? "form_9",
          sourceLeadUid: "facebook-meta_lead_ads-lead_001",
          normalizedAt: null,
          routedAt: null,
          routingDryRunDecisionId: null,
          routingRuleIdResolved: null,
          clientAccountIdResolved: null,
          destinationLocationIdResolved: null,
          errorSummary: null,
        } as never,
        created: true,
      })),
    enqueueMetaLeadgenFetchImpl:
      extras.enqueueImpl ??
      (async (data: { leadgenId: string; sourceLeadEventId: string; fixture?: boolean }) => ({
        enqueued: true,
        jobId: `meta-leadgen-fetch-${data.leadgenId}`,
      })),
    processMetaLeadgenFetchImpl:
      extras.processFetchImpl ??
      (async () => ({
        ok: true as const,
        graphFetched: false,
        intake: await processImpl(),
      })),
    startLogImpl: logs
      ? async (input: StartLogInput) => {
          const handle = { id: `log_${logs.length + 1}`, receivedAt: new Date() };
          logs.push({ start: input, handleId: handle.id });
          return handle;
        }
      : async () => null,
    completeLogImpl: logs
      ? async (handle: WebhookRequestLogHandle | null, input: CompleteLogInput) => {
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
  let enqueueCalls = 0;
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
      enqueueImpl: async (data) => {
        enqueueCalls += 1;
        return { enqueued: true, jobId: `meta-leadgen-fetch-${data.leadgenId}` };
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
  const body = res.json() as {
    ok: boolean;
    processed: number;
    intakeEnabled: boolean;
    queued: number;
    accepted: number;
  };
  assert.equal(body.ok, true);
  assert.equal(body.processed, 1);
  assert.equal(body.intakeEnabled, true);
  assert.equal(body.queued, 1);
  assert.equal(body.accepted, 1);
  assert.equal(processCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(enqueueCalls, 1);
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

test("same leadgen_id retry while waiting shares one job and never calls Graph in the webhook", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_replay"));
  let processCalls = 0;
  let fetchCalls = 0;
  let enqueueCalls = 0;
  let claimCalls = 0;
  const logs: CapturedLog[] = [];
  const receivedRow: FacebookLeadReplayRow = {
    id: "evt_fb_1",
    status: "received",
    sourceRouteKey: "form_9",
    sourceLeadId: "lead_replay",
    sourceLeadUid: "facebook-meta_lead_ads-lead_replay",
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
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
      findReplayImpl: async () => (claimCalls > 0 ? receivedRow : null),
      claimImpl: async () => {
        claimCalls += 1;
        return { event: receivedRow, created: claimCalls === 1 };
      },
      processImpl: async () => {
        processCalls += 1;
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
      enqueueImpl: async (data) => {
        enqueueCalls += 1;
        return {
          enqueued: enqueueCalls === 1,
          skipped: enqueueCalls > 1,
          jobId: `meta-leadgen-fetch-${data.leadgenId}`,
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
  assert.equal(processCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(enqueueCalls, 2);
  assert.equal(second.json().results[0]?.sourceEventId, "evt_fb_1");
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

test("graph flag false captures without enqueue or Graph", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_nograph"));
  let enqueueCalls = 0;
  let fetchCalls = 0;
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: false,
    }),
    {
      fetchImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: "lead_nograph", field_data: [] } };
      },
      enqueueImpl: async (data) => {
        enqueueCalls += 1;
        return { enqueued: true, jobId: `meta-leadgen-fetch-${data.leadgenId}` };
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
  assert.equal(res.json().queued, 0);
  assert.equal(enqueueCalls, 0);
  assert.equal(fetchCalls, 0);
  await app.close();
});

test("Redis enqueue failure returns 503 and preserves the canonical event", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_qfail"));
  const logs: CapturedLog[] = [];
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
    }),
    {
      logs,
      enqueueImpl: async () => {
        throw new Error("Redis connection refused");
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
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "queue_unavailable");
  assert.equal(logs[0]?.complete?.processingStatus, "failed");
  await app.close();
});

test("same leadgen_id through old callback then new alias is one job", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_cross_route"));
  let claimed = false;
  let fetchCalls = 0;
  let enqueueCalls = 0;
  const receivedRow: FacebookLeadReplayRow = {
    id: "evt_cross",
    status: "received",
    sourceRouteKey: "form_9",
    sourceLeadId: "lead_cross_route",
    sourceLeadUid: "facebook-meta_lead_ads-lead_cross_route",
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: null,
  };
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
    }),
    {
      findReplayImpl: async () => (claimed ? receivedRow : null),
      claimImpl: async () => {
        claimed = true;
        return { event: receivedRow, created: true };
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: "lead_cross_route", field_data: [] } };
      },
      enqueueImpl: async (data) => {
        enqueueCalls += 1;
        return {
          enqueued: enqueueCalls === 1,
          skipped: enqueueCalls > 1,
          jobId: `meta-leadgen-fetch-${data.leadgenId}`,
        };
      },
    }
  );
  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(secret, payload),
  };
  const first = await app.inject({
    method: "POST",
    url: FACEBOOK_LEAD_CREATED_ROUTE,
    headers,
    payload,
  });
  const second = await app.inject({
    method: "POST",
    url: META_LEADGEN_ROUTE,
    headers,
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(fetchCalls, 0);
  assert.equal(enqueueCalls, 2);
  assert.equal(second.json().results[0]?.sourceEventId, "evt_cross");
  await app.close();
});

test("same leadgen_id through new alias then old callback is one job", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_cross_route_2"));
  let claimed = false;
  let enqueueCalls = 0;
  const receivedRow: FacebookLeadReplayRow = {
    id: "evt_cross_2",
    status: "received",
    sourceRouteKey: "form_9",
    sourceLeadId: "lead_cross_route_2",
    sourceLeadUid: "facebook-meta_lead_ads-lead_cross_route_2",
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: null,
  };
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
    }),
    {
      findReplayImpl: async () => (claimed ? receivedRow : null),
      claimImpl: async () => {
        claimed = true;
        return { event: receivedRow, created: true };
      },
      enqueueImpl: async (data) => {
        enqueueCalls += 1;
        return {
          enqueued: enqueueCalls === 1,
          skipped: enqueueCalls > 1,
          jobId: `meta-leadgen-fetch-${data.leadgenId}`,
        };
      },
    }
  );
  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(secret, payload),
  };
  const first = await app.inject({ method: "POST", url: META_LEADGEN_ROUTE, headers, payload });
  const second = await app.inject({
    method: "POST",
    url: FACEBOOK_LEAD_CREATED_ROUTE,
    headers,
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(enqueueCalls, 2);
  assert.equal(second.json().results[0]?.sourceEventId, "evt_cross_2");
  await app.close();
});

test("duplicate Meta POST while unprocessed reuses canonical identity and does not Graph in webhook", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_graph_retry"));
  let fetchCalls = 0;
  let processCalls = 0;
  let claimCalls = 0;
  let enqueueCalls = 0;
  const receivedRow: FacebookLeadReplayRow = {
    id: "evt_graph_retry",
    status: "received",
    sourceRouteKey: "form_9",
    sourceLeadId: "lead_graph_retry",
    sourceLeadUid: "facebook-meta_lead_ads-lead_graph_retry",
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: null,
  };
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: true,
      graphFetchEnabled: true,
    }),
    {
      findReplayImpl: async () => (claimCalls > 0 ? receivedRow : null),
      claimImpl: async () => {
        claimCalls += 1;
        return { event: receivedRow, created: claimCalls === 1 };
      },
      processImpl: async () => {
        processCalls += 1;
        return { ...intakeResult, leadgenId: "lead_graph_retry", sourceEventId: "evt_graph_retry" };
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: "lead_graph_retry", field_data: [] } };
      },
      enqueueImpl: async (data) => {
        enqueueCalls += 1;
        return {
          enqueued: enqueueCalls === 1,
          skipped: enqueueCalls > 1,
          jobId: `meta-leadgen-fetch-${data.leadgenId}`,
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
  assert.equal(fetchCalls, 0);
  assert.equal(processCalls, 0);
  assert.equal(enqueueCalls, 2);
  assert.equal(first.json().results[0]?.sourceEventId, "evt_graph_retry");
  assert.equal(second.json().results[0]?.sourceEventId, "evt_graph_retry");
  await app.close();
});

test("intake-disabled capture then later processing enabled uses the same identity", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_flag_flip"));
  let cfg = config({
    appSecret: secret,
    intakeEnabled: false,
    graphFetchEnabled: false,
  });
  let processCalls = 0;
  let fetchCalls = 0;
  let claimCalls = 0;
  let enqueueCalls = 0;
  const receivedRow: FacebookLeadReplayRow = {
    id: "evt_flag_flip",
    status: "received",
    sourceRouteKey: "form_9",
    sourceLeadId: "lead_flag_flip",
    sourceLeadUid: "facebook-meta_lead_ads-lead_flag_flip",
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: "SA360_META_LEAD_ADS_INTAKE_ENABLED=false — raw event stored, Graph fetch skipped.",
  };
  const app = Fastify({ logger: false });
  await app.register(sourcesFacebookRoutes, {
    getMetaWebhookConfigImpl: () => cfg,
    processFacebookSourceLeadImpl: async () => {
      processCalls += 1;
      return { ...intakeResult, leadgenId: "lead_flag_flip", sourceEventId: "evt_flag_flip" };
    },
    fetchMetaLeadDetailsImpl: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200, body: { id: "lead_flag_flip", field_data: [] } };
    },
    findFacebookLeadReplayImpl: async () => (claimCalls > 0 ? receivedRow : null),
    claimFacebookLeadgenImpl: async () => {
      claimCalls += 1;
      return { event: receivedRow as never, created: claimCalls === 1 };
    },
    enqueueMetaLeadgenFetchImpl: async (data: {
      leadgenId: string;
      sourceLeadEventId: string;
      fixture?: boolean;
    }) => {
      enqueueCalls += 1;
      return { enqueued: true, jobId: `meta-leadgen-fetch-${data.leadgenId}` };
    },
    startLogImpl: async () => null,
    completeLogImpl: async () => undefined,
  });
  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(secret, payload),
  };
  const first = await app.inject({ method: "POST", url: META_LEADGEN_ROUTE, headers, payload });
  cfg = config({
    appSecret: secret,
    intakeEnabled: true,
    graphFetchEnabled: true,
    routingEnabled: true,
  });
  const second = await app.inject({ method: "POST", url: META_LEADGEN_ROUTE, headers, payload });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().intakeEnabled, false);
  assert.equal(first.json().results[0]?.sourceEventId, "evt_flag_flip");
  assert.equal(fetchCalls, 0);
  assert.equal(processCalls, 0);
  assert.equal(enqueueCalls, 1);
  assert.equal(second.json().results[0]?.sourceEventId, "evt_flag_flip");
  await app.close();
});

test("persist-raw claim failure fails closed without Graph or intake", async () => {
  const secret = "s3cr3t";
  const payload = JSON.stringify(leadgenPayload("lead_claim_throw"));
  let processCalls = 0;
  let fetchCalls = 0;
  const logs: CapturedLog[] = [];
  const app = await buildApp(
    config({
      appSecret: secret,
      intakeEnabled: false,
      graphFetchEnabled: false,
    }),
    {
      logs,
      processImpl: async () => {
        processCalls += 1;
        return intakeResult;
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: "lead_claim_throw", field_data: [] } };
      },
      claimImpl: async () => {
        throw new Error("advisory_lock_timeout");
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
  assert.equal(res.statusCode, 503);
  assert.equal(processCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(res.json().error, "claim_failed");
  assert.equal(logs[0]?.complete?.processingStatus, "failed");
  await app.close();
});
