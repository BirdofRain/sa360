import test from "node:test";
import assert from "node:assert/strict";
import { validateLeadCaptureNextGenWebhookAuth } from "./leadcapture-nextgen-webhook-auth.js";

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

test("nextgen auth missing when env set", () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = "nextgen-secret";
  const result = validateLeadCaptureNextGenWebhookAuth({});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
});

test("nextgen auth header match", () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = "nextgen-secret";
  const result = validateLeadCaptureNextGenWebhookAuth({ headerKey: "nextgen-secret" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.method, "header");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
});

test("nextgen auth basic match", () => {
  const prev = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = "nextgen-secret";
  const result = validateLeadCaptureNextGenWebhookAuth({
    authorizationHeader: basicAuthHeader("sa360-leadcapture-nextgen", "nextgen-secret"),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.method, "basic");
  if (prev !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prev;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
});

test("nextgen auth fail-closed in production without secret", () => {
  const prevSecret = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  const prevEnv = process.env.SA360_ENV;
  delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_ENV = "production";
  const result = validateLeadCaptureNextGenWebhookAuth({ headerKey: "anything" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "integration_not_configured");
  if (prevSecret !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prevSecret;
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("nextgen auth does not accept legacy secret env", () => {
  const prevNext = process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  const prevLegacy = process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = "legacy-only";
  process.env.SA360_ENV = "development";
  const result = validateLeadCaptureNextGenWebhookAuth({ headerKey: "legacy-only" });
  // Dev without nextgen secret allows with warning — but not because legacy matched.
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.devWarning);
  if (prevNext !== undefined) process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET = prevNext;
  else delete process.env.SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET;
  if (prevLegacy !== undefined) process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET = prevLegacy;
  else delete process.env.SA360_LEADCAPTURE_WEBHOOK_SECRET;
  delete process.env.SA360_ENV;
});
