import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import type { MetaWebhookConfig } from "../../lib/meta-webhook.js";
import type { FacebookLeadIntakeResult } from "./facebook-lead-intake.service.js";
import {
  processMetaLeadgenFetch,
  type ProcessMetaLeadgenFetchDeps,
} from "./meta-leadgen-fetch.service.js";

const here = dirname(fileURLToPath(import.meta.url));
const fetchSource = readFileSync(join(here, "meta-leadgen-fetch.service.ts"), "utf8");
const persistSource = readFileSync(join(here, "source-intake-routing-persist.ts"), "utf8");
const routeSource = readFileSync(join(here, "../../routes/sources-facebook.ts"), "utf8");

function config(overrides: Partial<MetaWebhookConfig> = {}): MetaWebhookConfig {
  return {
    verifyToken: "vt",
    appSecret: "secret",
    accessToken: "tok",
    graphApiVersion: "v22.0",
    masterClientAccountId: "lal_master_vet",
    directIntakeEnabled: false,
    intakeEnabled: true,
    graphFetchEnabled: true,
    routingEnabled: false,
    fixtureEnabled: false,
    ...overrides,
  };
}

function receivedEvent(leadgenId: string) {
  return {
    id: `evt_${leadgenId}`,
    status: "received" as const,
    sourceRouteKey: "form_9",
    sourceLeadId: leadgenId,
    sourceLeadUid: `facebook-meta_lead_ads-${leadgenId}`,
    normalizedAt: null,
    routedAt: null,
    routingDryRunDecisionId: null,
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
    destinationLocationIdResolved: null,
    errorSummary: null,
    normalizedPayloadJson: null,
    enrichmentMetadataJson: null,
    rawPayloadJson: {
      envelope: { leadgenId, formId: "form_9", adId: "ad_1" },
    },
    webhookRequestLogId: "log_1",
  };
}

function intake(leadgenId: string, overrides: Partial<FacebookLeadIntakeResult> = {}): FacebookLeadIntakeResult {
  return {
    ok: true,
    provider: "facebook",
    sourceEventId: `evt_${leadgenId}`,
    status: "normalized",
    sourceRouteKey: "form_9",
    leadgenId,
    normalizedLeadUid: `facebook-meta_lead_ads-${leadgenId}`,
    matched: false,
    nextAction: "review",
    replayed: false,
    ...overrides,
  };
}

function memoryHarness(leadgenId: string) {
  const store = { event: receivedEvent(leadgenId) as Record<string, unknown> };
  let chain = Promise.resolve();
  const withLockImpl: NonNullable<ProcessMetaLeadgenFetchDeps["withLockImpl"]> = async (
    _p,
    _s,
    _id,
    fn
  ) => {
    let release!: () => void;
    const prev = chain;
    chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const tx = {
        sourceLeadEvent: {
          findUnique: async () => store.event,
          findFirst: async () => store.event,
          update: async (args: { data: Record<string, unknown> }) => {
            store.event = { ...store.event, ...args.data };
            return store.event;
          },
        },
      };
      return await fn(tx as never);
    } finally {
      release();
    }
  };
  return {
    store,
    deps: {
      withLockImpl,
      findByIdImpl: async () => store.event as never,
      updateEventImpl: async (_id: string, data: Prisma.SourceLeadEventUpdateInput) => {
        store.event = { ...store.event, ...(data as object) };
        return store.event as never;
      },
    } satisfies Pick<
      ProcessMetaLeadgenFetchDeps,
      "withLockImpl" | "findByIdImpl" | "updateEventImpl"
    >,
  };
}

test("fetch service source never reaches inventory, GHL, LF2, or Meta CAPI", () => {
  assert.doesNotMatch(fetchSource, /trackCampaignInventory|leadInventoryItem\.create/);
  assert.doesNotMatch(fetchSource, /approveSourceLeadDelivery|enqueueGhl|ghl-live-canary/);
  assert.doesNotMatch(fetchSource, /enqueueMetaDispatch|metaDispatchAttempt|META_DISPATCH_QUEUE/);
  assert.doesNotMatch(fetchSource, /ensureFulfillmentOutbox|fulfillment-shadow/);
  assert.match(fetchSource, /RELEASE before/);
  assert.match(persistSource, /No GHL delivery is performed here/);
});

test("webhook handler no longer calls Graph or intake inline", () => {
  const handlerStart = routeSource.indexOf("async function handleLeadCreated");
  const handlerEnd = routeSource.indexOf("async function handleTestLead");
  const handler = routeSource.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handler, /fetchMetaLeadDetailsImpl\(/);
  assert.doesNotMatch(handler, /processFacebookSourceLeadImpl\(/);
  assert.match(handler, /enqueueImpl/);
});

test("flags disabled skip Graph", async () => {
  let fetchCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId: "lead_off", sourceLeadEventId: "evt_off" },
    {
      getMetaWebhookConfigImpl: () => config({ intakeEnabled: false, graphFetchEnabled: false }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: "lead_off", field_data: [] } };
      },
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.skipped, "flags_disabled");
  assert.equal(fetchCalls, 0);
});

test("already processed is idempotent and does not call Graph", async () => {
  const leadgenId = "lead_done";
  const harness = memoryHarness(leadgenId);
  harness.store.event.status = "routing_matched";
  harness.store.event.normalizedAt = new Date();
  harness.store.event.routedAt = new Date();
  harness.store.event.routingDryRunDecisionId = "dec_1";
  let fetchCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_done" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: true }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.skipped, "already_processed");
  assert.equal(fetchCalls, 0);
});

test("successful Graph path normalizes without routing when routing flag is false", async () => {
  const leadgenId = "lead_ok";
  const harness = memoryHarness(leadgenId);
  let fetchCalls = 0;
  let processCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_ok" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: false }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          body: {
            id: leadgenId,
            campaign_id: "camp_1",
            field_data: [{ name: "email", values: ["a@example.test"] }],
          },
        };
      },
      processFacebookSourceLeadImpl: async (input) => {
        processCalls += 1;
        assert.equal(input.routingEnabled, false);
        assert.equal(input.existingEventId, `evt_${leadgenId}`);
        return intake(leadgenId);
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.graphFetched, true);
    assert.equal(result.intake?.status, "normalized");
  }
  assert.equal(fetchCalls, 1);
  assert.equal(processCalls, 1);
});

test("routing enabled matched path creates one shadow intake result", async () => {
  const leadgenId = "lead_match";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_match" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: true }),
      fetchMetaLeadDetailsImpl: async () => ({
        ok: true,
        status: 200,
        body: { id: leadgenId, field_data: [{ name: "email", values: ["m@example.test"] }] },
      }),
      processFacebookSourceLeadImpl: async (input) => {
        assert.equal(input.routingEnabled, true);
        return intake(leadgenId, {
          status: "routing_matched",
          matched: true,
          routingDryRunDecisionId: "dec_match",
          destinationClientAccountId: "client_1",
        });
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.intake?.matched, true);
    assert.equal(result.intake?.routingDryRunDecisionId, "dec_match");
  }
});

test("unmatched routing is review required", async () => {
  const leadgenId = "lead_unmatched";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_unmatched" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: true }),
      fetchMetaLeadDetailsImpl: async () => ({
        ok: true,
        status: 200,
        body: { id: leadgenId, field_data: [] },
      }),
      processFacebookSourceLeadImpl: async () =>
        intake(leadgenId, { status: "routing_unmatched", matched: false }),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.intake?.status, "routing_unmatched");
});

test("ambiguous routing is review required", async () => {
  const leadgenId = "lead_amb";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_amb" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: true }),
      fetchMetaLeadDetailsImpl: async () => ({
        ok: true,
        status: 200,
        body: { id: leadgenId, field_data: [] },
      }),
      processFacebookSourceLeadImpl: async () =>
        intake(leadgenId, { status: "needs_review", matched: false }),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.intake?.status, "needs_review");
    assert.equal(result.intake?.matched, false);
  }
});

test("retryable Graph failure is visible and retryable", async () => {
  const leadgenId = "lead_429";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_429" },
    {
      getMetaWebhookConfigImpl: () => config(),
      fetchMetaLeadDetailsImpl: async () => ({ ok: false, status: 429, body: { error: "throttle" } }),
      processFacebookSourceLeadImpl: async () => intake(leadgenId),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, true);
    assert.equal(result.graphOutcome, "retryable_failure");
  }
});

test("permanent Graph auth failure is visible and not retryable", async () => {
  const leadgenId = "lead_401";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_401" },
    {
      getMetaWebhookConfigImpl: () => config(),
      fetchMetaLeadDetailsImpl: async () => ({ ok: false, status: 401, body: { error: { code: 190 } } }),
      processFacebookSourceLeadImpl: async () => intake(leadgenId),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.equal(result.graphOutcome, "auth_failure");
  }
});

test("worker retry after retryable failure calls Graph again", async () => {
  const leadgenId = "lead_retry";
  const harness = memoryHarness(leadgenId);
  let fetchCalls = 0;
  const deps: ProcessMetaLeadgenFetchDeps = {
    getMetaWebhookConfigImpl: () => config(),
    fetchMetaLeadDetailsImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return { ok: false, status: 500, body: { error: "boom" } };
      return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
    },
    processFacebookSourceLeadImpl: async () => intake(leadgenId),
    ...harness.deps,
  };
  const first = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_retry" },
    deps
  );
  const second = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_retry", attemptNumber: 2 },
    deps
  );
  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(fetchCalls, 2);
});

test("fixture path hydrates without calling live Graph", async () => {
  const leadgenId = "lead_fix";
  const harness = memoryHarness(leadgenId);
  harness.store.event.rawPayloadJson = {
    fixture: true,
    graphLead: {
      id: leadgenId,
      field_data: [{ name: "email", values: ["fix@example.test"] }],
    },
    envelope: { leadgenId, formId: "form_fix" },
  };
  let fetchCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, fixture: true, jobId: "job_fix" },
    {
      getMetaWebhookConfigImpl: () =>
        config({
          accessToken: null,
          graphFetchEnabled: false,
          intakeEnabled: false,
          fixtureEnabled: true,
        }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: false, status: 401, body: { error: "missing_access_token" } };
      },
      processFacebookSourceLeadImpl: async (input) => {
        assert.equal(input.fields.email, "fix@example.test");
        return intake(leadgenId);
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.graphFetched, false);
  assert.equal(fetchCalls, 0);
});

test("concurrent processors share one Graph fetch and one intake persist", async () => {
  const leadgenId = "lead_conc";
  const harness = memoryHarness(leadgenId);
  let fetchCalls = 0;
  let processCalls = 0;
  const deps: ProcessMetaLeadgenFetchDeps = {
    getMetaWebhookConfigImpl: () => config({ routingEnabled: true }),
    fetchMetaLeadDetailsImpl: async () => {
      fetchCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
    },
    processFacebookSourceLeadImpl: async () => {
      processCalls += 1;
      return intake(leadgenId, {
        status: "routing_matched",
        matched: true,
        routingDryRunDecisionId: "dec_one",
      });
    },
    ...harness.deps,
  };
  const [a, b] = await Promise.all([
    processMetaLeadgenFetch({ leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_a" }, deps),
    processMetaLeadgenFetch({ leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_b" }, deps),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(fetchCalls, 1);
  assert.equal(processCalls, 1);
  const skipped = [a, b].filter((r) => r.ok && r.skipped === "in_flight");
  const fetched = [a, b].filter((r) => r.ok && r.graphFetched);
  assert.equal(skipped.length, 1);
  assert.equal(fetched.length, 1);
  if (fetched[0]?.ok) assert.equal(fetched[0].intake?.routingDryRunDecisionId, "dec_one");
});
