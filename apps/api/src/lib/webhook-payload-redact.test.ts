import test from "node:test";
import assert from "node:assert/strict";
import { redactWebhookPayloadForLog } from "@sa360/shared";

test("redactWebhookPayloadForLog removes obvious secret keys", () => {
  const out = redactWebhookPayloadForLog({
    client_account_id: "acme",
    portalPasswordHash: "scrypt$should-not-appear",
    portalInviteTokenHash: "abc123tokenhash",
    nested: { api_key: "should-not-appear", safe: 1 },
  }) as Record<string, unknown>;
  assert.equal(out.client_account_id, "acme");
  assert.equal(out.portalPasswordHash, "***REDACTED***");
  assert.equal(out.portalInviteTokenHash, "***REDACTED***");
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.api_key, "***REDACTED***");
  assert.equal(nested.safe, 1);
});

test("redactWebhookPayloadForLog redacts hub.verify_token and never retains the token value", () => {
  const out = redactWebhookPayloadForLog({
    "hub.mode": "subscribe",
    "hub.verify_token": "super-secret-verify-token",
    "hub.challenge": "echo-me",
    access_token: "EAAB-must-not-appear",
  }) as Record<string, unknown>;
  assert.equal(out["hub.mode"], "subscribe");
  assert.equal(out["hub.challenge"], "echo-me");
  assert.equal(out["hub.verify_token"], "***REDACTED***");
  assert.equal(out.access_token, "***REDACTED***");
  assert.equal(JSON.stringify(out).includes("super-secret-verify-token"), false);
  assert.equal(JSON.stringify(out).includes("EAAB-must-not-appear"), false);
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
