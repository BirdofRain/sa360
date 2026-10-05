import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { SourceLeadEvent } from "@prisma/client";
import type { MetaWebhookConfig } from "../lib/meta-webhook.js";
import { adminMetaLeadgenRoutes, type AdminMetaLeadgenRoutesOptions } from "./admin-meta-leadgen.js";

const ADMIN_KEY = "meta-leadgen-admin";

function pilotConfig(overrides: Partial<MetaWebhookConfig> = {}): MetaWebhookConfig {
  return {
    verifyToken: "vt",
    appSecret: "s",
    accessToken: "tok",
    accessTokenPageId: null,
    graphApiVersion: "v25.0",
    masterClientAccountId: null,
    directIntakeEnabled: false,
    intakeEnabled: true,
    graphFetchEnabled: true,
    routingEnabled: false,
    fixtureEnabled: false,
    ...overrides,
  };
}

function metaEvent(overrides: Partial<SourceLeadEvent> = {}): SourceLeadEvent {
  return {
    id: "evt_meta_1",
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    sourceLeadId: "900000000000001",
    sourceLeadUid: "facebook-meta_lead_ads-900000000000001",
    status: "received",
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: "Meta Graph rejected the Page access token (status 400).",
    enrichmentMetadataJson: {
      metaLeadgenFetch: { ownerId: "job_1", state: "failed", graphOutcome: "auth_failure" },
    },
    ...overrides,
  } as SourceLeadEvent;
}

async function requeueApp(opts: AdminMetaLeadgenRoutesOptions) {
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1", ...opts });
  return app;
}

async function withAdminKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
}

test("requeue-fetch requires admin key", async () => {
  await withAdminKey(async () => {
    const app = await requeueApp({});
    const res = await app.inject({ method: "POST", url: "/admin/v1/meta-leadgen/events/evt_x/requeue-fetch" });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("requeue-fetch removes the failed job, enqueues a fresh one, and records requeuedAt", async () => {
  await withAdminKey(async () => {
    const requeues: Array<{ leadgenId: string; sourceLeadEventId: string }> = [];
    const merges: Array<{ patch: Record<string, unknown>; extra?: { errorSummary?: string | null } }> = [];
    const app = await requeueApp({
      getMetaWebhookConfigImpl: () => pilotConfig(),
      findSourceLeadEventByIdImpl: async () => metaEvent(),
      requeueMetaLeadgenFetchImpl: async (data) => {
        requeues.push(data);
        return { enqueued: true, jobId: `meta-leadgen-fetch-${data.leadgenId}`, previousState: "failed" };
      },
      mergeMetaLeadgenFetchMetaImpl: async (_l, _e, patch, extra) => {
        merges.push({ patch: patch as Record<string, unknown>, extra });
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/meta-leadgen/events/evt_meta_1/requeue-fetch",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; jobId: string; previousState: string; requeuedAt: string };
    assert.equal(body.ok, true);
    assert.equal(body.previousState, "failed");
    assert.equal(body.jobId, "meta-leadgen-fetch-900000000000001");
    assert.deepEqual(requeues, [{ leadgenId: "900000000000001", sourceLeadEventId: "evt_meta_1" }]);
    assert.equal(merges.length, 1);
    assert.equal(merges[0]?.patch.state, "queued");
    assert.ok(merges[0]?.patch.requeuedAt);
    assert.match(merges[0]?.extra?.errorSummary ?? "", /Requeued/);
    await app.close();
  });
});

test("requeue-fetch refuses settled, non-Meta, in-progress, and flag-disabled cases without touching the queue", async () => {
  await withAdminKey(async () => {
    let requeueCalls = 0;
    const requeueMetaLeadgenFetchImpl = async () => {
      requeueCalls += 1;
      return { enqueued: true, jobId: "x", previousState: null };
    };
    const cases: Array<{ name: string; opts: AdminMetaLeadgenRoutesOptions; status: number; error: string }> = [
      {
        name: "settled capture row",
        opts: {
          getMetaWebhookConfigImpl: () => pilotConfig(),
          findSourceLeadEventByIdImpl: async () =>
            metaEvent({
              status: "normalized",
              enrichmentMetadataJson: { captureOnly: true, captureSettled: true },
            }),
          requeueMetaLeadgenFetchImpl,
        },
        status: 409,
        error: "already_settled",
      },
      {
        name: "non-Meta row",
        opts: {
          getMetaWebhookConfigImpl: () => pilotConfig(),
          findSourceLeadEventByIdImpl: async () =>
            metaEvent({ sourceProvider: "leadcapture_io", sourceSystem: "leadcapture_io_nextgen" }),
          requeueMetaLeadgenFetchImpl,
        },
        status: 409,
        error: "not_meta_lead_ads_event",
      },
      {
        name: "fetch in progress",
        opts: {
          getMetaWebhookConfigImpl: () => pilotConfig(),
          findSourceLeadEventByIdImpl: async () =>
            metaEvent({
              enrichmentMetadataJson: {
                metaLeadgenFetch: { ownerId: "job_1", state: "fetching", fetchStartedAt: new Date().toISOString() },
              },
            }),
          requeueMetaLeadgenFetchImpl,
        },
        status: 409,
        error: "fetch_in_progress",
      },
      {
        name: "flags disabled",
        opts: {
          getMetaWebhookConfigImpl: () => pilotConfig({ graphFetchEnabled: false }),
          findSourceLeadEventByIdImpl: async () => metaEvent(),
          requeueMetaLeadgenFetchImpl,
        },
        status: 409,
        error: "flags_disabled",
      },
      {
        name: "not found",
        opts: {
          getMetaWebhookConfigImpl: () => pilotConfig(),
          findSourceLeadEventByIdImpl: async () => null,
          requeueMetaLeadgenFetchImpl,
        },
        status: 404,
        error: "not_found",
      },
    ];
    for (const c of cases) {
      const app = await requeueApp(c.opts);
      const res = await app.inject({
        method: "POST",
        url: "/admin/v1/meta-leadgen/events/evt_meta_1/requeue-fetch",
        headers: { "x-sa360-admin-key": ADMIN_KEY },
      });
      assert.equal(res.statusCode, c.status, c.name);
      assert.equal(res.json().error, c.error, c.name);
      await app.close();
    }
    assert.equal(requeueCalls, 0);
  });
});

test("requeue-fetch reports job_in_progress when the queue still holds an active job", async () => {
  await withAdminKey(async () => {
    const app = await requeueApp({
      getMetaWebhookConfigImpl: () => pilotConfig(),
      findSourceLeadEventByIdImpl: async () => metaEvent(),
      requeueMetaLeadgenFetchImpl: async () => ({
        enqueued: false,
        jobId: "meta-leadgen-fetch-900000000000001",
        previousState: "active",
        skipped: "in_progress",
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/meta-leadgen/events/evt_meta_1/requeue-fetch",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "job_in_progress");
    assert.equal(res.json().previousState, "active");
    await app.close();
  });
});

test("requeue-fetch returns 503 when the queue is unavailable", async () => {
  await withAdminKey(async () => {
    const app = await requeueApp({
      getMetaWebhookConfigImpl: () => pilotConfig(),
      findSourceLeadEventByIdImpl: async () => metaEvent(),
      requeueMetaLeadgenFetchImpl: async () => {
        throw new Error("Redis connection refused");
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/meta-leadgen/events/evt_meta_1/requeue-fetch",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, "queue_unavailable");
    await app.close();
  });
});

test("internal meta-leadgen process-fetch requires admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "meta-leadgen-admin";
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/meta-leadgen/internal/process-fetch",
    payload: { leadgenId: "x", sourceLeadEventId: "y" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prev;
});

test("internal meta-leadgen process-fetch is disabled when no admin key is configured", async () => {
  const prevAdmin = process.env.ADMIN_API_KEY;
  const prevAlias = process.env.SA360_ADMIN_KEY;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/meta-leadgen/internal/process-fetch",
    payload: { leadgenId: "x", sourceLeadEventId: "y" },
  });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prevAdmin === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prevAdmin;
  if (prevAlias === undefined) delete process.env.SA360_ADMIN_KEY;
  else process.env.SA360_ADMIN_KEY = prevAlias;
});

test("internal meta-leadgen process-fetch rejects an invalid body after auth", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "meta-leadgen-admin";
  const app = Fastify({ logger: false });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/meta-leadgen/internal/process-fetch",
    headers: { "x-sa360-admin-key": "meta-leadgen-admin" },
    payload: { leadgenId: "" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_body");
  await app.close();
  if (prev === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prev;
});
