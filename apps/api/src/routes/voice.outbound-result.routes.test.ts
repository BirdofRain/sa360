import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { voiceRoutes } from "./voice.js";

const SECRET = "test-secret-outbound-result-route";
const AUTH = { "x-sa360-secret": SECRET };

async function buildVoiceApp() {
  const app = Fastify({ logger: false });
  await app.register(voiceRoutes);
  return app;
}

test("POST /voice/synthflow/outbound-result invalid payload → ok false", async () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
  try {
    const app = await buildVoiceApp();
    const res = await app.inject({
      method: "POST",
      url: "/voice/synthflow/outbound-result",
      headers: { "content-type": "application/json", ...AUTH },
      payload: { event: "wrong" },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_payload");
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prev;
  }
});
