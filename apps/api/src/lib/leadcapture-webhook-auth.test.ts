import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLeadCaptureWebhookAuth,
  validateLeadCaptureWebhookKey,
} from "./leadcapture-webhook-auth.js";

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

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

test("valid Basic Auth succeeds with default username", () => {
  const prevSecret = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const prevUser = process.env.SA360_LEADCAPTURE_BASIC_AUTH_USERNAME;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "test-secret-value";
  delete process.env.SA360_LEADCAPTURE_BASIC_AUTH_USERNAME;
  const result = validateLeadCaptureWebhookAuth({
    authorizationHeader: basicAuthHeader("sa360-leadcapture", "test-secret-value"),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.method, "basic");
  if (prevSecret !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prevSecret;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  if (prevUser !== undefined) process.env.SA360_LEADCAPTURE_BASIC_AUTH_USERNAME = prevUser;
});

test("invalid Basic Auth fails", () => {
  const prevSecret = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "test-secret-value";
  const result = validateLeadCaptureWebhookAuth({
    authorizationHeader: basicAuthHeader("sa360-leadcapture", "wrong-password"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid");
  if (prevSecret !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prevSecret;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
});

test("dev mode allows missing env with warning", () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "development";
  delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const result = validateLeadCaptureWebhookKey(undefined);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.devWarning);
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("production mode fails closed when LeadCapture secret is missing", () => {
  const prev = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "production";
  delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  const result = validateLeadCaptureWebhookKey(undefined);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "integration_not_configured");
  }
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prev;
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});
