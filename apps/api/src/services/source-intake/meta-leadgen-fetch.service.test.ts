import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import type { MetaWebhookConfig } from "../../lib/meta-webhook.js";
import type { FacebookLeadIntakeResult } from "./facebook-lead-intake.service.js";
import type { MetaLeadCaptureResult, SettleMetaLeadCaptureInput } from "./meta-lead-capture.service.js";
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
    accessTokenPageId: null,
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

function captureResult(
  leadgenId: string,
  overrides: Partial<MetaLeadCaptureResult> = {}
): MetaLeadCaptureResult {
  return {
    ok: true,
    intakeMethod: "meta_lead_ads",
    sourceEventId: `evt_${leadgenId}`,
    status: "normalized",
    leadgenId,
    normalizedLeadUid: `facebook-meta_lead_ads-${leadgenId}`,
    captureOutcome: "captured",
    association: {
      outcome: "associated",
      clientAccountId: "client_pilot",
      sourceFunnelId: "funnel_1",
      pageId: "page_1",
      formId: "form_9",
      explanation: "associated",
    },
    sourceClientAccountId: "client_pilot",
    nextAction: "none",
    ...overrides,
  };
}

function memoryHarness(leadgenId: string) {
  const store = { event: receivedEvent(leadgenId) as Record<string, unknown> };
  const settleCalls: SettleMetaLeadCaptureInput[] = [];
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
    settleCalls,
    deps: {
      withLockImpl,
      findByIdImpl: async () => store.event as never,
      updateEventImpl: async (_id: string, data: Prisma.SourceLeadEventUpdateInput) => {
        store.event = { ...store.event, ...(data as object) };
        return store.event as never;
      },
      // Capture-only settle stub (routing disabled). Marks the row settled the
      // way the real settle does so later gates see it as processed.
      settleMetaLeadCaptureImpl: async (input) => {
        settleCalls.push(input);
        store.event = {
          ...store.event,
          status: "normalized",
          normalizedAt: input.now,
          rawPayloadJson: input.rawPayloadJson,
          enrichmentMetadataJson: {
            captureOnly: true,
            captureSettled: true,
            metaLeadgenFetch: input.fetchMeta,
          },
        };
        return captureResult(input.leadgenId);
      },
    } satisfies Pick<
      ProcessMetaLeadgenFetchDeps,
      "withLockImpl" | "findByIdImpl" | "updateEventImpl" | "settleMetaLeadCaptureImpl"
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

test("successful Graph path settles capture-only (Page+Form association) when routing flag is false", async () => {
  const leadgenId = "lead_ok";
  const harness = memoryHarness(leadgenId);
  harness.store.event.rawPayloadJson = {
    envelope: { leadgenId, pageId: "page_1", formId: "form_9", adId: "ad_1" },
  };
  let fetchCalls = 0;
  let processCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_ok" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: false }),
      fetchMetaLeadDetailsImpl: async (_id, cfg) => {
        fetchCalls += 1;
        assert.equal(cfg.accessToken, "tok");
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
      processFacebookSourceLeadImpl: async () => {
        processCalls += 1;
        return intake(leadgenId);
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.graphFetched, true);
    assert.equal(result.intake, undefined);
    assert.equal(result.capture?.captureOutcome, "captured");
    assert.equal(result.capture?.association.outcome, "associated");
    assert.equal(result.capture?.sourceClientAccountId, "client_pilot");
  }
  assert.equal(fetchCalls, 1);
  // Lifecycle normalize (master client) is never consulted on the capture path.
  assert.equal(processCalls, 0);
  assert.equal(harness.settleCalls.length, 1);
  const settle = harness.settleCalls[0]!;
  assert.equal(settle.fields.email, "a@example.test");
  assert.equal(settle.fields.pageId, "page_1");
  assert.equal(settle.fields.formId, "form_9");
  assert.equal(settle.fields.campaignId, "camp_1");
  assert.equal((settle.rawPayloadJson.lead as { id: string }).id, leadgenId);
  assert.equal((settle.fetchMeta as { state: string }).state, "captured");
  assert.equal((settle.fetchMeta as { tokenScope?: string }).tokenScope, "unbound");
});

test("Page-bound token is only used for its own Page; other Pages are retained with a diagnostic", async () => {
  const leadgenId = "lead_other_page";
  const harness = memoryHarness(leadgenId);
  harness.store.event.rawPayloadJson = {
    envelope: { leadgenId, pageId: "page_other", formId: "form_x" },
  };
  let fetchCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_other_page" },
    {
      getMetaWebhookConfigImpl: () => config({ accessTokenPageId: "page_pilot" }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.equal(result.graphOutcome, "token_unavailable");
    assert.equal(result.graphFetched, false);
  }
  assert.equal(fetchCalls, 0);
  assert.equal(harness.settleCalls.length, 0);
  const summary = String(harness.store.event.errorSummary);
  assert.match(summary, /page_other/);
  assert.match(summary, /page_pilot/);
  assert.doesNotMatch(summary, /tok\b/);
  const fetchMeta = (harness.store.event.enrichmentMetadataJson as { metaLeadgenFetch: Record<string, unknown> })
    .metaLeadgenFetch;
  assert.equal(fetchMeta.state, "failed");
  assert.equal(fetchMeta.graphOutcome, "token_unavailable");
});

test("Page-bound token proceeds for its own Page", async () => {
  const leadgenId = "lead_same_page";
  const harness = memoryHarness(leadgenId);
  harness.store.event.rawPayloadJson = {
    envelope: { leadgenId, pageId: "page_pilot", formId: "form_x" },
  };
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_same_page" },
    {
      getMetaWebhookConfigImpl: () => config({ accessTokenPageId: "page_pilot" }),
      fetchMetaLeadDetailsImpl: async () => ({ ok: true, status: 200, body: { id: leadgenId, field_data: [] } }),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  assert.equal(harness.settleCalls.length, 1);
  assert.equal((harness.settleCalls[0]!.fetchMeta as { tokenScope?: string }).tokenScope, "page_bound");
});

test("Graph rate limit reported as HTTP 400 with code 4/17/32 is retryable, not terminal", async () => {
  for (const [code, status] of [
    [4, 400],
    [17, 400],
    [32, 400],
    [613, 400],
    [80004, 400],
  ] as const) {
    const leadgenId = `lead_rl_${code}`;
    const harness = memoryHarness(leadgenId);
    const result = await processMetaLeadgenFetch(
      { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: `job_rl_${code}` },
      {
        getMetaWebhookConfigImpl: () => config(),
        fetchMetaLeadDetailsImpl: async () => ({
          ok: false,
          status,
          body: { error: { code, message: "Application request limit reached", type: "OAuthException" } },
        }),
        ...harness.deps,
      }
    );
    assert.equal(result.ok, false, `code ${code}`);
    if (!result.ok) {
      assert.equal(result.retryable, true, `code ${code}`);
      assert.equal(result.graphOutcome, "retryable_failure", `code ${code}`);
    }
    const fetchMeta = (harness.store.event.enrichmentMetadataJson as { metaLeadgenFetch: Record<string, unknown> })
      .metaLeadgenFetch;
    assert.equal(fetchMeta.state, "retrying");
    assert.equal((fetchMeta.graphError as { code: string }).code, String(code));
    assert.match(String(harness.store.event.errorSummary), /temporarily unavailable/);
  }
});

test("Graph permission error (code 200, HTTP 400) is an auth failure with an actionable diagnostic", async () => {
  const leadgenId = "lead_perm";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_perm" },
    {
      getMetaWebhookConfigImpl: () => config(),
      fetchMetaLeadDetailsImpl: async () => ({
        ok: false,
        status: 400,
        body: {
          error: {
            code: 200,
            message: "(#200) Requires leads_retrieval permission",
            type: "OAuthException",
          },
        },
      }),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.equal(result.graphOutcome, "auth_failure");
  }
  const summary = String(harness.store.event.errorSummary);
  assert.match(summary, /leads_retrieval/);
  assert.match(summary, /requeue/i);
  assert.doesNotMatch(summary, /\btok\b/);
  // Raw notification is retained alongside the token-free Graph error.
  const raw = harness.store.event.rawPayloadJson as Record<string, unknown>;
  assert.ok(raw.envelope);
  assert.equal((raw.graphError as { code: string }).code, "200");
});

test("expired token (code 190) is an auth failure and the lead is retained for requeue", async () => {
  const leadgenId = "lead_expired";
  const harness = memoryHarness(leadgenId);
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_expired" },
    {
      getMetaWebhookConfigImpl: () => config(),
      fetchMetaLeadDetailsImpl: async () => ({
        ok: false,
        status: 400,
        body: { error: { code: 190, error_subcode: 463, message: "Error validating access token: Session has expired" } },
      }),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.graphOutcome, "auth_failure");
  assert.equal(harness.store.event.status, "received");
  assert.match(String(harness.store.event.errorSummary), /190\/463/);
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
      processFacebookSourceLeadImpl: async () => {
        assert.fail("lifecycle normalize must not run on the capture path");
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.graphFetched, false);
    assert.equal(result.graphOutcome, "skipped_fixture");
    assert.equal(result.capture?.captureOutcome, "captured");
  }
  assert.equal(fetchCalls, 0);
  assert.equal(harness.settleCalls.length, 1);
  assert.equal(harness.settleCalls[0]!.fields.email, "fix@example.test");
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

test("global fixture flag does not bypass intake/graph flags for live jobs", async () => {
  let fetchCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId: "lead_live_fixture_flag", sourceLeadEventId: "evt_live_fixture_flag" },
    {
      getMetaWebhookConfigImpl: () =>
        config({
          intakeEnabled: false,
          graphFetchEnabled: false,
          fixtureEnabled: true,
          accessToken: "prod-token-must-not-be-used",
        }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: "lead_live_fixture_flag", field_data: [] } };
      },
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.skipped, "flags_disabled");
  assert.equal(fetchCalls, 0);
});

test("fixture job without Graph body is terminal and never calls live Graph", async () => {
  const leadgenId = "lead_fix_empty";
  const harness = memoryHarness(leadgenId);
  let fetchCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, fixture: true, jobId: "job_fix_empty" },
    {
      getMetaWebhookConfigImpl: () =>
        config({
          accessToken: "prod-token-must-not-be-used",
          fixtureEnabled: true,
        }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
      },
      processFacebookSourceLeadImpl: async () => intake(leadgenId),
      ...harness.deps,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.equal(result.graphOutcome, "malformed");
  }
  assert.equal(fetchCalls, 0);
});

test("retry after normalized payload skips Graph and resumes intake", async () => {
  const leadgenId = "lead_resume";
  const harness = memoryHarness(leadgenId);
  harness.store.event.status = "normalized";
  harness.store.event.normalizedAt = new Date();
  harness.store.event.normalizedPayloadJson = { event: { send_to_meta: false } };
  let fetchCalls = 0;
  let processCalls = 0;
  const result = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_resume" },
    {
      getMetaWebhookConfigImpl: () => config({ routingEnabled: true }),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
      },
      processFacebookSourceLeadImpl: async (input) => {
        processCalls += 1;
        assert.equal(input.existingEventId, `evt_${leadgenId}`);
        return intake(leadgenId, {
          status: "routing_matched",
          matched: true,
          routingDryRunDecisionId: "dec_resume",
        });
      },
      ...harness.deps,
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.graphFetched, false);
    assert.equal(result.intake?.routingDryRunDecisionId, "dec_resume");
  }
  assert.equal(fetchCalls, 0);
  assert.equal(processCalls, 1);
});

test("other owner is in_flight during lease and may proceed after 5-minute expiry", async () => {
  const leadgenId = "lead_lease";
  const harness = memoryHarness(leadgenId);
  const started = new Date("2026-09-15T12:00:00.000Z");
  harness.store.event.enrichmentMetadataJson = {
    metaLeadgenFetch: {
      ownerId: "job_owner_a",
      state: "fetching",
      fetchStartedAt: started.toISOString(),
      liveDelivery: false,
      capiDispatched: false,
    },
  };
  let fetchCalls = 0;
  const during = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_owner_b" },
    {
      now: () => new Date(started.getTime() + 60_000),
      getMetaWebhookConfigImpl: () => config(),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
      },
      processFacebookSourceLeadImpl: async () => intake(leadgenId),
      ...harness.deps,
    }
  );
  assert.equal(during.ok, true);
  if (during.ok) assert.equal(during.skipped, "in_flight");
  assert.equal(fetchCalls, 0);

  const after = await processMetaLeadgenFetch(
    { leadgenId, sourceLeadEventId: `evt_${leadgenId}`, jobId: "job_owner_b" },
    {
      now: () => new Date(started.getTime() + 5 * 60_000 + 1),
      getMetaWebhookConfigImpl: () => config(),
      fetchMetaLeadDetailsImpl: async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, body: { id: leadgenId, field_data: [] } };
      },
      processFacebookSourceLeadImpl: async () => intake(leadgenId),
      ...harness.deps,
    }
  );
  assert.equal(after.ok, true);
  if (after.ok) assert.equal(after.graphFetched, true);
  assert.equal(fetchCalls, 1);
});
