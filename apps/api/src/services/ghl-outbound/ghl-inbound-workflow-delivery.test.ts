import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGhlInboundWorkflowPayload,
  classifyInboundWebhookStatus,
  deliverGhlInboundWebhook,
  ghlInboundWebhookIdempotencyKey,
  isSafeInboundWebhookUrl,
  sendIsAllowed,
  type InboundWebhookDeps,
  type InboundWebhookRun,
  type InboundWebhookTarget,
} from "./ghl-inbound-workflow-delivery.js";

const ENDPOINT = "https://example.test/hook";

function memoryDeps(input?: {
  enabled?: boolean;
  target?: InboundWebhookTarget | null;
  fetchImpl?: typeof fetch;
}): { deps: InboundWebhookDeps; calls: string[] } {
  const runs = new Map<string, InboundWebhookRun>();
  const calls: string[] = [];
  let seq = 0;
  const target = input?.target === undefined
    ? {
        endpointUrl: ENDPOINT,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: new Date("2026-10-26T00:00:00.000Z"),
      }
    : input.target;
  const deps: InboundWebhookDeps = {
    enabled: input?.enabled ?? true,
    loadTarget: async () => target,
    findRun: async (key) => runs.get(key) ?? null,
    createPending: async ({ idempotencyKey }) => {
      if (runs.has(idempotencyKey)) return "conflict";
      const run: InboundWebhookRun = { id: `run-${++seq}`, status: "pending", summary: "not_sent" };
      runs.set(idempotencyKey, run);
      return run;
    },
    claim: async (id) => {
      for (const run of runs.values()) {
        if (run.id === id && run.status === "pending") {
          run.status = "executing";
          return true;
        }
      }
      return false;
    },
    finish: async (id, status, summary) => {
      for (const run of runs.values()) {
        if (run.id === id) {
          run.status = status;
          run.summary = summary;
        }
      }
    },
    fetch: input?.fetchImpl ?? (async () => {
      calls.push("post");
      return new Response("ok", { status: 200 });
    }),
  };
  return { deps, calls };
}

const base = {
  status: "routing_matched",
  clientAccountId: "client_a",
  resolvedAt: new Date("2026-10-26T12:00:00.000Z"),
  payload: buildGhlInboundWorkflowPayload({
    sourceLeadEventId: "event-1",
    clientAccountId: "client_a",
    receivedAt: "2026-10-26T12:00:00.000Z",
    contact: { email: "ada@example.test", phone: "+15551212", firstName: "Ada" },
  }),
};

test("idempotency key follows the lead event and ignores contact identity", () => {
  assert.equal(ghlInboundWebhookIdempotencyKey("client_a", "event-1"), "ghl-webhook:client_a:event-1");
  assert.notEqual(
    ghlInboundWebhookIdempotencyKey("client_a", "event-1"),
    ghlInboundWebhookIdempotencyKey("client_a", "event-2")
  );
  assert.equal(sendIsAllowed(null), true);
  assert.equal(sendIsAllowed({ id: "1", status: "pending", summary: null }), true);
  assert.equal(sendIsAllowed({ id: "1", status: "unknown_outcome", summary: null }), false);
  assert.equal(sendIsAllowed({ id: "1", status: "succeeded", summary: null }), false);
});

test("flag off and an unarmed client do not post", async () => {
  const off = memoryDeps({ enabled: false });
  const disabled = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, off.deps);
  assert.equal(disabled.outcome, "disabled");
  assert.equal(off.calls.length, 0);

  const unarmed = memoryDeps({
    target: { endpointUrl: ENDPOINT, campaignDispatchEnabled: false, campaignDispatchNotBefore: null },
  });
  const result = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, unarmed.deps);
  assert.equal(result.outcome, "not_armed");
  assert.equal(unarmed.calls.length, 0);

  const early = memoryDeps({
    target: {
      endpointUrl: ENDPOINT,
      campaignDispatchEnabled: true,
      campaignDispatchNotBefore: new Date("2026-10-27T00:00:00.000Z"),
    },
  });
  const beforeCutoff = await deliverGhlInboundWebhook(
    { ...base, sourceLeadEventId: "event-1" },
    early.deps
  );
  assert.equal(beforeCutoff.outcome, "before_cutoff");
  assert.equal(beforeCutoff.externalCallExecuted, false);
  assert.equal(early.calls.length, 0);
});

test("two submissions with the same contact each post once", async () => {
  const world = memoryDeps();
  const first = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, world.deps);
  const second = await deliverGhlInboundWebhook(
    {
      ...base,
      sourceLeadEventId: "event-2",
      payload: buildGhlInboundWorkflowPayload({
        sourceLeadEventId: "event-2",
        clientAccountId: "client_a",
        receivedAt: "2026-10-26T12:05:00.000Z",
        contact: { email: "ada@example.test", phone: "+15551212", firstName: "Ada" },
      }),
    },
    world.deps
  );
  const replay = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, world.deps);
  assert.equal(first.outcome, "sent");
  assert.equal(second.outcome, "sent");
  assert.equal(replay.outcome, "duplicate");
  assert.equal(replay.externalCallExecuted, false);
  assert.equal(world.calls.length, 2);
});

test("timeout and 5xx are not posted again", async () => {
  let attempts = 0;
  const timeout = memoryDeps({
    fetchImpl: async () => {
      attempts += 1;
      throw new Error("https://example.test/hook aborted");
    },
  });
  const first = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, timeout.deps);
  const second = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, timeout.deps);
  assert.equal(first.outcome, "unknown");
  assert.equal(second.outcome, "duplicate");
  assert.equal(attempts, 1);

  attempts = 0;
  const serverError = memoryDeps({
    fetchImpl: async () => {
      attempts += 1;
      return new Response("no", { status: 500 });
    },
  });
  const failed = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-9" }, serverError.deps);
  const again = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-9" }, serverError.deps);
  assert.equal(failed.outcome, "unknown");
  assert.equal(again.outcome, "duplicate");
  assert.equal(attempts, 1);
  assert.equal(classifyInboundWebhookStatus(500), "unknown");
  assert.equal(classifyInboundWebhookStatus(429), "rate_limited");
  assert.equal(classifyInboundWebhookStatus(400), "rejected");
});

test("a refused 429 is not retried inside the same attempt and can be sent later", async () => {
  let attempts = 0;
  const world = memoryDeps({
    fetchImpl: async () => {
      attempts += 1;
      return new Response("slow", { status: 429 });
    },
  });
  const first = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-429" }, world.deps);
  assert.equal(first.outcome, "rate_limited");
  assert.equal(first.externalCallExecuted, false);
  assert.equal(attempts, 1);
  const second = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-429" }, world.deps);
  assert.equal(second.outcome, "rate_limited");
  assert.equal(attempts, 2);
});

test("a private or non-https endpoint is not called", async () => {
  const world = memoryDeps({
    target: {
      endpointUrl: "http://example.test/hook",
      campaignDispatchEnabled: true,
      campaignDispatchNotBefore: new Date("2026-10-26T00:00:00.000Z"),
    },
  });
  const result = await deliverGhlInboundWebhook({ ...base, sourceLeadEventId: "event-1" }, world.deps);
  assert.equal(result.outcome, "invalid_endpoint");
  assert.equal(result.externalCallExecuted, false);
  assert.equal(isSafeInboundWebhookUrl("https://user:secret@example.test/hook"), false);
  assert.equal(isSafeInboundWebhookUrl(ENDPOINT), true);
});
