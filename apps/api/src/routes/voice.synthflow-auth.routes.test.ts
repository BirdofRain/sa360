import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { voiceRoutes } from "./voice.js";

const SECRET = "test-webhook-secret-for-voice-auth";
const AUTH_HEADER = { "x-sa360-secret": SECRET };

async function buildVoiceApp() {
  const app = Fastify({ logger: false });
  await app.register(voiceRoutes);
  return app;
}

async function withWebhookSecretEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prev;
  }
}

const validInboundBody = {
  event: "call_inbound",
  call_inbound: {
    from_number: "+15551234567",
    to_number: "+15559876543",
    model_id: "mdl_test",
  },
};

const validOutboundContextBody = {
  event: "call_outbound_context",
  call: {
    model_id: "mdl_test",
    from_number: "+15551230001",
    to_number: "+15559876543",
  },
};

const validOutboundResultBody = {
  event: "call_outbound_result",
  call_result: {
    call_id: "call_auth_test_1",
    from_number: "+15551230001",
    to_number: "+15559876543",
    outcome: "no_answer",
    booked: false,
  },
};

test("inbound-lookup: missing secret → 401", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/inbound-lookup",
      headers: { "content-type": "application/json" },
      payload: validInboundBody,
    });
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body) as { ok?: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "Unauthorized");
    await app.close();
  });
});

test("inbound-lookup: wrong secret → 401", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/inbound-lookup",
      headers: {
        "content-type": "application/json",
        "x-sa360-secret": "wrong",
      },
      payload: validInboundBody,
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("inbound-lookup: correct secret preserves Synthflow response shape", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/inbound-lookup",
      headers: { "content-type": "application/json", ...AUTH_HEADER },
      payload: validInboundBody,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { call_inbound?: unknown };
    assert.ok(body.call_inbound);
    await app.close();
  });
});

test("outbound-context: missing secret → 401", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-context",
      headers: { "content-type": "application/json" },
      payload: validOutboundContextBody,
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("outbound-context: wrong secret → 401", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-context",
      headers: {
        "content-type": "application/json",
        "x-sa360-secret": "nope",
      },
      payload: validOutboundContextBody,
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("outbound-context: correct secret preserves response shape", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-context",
      headers: { "content-type": "application/json", ...AUTH_HEADER },
      payload: validOutboundContextBody,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { status?: string; custom_variables?: unknown };
    assert.equal(body.status, "success");
    assert.ok(body.custom_variables);
    await app.close();
  });
});

test("outbound-result: missing secret → 401", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-result",
      headers: { "content-type": "application/json" },
      payload: validOutboundResultBody,
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("outbound-result: wrong secret → 401", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-result",
      headers: {
        "content-type": "application/json",
        "x-sa360-secret": "bad",
      },
      payload: validOutboundResultBody,
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("outbound-result: correct secret allows persistence path (ok true or persist_failed)", async () => {
  await withWebhookSecretEnv(async () => {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-result",
      headers: { "content-type": "application/json", ...AUTH_HEADER },
      payload: validOutboundResultBody,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { ok?: boolean; id?: string; error?: string };
    assert.equal(body.ok === true || body.error === "persist_failed", true);
    await app.close();
  });
});
