import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getExecutionAdapter } from "./execution-adapter.registry.js";

const SECRET = "signing-secret-do-not-leak";
const LEAD_EMAIL = "lead.person@example.test";
const LEAD_PHONE = "+15551212000";
const ENDPOINT = `https://user:${SECRET}@hooks.example.test/v1/leads?token=${SECRET}&email=${LEAD_EMAIL}`;

function withWebhookFlag<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> | T {
  const previous = process.env.SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED;
  if (value === undefined) delete process.env.SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED;
  else process.env.SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED = value;
  const restore = () => {
    if (previous === undefined) delete process.env.SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED;
    else process.env.SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED = previous;
  };
  try {
    const result = run();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("webhook adapter source does not implement live delivery or a network client", () => {
  const source = readFileSync(new URL("./custom-webhook-execution.adapter.ts", import.meta.url), "utf8");
  for (const token of [
    "node:http",
    "node:https",
    "node:net",
    "undici",
    "fetch(",
    "http.request",
    "https.request",
    "net.connect",
    "deliverLive",
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});

test("simulation makes no network call and returns a redacted request", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.push("fetch");
    throw new Error("network call");
  }) as typeof fetch;
  try {
    await withWebhookFlag("true", async () => {
      const adapter = getExecutionAdapter("webhook.generic.v1");
      assert.ok(adapter);
      assert.equal(Object.hasOwn(adapter, "deliverLive"), false);
      const payload = adapter.buildPayload({
        allocationId: "alloc_1",
        instructionId: "instr_1",
        configMetadata: {
          endpointUrl: ENDPOINT,
          signingSecret: SECRET,
          signingSecretCiphertext: "ciphertext-value",
          authorization: "Bearer secret-token",
          email: LEAD_EMAIL,
          phone: LEAD_PHONE,
          firstName: "Lead",
          lastName: "Person",
        },
      });
      const result = await adapter.simulate({ payload });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const encoded = JSON.stringify(result);
      assert.equal(result.sanitizedResponse.endpointHost, "hooks.example.test");
      assert.equal(result.sanitizedResponse.externalCallExecuted, false);
      assert.equal(result.sanitizedResponse.networkAttempted, false);
      assert.equal(result.sanitizedResponse.signingSecretPresent, true);
      assert.equal(encoded.includes(SECRET), false);
      assert.equal(encoded.includes(ENDPOINT), false);
      assert.equal(encoded.includes(LEAD_EMAIL), false);
      assert.equal(encoded.includes(LEAD_PHONE), false);
      assert.equal(encoded.includes("Bearer"), false);
      assert.equal(encoded.includes("ciphertext-value"), false);
      assert.equal(encoded.includes("/v1/leads"), false);
      assert.equal(calls.length, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the webhook gate stays off unless the flag is the exact string true", async () => {
  const adapter = getExecutionAdapter("webhook.generic.v1");
  assert.ok(adapter);
  for (const value of [undefined, "", "TRUE", "1", "yes", "on", "false"]) {
    await withWebhookFlag(value, async () => {
      const validation = adapter.validateTarget({
        configMetadata: { endpointUrl: "https://hooks.example.test/hook" },
      });
      assert.equal(validation.ok, false);
      if (!validation.ok) assert.equal(validation.reason, "custom_webhook_disabled");
      const result = await adapter.simulate({
        payload: { endpointHost: "hooks.example.test", instructionId: "instr_1" },
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.errorCode, "custom_webhook_disabled");
      assert.equal(JSON.stringify(result).includes("hooks.example.test"), false);
    });
  }
});

test("ghl and sheets execution registration is unchanged by the webhook adapter", () => {
  const ghl = getExecutionAdapter("ghl.crm.v1");
  assert.equal(ghl?.adapterKey, "ghl.crm.v1");
  assert.equal(typeof ghl?.deliverLive, "function");
  assert.equal(getExecutionAdapter("google_sheets.v1"), null);
  assert.equal(getExecutionAdapter("google_sheets.company.v1"), null);
  assert.equal(typeof getExecutionAdapter("file_export.csv.v1")?.simulate, "function");
  assert.equal(getExecutionAdapter("file_export.csv.v1")?.deliverLive, undefined);
});
