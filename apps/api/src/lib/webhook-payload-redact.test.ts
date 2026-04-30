import test from "node:test";
import assert from "node:assert/strict";
import { redactWebhookPayloadForLog } from "@sa360/shared";

test("redactWebhookPayloadForLog removes obvious secret keys", () => {
  const out = redactWebhookPayloadForLog({
    client_account_id: "acme",
    nested: { api_key: "should-not-appear", safe: 1 },
  }) as Record<string, unknown>;
  assert.equal(out.client_account_id, "acme");
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.api_key, "***REDACTED***");
  assert.equal(nested.safe, 1);
});

test("redactWebhookPayloadForLog redacts bearer-like strings", () => {
  const out = redactWebhookPayloadForLog({
    note: "Bearer super-secret-token-value",
  }) as Record<string, unknown>;
  assert.equal(out.note, "[redacted:bearer]");
});

test("redactWebhookPayloadForLog returns stub when output would be oversized", () => {
  const obj: Record<string, string> = {};
  for (let i = 0; i < 5000; i++) {
    obj[`f${i}`] = "z".repeat(30);
  }
  const out = redactWebhookPayloadForLog(obj) as Record<string, unknown>;
  assert.equal(out._sa360_redaction, "oversized");
  assert.equal(typeof out.approxUtf8Bytes, "number");
});
