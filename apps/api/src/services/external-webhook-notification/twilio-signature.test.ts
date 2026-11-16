import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { twilioRequestSignature, twilioSignatureMatches } from "./twilio-signature.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

test("Twilio signatures cover the public URL and sorted fields", () => {
  const url = "https://example.test/integrations/twilio/external-webhook-notice/status";
  const params = { MessageSid: `SM${"d".repeat(32)}`, MessageStatus: "delivered", ErrorCode: "" };
  const token = "c".repeat(32);
  const signature = twilioRequestSignature(url, params, token);
  assert.equal(twilioSignatureMatches(url, params, signature, token), true);
  assert.equal(twilioSignatureMatches(url, params, signature, "d".repeat(32)), false);
  assert.equal(twilioSignatureMatches("https://evil.test/status", params, signature, token), false);
  assert.equal(twilioSignatureMatches(url, { ...params, MessageStatus: "failed" }, signature, token), false);
});

test("callback routes and the notice worker are not mounted", () => {
  const app = readFileSync(path.join(repoRoot, "apps/api/src/app.ts"), "utf8");
  const worker = readFileSync(path.join(repoRoot, "apps/worker/src/worker.ts"), "utf8");
  assert.equal(app.includes("adminExternalWebhookConfigRoutes"), true);
  assert.equal(app.includes("externalWebhookNoticeCallbackRoutes"), false);
  assert.equal(app.includes("adminExternalWebhookNoticeDispatchRoutes"), false);
  assert.equal(worker.includes("processExternalWebhookNoticeJob"), false);
  assert.equal(worker.includes("scanCanonicalDeliveryNotifications"), false);
});
