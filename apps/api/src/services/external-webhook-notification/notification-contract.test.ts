import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX } from "../delivery-success-notification/notification-claim.js";
import { normalizeRecipientEmail } from "../delivery-success-notification/notification-preference.js";
import {
  EXTERNAL_WEBHOOK_EMAIL_TEMPLATES,
  EXTERNAL_WEBHOOK_IDEMPOTENCY_KEY_MAX,
  EXTERNAL_WEBHOOK_SMS_TEMPLATES,
  deliverPreparedSms,
  externalWebhookNotificationIdempotencyKey,
  normalizeExternalWebhookEmail,
  prepareExternalWebhookNotification,
  renderExternalWebhookSms,
  smsTemplateIsSafe,
  twilioClientFromFetch,
  type ExternalWebhookAcceptance,
  type PrepareExternalWebhookNotificationInput,
} from "./notification-contract.js";
import type { TwilioMessageClient } from "./twilio-programmable-messaging.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const ACCOUNT = `AC${"a".repeat(32)}`;
const SERVICE = `MG${"b".repeat(32)}`;
const TOKEN = "c".repeat(32);
const MESSAGE = `SM${"d".repeat(32)}`;
const LEAD = {
  firstName: "LeadFirstNameZz",
  lastName: "BarnabyLeadZz",
  email: "lead.person@example.com",
  phone: "+19995550199",
  address: "19 Example Lane",
  dob: "1970-01-02",
  destinationUrl: "https://hooks.example.test/secret-path",
  acceptanceId: "acc_ZZ_NO_LEAK",
};

const ACCEPTED_AT = "2026-11-13T18:00:00.000Z";
const ENABLED_AT = "2026-11-13T17:00:00.000Z";

function acceptance(overrides: Partial<ExternalWebhookAcceptance> = {}): ExternalWebhookAcceptance {
  return {
    acceptanceId: "acc_1",
    clientAccountId: "client_1",
    sourceLeadEventId: "lead_1",
    destinationId: "dest_1",
    attemptId: "attempt_1",
    httpStatus: 200,
    acceptedAt: ACCEPTED_AT,
    ...overrides,
  };
}

function smsInput(overrides: Partial<PrepareExternalWebhookNotificationInput> = {}): PrepareExternalWebhookNotificationInput {
  return {
    event: acceptance(),
    channel: "sms",
    recipient: "+15555550100",
    preferenceEnabled: false,
    recipientVerified: false,
    enabledAt: null,
    templateId: "delivery_accepted",
    sms: {
      optIn: { optedIn: true, recordedAt: ENABLED_AT },
      stopState: "clear",
    },
    ...overrides,
  };
}

const twilioReady = {
  ok: true as const,
  config: {
    accountSid: ACCOUNT,
    authToken: TOKEN,
    messagingServiceSid: SERVICE,
    from: null,
  },
};

test("the idempotency grain is the acceptance, the channel, and the recipient", () => {
  assert.equal(EXTERNAL_WEBHOOK_IDEMPOTENCY_KEY_MAX, DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX);
  const email = externalWebhookNotificationIdempotencyKey({
    acceptanceId: "acc_1",
    channel: "email",
    recipient: " Ops@Example.com ",
  });
  const emailRetry = externalWebhookNotificationIdempotencyKey({
    acceptanceId: "acc_1",
    channel: "email",
    recipient: "ops@example.com",
  });
  const sms = externalWebhookNotificationIdempotencyKey({
    acceptanceId: "acc_1",
    channel: "sms",
    recipient: "+15555550100",
  });
  const otherRecipient = externalWebhookNotificationIdempotencyKey({
    acceptanceId: "acc_1",
    channel: "email",
    recipient: "other@example.com",
  });
  const otherAcceptance = externalWebhookNotificationIdempotencyKey({
    acceptanceId: "acc_2",
    channel: "email",
    recipient: "ops@example.com",
  });
  assert.equal(email.ok && emailRetry.ok && email.idempotencyKey === emailRetry.idempotencyKey, true);
  assert.equal(sms.ok && email.ok && sms.idempotencyKey !== email.idempotencyKey, true);
  assert.equal(otherRecipient.ok && email.ok && otherRecipient.idempotencyKey !== email.idempotencyKey, true);
  assert.equal(otherAcceptance.ok && email.ok && otherAcceptance.idempotencyKey !== email.idempotencyKey, true);
  if (email.ok) {
    assert.equal(email.idempotencyKey.includes("attempt_1"), false);
    assert.equal(email.idempotencyKey.includes("lead_1"), false);
    assert.equal(email.idempotencyKey.startsWith("external_webhook:acc_1:email:ops@example.com"), true);
  }
  assert.equal(
    externalWebhookNotificationIdempotencyKey({
      acceptanceId: "acc:1",
      channel: "email",
      recipient: "ops@example.com",
    }).ok,
    false
  );
});

test("email normalization matches the existing recipient rule", () => {
  for (const value of ["  A@B.com ", "not-an-email", "a@b.com,c@d.com", "ok@example.com", "Ann <a@b.com>"]) {
    assert.equal(normalizeExternalWebhookEmail(value), normalizeRecipientEmail(value), value);
  }
});

test("SMS templates contain no consumer lead PII and no destination URL", () => {
  const bodies = Object.values(EXTERNAL_WEBHOOK_SMS_TEMPLATES);
  assert.equal(bodies.length > 0, true);
  for (const body of bodies) {
    assert.equal(renderExternalWebhookSms("delivery_accepted"), body);
    assert.equal(smsTemplateIsSafe(body), true);
    assert.equal(body.includes("Reply STOP to opt out."), true);
    assert.equal(body.length <= 160, true);
    for (const secret of Object.values(LEAD)) {
      assert.equal(body.includes(secret), false, secret);
    }
  }
  assert.equal(smsTemplateIsSafe(`${bodies[0]} ${LEAD.email}`), false);
  assert.equal(smsTemplateIsSafe(`${bodies[0]} ${LEAD.phone}`), false);
  const email = EXTERNAL_WEBHOOK_EMAIL_TEMPLATES.delivery_accepted;
  for (const secret of Object.values(LEAD)) {
    assert.equal(email.subject.includes(secret), false);
    assert.equal(email.text.includes(secret), false);
  }
});

test("SMS planning stays skipped and does not call the provider while the flag is off", async () => {
  let calls = 0;
  const client: TwilioMessageClient = {
    async postMessage() {
      calls += 1;
      throw new Error("Twilio must not be called");
    },
  };
  const plan = prepareExternalWebhookNotification(smsInput(), {
    smsEnabled: false,
    twilioConfig: twilioReady,
  });
  assert.deepEqual(plan, { action: "skip", channel: "sms", reason: "sms_disabled" });
  const delivered = await deliverPreparedSms(plan, client, false);
  assert.equal(delivered.ok, false);
  if (!delivered.ok) assert.equal(delivered.providerMessageId, null);
  assert.equal(calls, 0);

  const armed = prepareExternalWebhookNotification(smsInput(), { smsEnabled: true, twilioConfig: twilioReady });
  assert.equal(armed.action, "send");
  const held = await deliverPreparedSms(armed, client, false);
  assert.equal(held.ok, false);
  if (!held.ok && held.skipped) assert.equal(held.reason, "sms_disabled");
  assert.equal(calls, 0);
});

test("an enabled SMS plan keeps the provider message id and refuses unsafe recipients", async () => {
  const cases: Array<[PrepareExternalWebhookNotificationInput, string]> = [
    [smsInput({ recipient: "5555550100" }), "invalid_e164"],
    [smsInput({ sms: { optIn: { optedIn: false, recordedAt: ENABLED_AT }, stopState: "clear" } }), "not_opted_in"],
    [smsInput({ sms: { optIn: { optedIn: true, recordedAt: null }, stopState: "clear" } }), "not_opted_in"],
    [smsInput({ sms: { optIn: { optedIn: true, recordedAt: ENABLED_AT }, stopState: "suppressed" } }), "stop_suppressed"],
    [smsInput({ sms: { optIn: { optedIn: true, recordedAt: ENABLED_AT }, stopState: "unknown" } }), "stop_unknown"],
    [smsInput({ event: acceptance({ httpStatus: 500 }) }), "not_accepted"],
    [smsInput({ event: acceptance({ acceptedAt: ENABLED_AT }) }), "before_enabled_at"],
    [smsInput(), "invalid_twilio_config"],
  ];
  for (const [input, reason] of cases) {
    const plan = prepareExternalWebhookNotification(input, {
      smsEnabled: true,
      twilioConfig: reason === "invalid_twilio_config" ? { ok: false, reason: "incomplete" } : twilioReady,
    });
    assert.equal(plan.action, "skip", reason);
    if (plan.action === "skip") assert.equal(plan.reason, reason);
    assert.equal(JSON.stringify(plan).includes(TOKEN), false);
    assert.equal(JSON.stringify(plan).includes(LEAD.phone), false);
  }

  const first = prepareExternalWebhookNotification(smsInput(), { smsEnabled: true, twilioConfig: twilioReady });
  const retry = prepareExternalWebhookNotification(
    smsInput({ event: acceptance({ attemptId: "attempt_2" }) }),
    { smsEnabled: true, twilioConfig: twilioReady }
  );
  assert.equal(first.action, "send");
  assert.equal(retry.action, "send");
  if (first.action === "send" && retry.action === "send") {
    assert.equal(first.idempotencyKey, retry.idempotencyKey);
    assert.equal(first.channel, "sms");
    if (first.channel === "sms") {
      assert.equal(first.request.messagingServiceSid, SERVICE);
      assert.equal(first.request.from, null);
      assert.equal(first.request.body, EXTERNAL_WEBHOOK_SMS_TEMPLATES.delivery_accepted);
      assert.equal(first.request.body.includes(LEAD.firstName), false);
      assert.equal(JSON.stringify(first).includes(TOKEN), false);
    }
  }

  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    const payload = JSON.stringify({
      sid: MESSAGE,
      status: "queued",
      body: `${LEAD.firstName} ${LEAD.phone}`,
    });
    return new Response(payload, { status: 201 });
  };
  const withSender = prepareExternalWebhookNotification(smsInput(), {
    smsEnabled: true,
    twilioConfig: { ok: true, config: { ...twilioReady.config, from: "+15555550123" } },
  });
  assert.equal(withSender.action, "send");
  if (withSender.action === "send" && withSender.channel === "sms") {
    assert.equal(withSender.request.from, "+15555550123");
  }

  const delivered = await deliverPreparedSms(first, twilioClientFromFetch(twilioReady.config, fetchImpl), true);
  assert.equal(calls, 1);
  assert.equal(delivered.ok, true);
  if (delivered.ok) {
    assert.equal(delivered.providerMessageId, MESSAGE);
    assert.equal(delivered.providerStatus, "queued");
    assert.equal(delivered.idempotencyKey, first.action === "send" ? first.idempotencyKey : "");
    assert.equal(JSON.stringify(delivered).includes(LEAD.firstName), false);
    assert.equal(JSON.stringify(delivered).includes(LEAD.phone), false);
  }
});

test("email plans use Resend's request shape and do not send", () => {
  const skipped = prepareExternalWebhookNotification(
    {
      ...smsInput({ channel: "email", recipient: "Ops@Example.com" }),
      preferenceEnabled: true,
      recipientVerified: true,
      enabledAt: ENABLED_AT,
    },
    { emailConfigured: false, smsEnabled: true }
  );
  assert.deepEqual(skipped, { action: "skip", channel: "email", reason: "email_not_configured" });

  const plan = prepareExternalWebhookNotification(
    {
      ...smsInput({ channel: "email", recipient: "Ops@Example.com" }),
      preferenceEnabled: true,
      recipientVerified: true,
      enabledAt: ENABLED_AT,
    },
    { emailConfigured: true }
  );
  assert.equal(plan.action, "send");
  if (plan.action === "send" && plan.channel === "email") {
    assert.equal(plan.provider, "resend");
    assert.equal(plan.request.to, "ops@example.com");
    assert.equal(plan.request.idempotencyKey, plan.idempotencyKey);
    assert.equal(Object.hasOwn(plan.request, "attachments"), false);
    assert.equal(plan.request.text.includes(LEAD.email), false);
  }
  const unverified = prepareExternalWebhookNotification(
    {
      ...smsInput({ channel: "email", recipient: "ops@example.com" }),
      preferenceEnabled: true,
      recipientVerified: false,
      enabledAt: ENABLED_AT,
    },
    { emailConfigured: true }
  );
  assert.equal(unverified.action, "skip");
  if (unverified.action === "skip") assert.equal(unverified.reason, "recipient_not_verified");
});

test("the adapter is not mounted on the scanner, the API entry, or the worker", () => {
  const files = [
    "apps/api/src/app.ts",
    "apps/api/src/server.ts",
    "apps/api/src/services/delivery-success-notification/scan.ts",
    "apps/worker/src/worker.ts",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    assert.equal(source.includes("external-webhook-notification"), false, file);
    assert.equal(source.includes("postTwilioProgrammableMessage"), false, file);
  }
  const scan = readFileSync(
    path.join(repoRoot, "apps/api/src/services/delivery-success-notification/scan.ts"),
    "utf8"
  );
  assert.equal(scan.includes('if (settings.armed.webhook) return { action: "withhold" }'), true);
  assert.equal(scan.includes('reason: "webhook_armed"'), true);
  assert.equal(scan.includes("customWebhookAttemptId: null"), true);
  const worker = readFileSync(path.join(repoRoot, "apps/worker/src/worker.ts"), "utf8");
  assert.equal(worker.includes("scanCanonicalDeliveryNotifications"), false);
  const contract = readFileSync(new URL("./notification-contract.ts", import.meta.url), "utf8");
  assert.equal(contract.includes("api.resend.com"), false);
  assert.equal(contract.includes("sendTransactionalEmail("), false);
  const adapter = readFileSync(new URL("./twilio-programmable-messaging.ts", import.meta.url), "utf8");
  assert.equal(adapter.includes("= fetch"), false);
});
