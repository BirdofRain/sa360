import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  validateMetaSignature,
  verifyMetaWebhookChallenge,
} from "./meta-webhook.js";

test("verifyMetaWebhookChallenge returns challenge on valid subscribe + token", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "subscribe", "hub.verify_token": "vt-123", "hub.challenge": "echo-me" },
    "vt-123"
  );
  assert.deepEqual(result, { ok: true, challenge: "echo-me" });
});

test("verifyMetaWebhookChallenge rejects wrong token", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "echo-me" },
    "vt-123"
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "token_mismatch");
});

test("verifyMetaWebhookChallenge rejects wrong mode", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "unsubscribe", "hub.verify_token": "vt-123", "hub.challenge": "x" },
    "vt-123"
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "mode_mismatch");
});

test("verifyMetaWebhookChallenge fails when no verify token configured", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "x" },
    null
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "missing_config");
});

test("validateMetaSignature skips when no app secret configured", () => {
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "development";
  const result = validateMetaSignature("{}", undefined, null);
  assert.deepEqual(result, { ok: true, skipped: true });
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("validateMetaSignature fails closed in production when META_APP_SECRET is missing", () => {
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "production";
  const result = validateMetaSignature("{}", undefined, null);
  assert.deepEqual(result, { ok: false, reason: "missing_secret" });
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("validateMetaSignature accepts a correct sha256 signature", () => {
  const secret = "app-secret-xyz";
  const body = JSON.stringify({ entry: [{ id: "page_1" }] });
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const result = validateMetaSignature(body, `sha256=${digest}`, secret);
  assert.deepEqual(result, { ok: true, skipped: false });
});

test("validateMetaSignature rejects a tampered body", () => {
  const secret = "app-secret-xyz";
  const body = JSON.stringify({ entry: [{ id: "page_1" }] });
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const result = validateMetaSignature(`${body} `, `sha256=${digest}`, secret);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("validateMetaSignature rejects a missing signature header when secret set", () => {
  const result = validateMetaSignature("{}", undefined, "app-secret-xyz");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "missing_signature");
});
