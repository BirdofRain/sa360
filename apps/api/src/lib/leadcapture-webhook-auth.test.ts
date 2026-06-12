import test from "node:test";
import assert from "node:assert/strict";
import { validateLeadCaptureWebhookKey } from "./leadcapture-webhook-auth.js";

test("secret validation returns 401 path when env set and header missing", () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "test-secret-value";
  const result = validateLeadCaptureWebhookKey(undefined);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("secret validation returns 401 path when env set and header wrong", () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "test-secret-value";
  const result = validateLeadCaptureWebhookKey("wrong-key");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("secret validation passes when env set and header matches", () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "test-secret-value";
  const result = validateLeadCaptureWebhookKey("test-secret-value");
  assert.equal(result.ok, true);
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("dev mode allows missing env with warning", () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const result = validateLeadCaptureWebhookKey(undefined);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.devWarning);
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
});
