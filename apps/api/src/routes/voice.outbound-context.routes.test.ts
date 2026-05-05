import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { voiceRoutes } from "./voice.js";

const SECRET = "test-secret-outbound-context-route";
const AUTH = { "x-sa360-secret": SECRET };

async function buildVoiceApp() {
  const app = Fastify({ logger: false });
  await app.register(voiceRoutes);
  return app;
}

test("POST /voice/synthflow/outbound-context invalid payload → guardrail JSON", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  try {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-context",
      headers: { "content-type": "application/json", ...AUTH },
      payload: { event: "wrong" },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      status: string;
      custom_variables: Record<string, string>;
      metadata: { lookup_status: string };
    };
    assert.equal(body.status, "success");
    assert.equal(body.metadata.lookup_status, "invalid_payload");
    assert.equal(body.custom_variables.booking_allowed, "false");
    assert.equal(body.custom_variables.script_goal, "REVIEW_REQUIRED");
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prev;
  }
});
