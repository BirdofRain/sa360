import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { CLIENT_PORTAL_ASSERTION_HEADER, createClientPortalAssertion } from "@sa360/shared/client-portal-assertion";
import { signStaffAssertion, STAFF_ASSERTION_HEADER } from "@sa360/shared/staff-assertion";
import Fastify from "fastify";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminExternalWebhookNoticeDispatchRoutes } from "../../routes/admin-external-webhook-notice-dispatch.js";
import { adminSmsVerbalConsentRoutes } from "../../routes/admin-sms-verbal-consent.js";
import { clientSmsOptInRoutes } from "../../routes/client-sms-opt-in.js";
import { publicSmsOptInRoutes } from "../../routes/public-sms-opt-in.js";
import { externalWebhookNoticeCallbackRoutes } from "../../routes/external-webhook-notice-callbacks.js";
import { discoverExternalWebhookNotices } from "./notice-discovery.js";
import { dispatchExternalWebhookNotice } from "./notice-dispatch.js";
import { runIsolatedSmsCanary } from "./sms-canary.js";
import { confirmSmsHandsetInbound, recordNotificationPhone, recordSmsConsent, setSmsNotificationEnabled, suppressSmsLocally, SMS_CONSENT_VERSION_V2 } from "./sms-consent.js";
import { beginRecipientSmsOptIn, recordRecipientSmsConsent, setRecipientSmsEnabled } from "./sms-opt-in.js";
import { confirmSmsOptInLink, issueSmsOptInLink, readSmsConsentStatus } from "./sms-opt-in-link.js";
import { SMS_CONSENT_VERSION_GHL, composeSmsConsentText } from "./sms-disclosure.js";
import { twilioRequestSignature } from "./twilio-signature.js";
import { readTwilioMessagingConfig } from "./twilio-programmable-messaging.js";

const PORTAL_KEY = "portal-sms-opt-in-test";
const ADMIN_KEY = "admin-sms-canary-test";
const TOKEN = "d".repeat(32);
const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";
const STATUS_URL = "https://hooks.example.test/integrations/twilio/external-webhook-notice/status";
const INBOUND_URL = "https://hooks.example.test/integrations/twilio/external-webhook-notice/inbound";
const twilioReady = readTwilioMessagingConfig({
  SA360_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  SA360_TWILIO_AUTH_TOKEN: TOKEN,
  SA360_TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
});
const clientIds: string[] = [];
const previousPortalKey = process.env.CLIENT_PORTAL_API_KEY;
const previousAdminKey = process.env.ADMIN_API_KEY;

function optInEnv(clientAccountId: string): NodeJS.ProcessEnv {
  return {
    SA360_SMS_OPT_IN_CLIENT_ACCOUNT_ID: clientAccountId,
    SA360_SMS_PRIVACY_POLICY_URL: PRIVACY,
    SA360_SMS_TERMS_URL: TERMS,
    SA360_SMS_HANDSET_PROOF_ENABLED: "true",
    SA360_SMS_INBOUND_OPT_OUT_ENABLED: "true",
  };
}

before(() => {
  process.env.CLIENT_PORTAL_API_KEY = PORTAL_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
});

after(async () => {
  if (previousPortalKey == null) delete process.env.CLIENT_PORTAL_API_KEY;
  else process.env.CLIENT_PORTAL_API_KEY = previousPortalKey;
  if (previousAdminKey == null) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previousAdminKey;
  if (clientIds.length > 0) {
    await prisma.externalWebhookNotificationReceipt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await prisma.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  }
});

async function createClient(): Promise<string> {
  const clientAccountId = `sms_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "SMS sandbox",
      status: "onboarding",
      portalEnabled: true,
      portalSessionEpoch: 0,
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function accept(clientAccountId: string, leadId: string) {
  const destination = await prisma.clientExternalWebhookDestination.upsert({
    where: { clientAccountId },
    update: {},
    create: {
      clientAccountId,
      kind: "ghl_inbound",
      endpointUrlCiphertext: "aaa.bbb.ccc",
      endpointUrlFingerprint: "0123456789abcdef",
      endpointHost: "hooks.example.com",
    },
  });
  const payload = JSON.stringify({ note: "delivery-accepted" });
  const attempt = await prisma.externalWebhookDeliveryAttempt.create({
    data: {
      idempotencyKey: `external-webhook:${clientAccountId}:${leadId}`,
      clientAccountId,
      destinationId: destination.id,
      sourceLeadEventId: leadId,
      kind: "ghl_inbound",
      destinationRevision: 1,
      endpointHost: "hooks.example.com",
      endpointUrlFingerprint: "0123456789abcdef",
      mappingMode: "v3_canonical",
      payloadCanonicalJson: payload,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    },
  });
  return prisma.externalWebhookDeliveryAttempt.update({
    where: { id: attempt.id },
    data: { state: "attempted", outcome: "http_accepted", httpStatus: 200, requestLeftSa360: true, proves: ["http_2xx"] },
  });
}

function portalHeaders(clientAccountId: string) {
  return {
    "x-sa360-client-portal-key": PORTAL_KEY,
    [CLIENT_PORTAL_ASSERTION_HEADER]: createClientPortalAssertion(
      { clientAccountId, portalSessionEpoch: 0 },
      PORTAL_KEY
    ),
  };
}

test("recipient opt-in keeps phone, consent, handset proof, and STOP apart", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await createClient();
  const phone = "+15555551901";
  const blocked = Fastify();
  await blocked.register(clientSmsOptInRoutes, { env: {} });
  const hidden = await blocked.inject({ method: "GET", url: "/sms-opt-in", headers: portalHeaders(clientAccountId) });
  assert.equal(hidden.statusCode, 404);
  await blocked.close();

  const app = Fastify();
  await app.register(clientSmsOptInRoutes, { env: optInEnv(clientAccountId) });
  const unchecked = await app.inject({
    method: "POST",
    url: "/sms-opt-in",
    headers: { ...portalHeaders(clientAccountId), "content-type": "application/json" },
    payload: { phoneE164: phone, affirmDisclosure: false, version: SMS_CONSENT_VERSION_GHL },
  });
  assert.equal(unchecked.statusCode, 400);
  assert.match(unchecked.body, /consent_not_affirmed/);
  assert.equal(await prisma.clientDeliveryNotificationPreference.count({ where: { clientAccountId } }), 0);
  const urlsMissing = Fastify();
  await urlsMissing.register(clientSmsOptInRoutes, {
    env: { SA360_SMS_OPT_IN_CLIENT_ACCOUNT_ID: clientAccountId },
  });
  const missing = await urlsMissing.inject({
    method: "POST",
    url: "/sms-opt-in",
    headers: { ...portalHeaders(clientAccountId), "content-type": "application/json" },
    payload: { phoneE164: phone, affirmDisclosure: true, version: SMS_CONSENT_VERSION_GHL },
  });
  assert.equal(missing.statusCode, 409);
  assert.match(missing.body, /legal_urls_missing/);
  assert.equal(await prisma.clientDeliveryNotificationPreference.count({ where: { clientAccountId } }), 0);
  await urlsMissing.close();

  const begun = await app.inject({
    method: "POST",
    url: "/sms-opt-in",
    headers: { ...portalHeaders(clientAccountId), "content-type": "application/json" },
    payload: { phoneE164: phone, affirmDisclosure: true, version: SMS_CONSENT_VERSION_GHL },
  });
  assert.equal(begun.statusCode, 200);
  const started = begun.json() as {
    consentRecorded: boolean;
    handsetProven: boolean;
    smsEnabled: boolean;
    challengeCode: string;
    disclosure: { privacyPolicyUrl: string; termsUrl: string; recordable: boolean };
  };
  assert.equal(started.consentRecorded, false);
  assert.equal(started.handsetProven, false);
  assert.equal(started.smsEnabled, false);
  assert.equal(started.disclosure.recordable, true);
  assert.equal(started.disclosure.privacyPolicyUrl, PRIVACY);
  assert.match(started.challengeCode, /^\d{6}$/);
  const filed = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.ok(filed.recipientPhoneVerifiedAt);
  assert.equal(filed.smsHandsetProvenAt, null);
  assert.equal(filed.smsConsentRecordedAt, null);
  assert.equal(filed.smsConsentText, null);

  const callbacks = Fastify();
  await callbacks.register(externalWebhookNoticeCallbackRoutes, {
    statusUrl: STATUS_URL,
    inboundUrl: INBOUND_URL,
    authToken: TOKEN,
    env: optInEnv(clientAccountId),
  });
  const ownParams = { From: phone, Body: `OWN ${started.challengeCode}` };
  const unsigned = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "nope" },
    payload: new URLSearchParams(ownParams).toString(),
  });
  assert.equal(unsigned.statusCode, 403);
  assert.equal(
    (await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } })).smsHandsetProvenAt,
    null
  );
  const owned = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, ownParams, TOKEN),
    },
    payload: new URLSearchParams(ownParams).toString(),
  });
  assert.equal(owned.statusCode, 200);
  assert.match(owned.body, /handset_proven/);
  const proven = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.ok(proven.smsHandsetProvenAt);
  assert.equal(proven.smsConsentRecordedAt, null);
  assert.equal(proven.smsEnabled, false);

  const consented = await app.inject({
    method: "POST",
    url: "/sms-opt-in/consent",
    headers: { ...portalHeaders(clientAccountId), "content-type": "application/json" },
    payload: { affirmDisclosure: true, version: SMS_CONSENT_VERSION_GHL },
  });
  assert.equal(consented.statusCode, 200);
  const consentBody = consented.json() as { consentRecorded: boolean; smsEnabled: boolean; consentVersion: string };
  assert.equal(consentBody.consentRecorded, true);
  assert.equal(consentBody.smsEnabled, false);
  assert.equal(consentBody.consentVersion, SMS_CONSENT_VERSION_GHL);
  const consentedRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.ok(consentedRow.smsConsentRecordedAt);
  assert.equal(consentedRow.smsConsentVersion, SMS_CONSENT_VERSION_GHL);
  assert.match(consentedRow.smsConsentText ?? "", /Life Agent Launch/);
  assert.match(consentedRow.smsConsentText ?? "", /Message and data rates may apply/);
  assert.match(consentedRow.smsConsentText ?? "", /Reply STOP to opt out/);
  assert.match(consentedRow.smsConsentText ?? "", /Reply HELP for help/);

  const enabled = await app.inject({
    method: "POST",
    url: "/sms-opt-in/enabled",
    headers: { ...portalHeaders(clientAccountId), "content-type": "application/json" },
    payload: { enabled: true },
  });
  assert.equal(enabled.statusCode, 200);
  const enabledRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(enabledRow.smsEnabled, true);
  assert.ok(enabledRow.smsEnabledAt);
  assert.ok(enabledRow.smsEnabledAt.getTime() >= consentedRow.smsConsentRecordedAt!.getTime());

  const stopParams = { From: phone, Body: "STOP" };
  const stopped = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, stopParams, TOKEN),
    },
    payload: new URLSearchParams(stopParams).toString(),
  });
  assert.equal(stopped.statusCode, 200);
  assert.match(stopped.body, /suppressed/);
  const duplicateStop = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, stopParams, TOKEN),
    },
    payload: new URLSearchParams(stopParams).toString(),
  });
  assert.equal(duplicateStop.statusCode, 200);
  const startParams = { From: phone, Body: "START" };
  const startedAgain = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, startParams, TOKEN),
    },
    payload: new URLSearchParams(startParams).toString(),
  });
  assert.equal(startedAgain.statusCode, 200);
  assert.match(startedAgain.body, /ignored/);
  const afterStart = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(afterStart.smsSuppressionState, "suppressed");
  assert.equal(afterStart.smsEnabled, false);
  assert.ok(afterStart.smsSuppressedAt);
  await app.close();
  await callbacks.close();
});

test("a canary cannot discover history or send email, and it places at most one SMS", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const sandbox = await createClient();
  const historical = await createClient();
  const phone = "+15555551902";
  const env = {
    ...optInEnv(sandbox),
    SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true",
    SA360_SMS_NOTIFICATIONS_ENABLED: "true",
    SA360_SMS_CANARY_ENABLED: "true",
    SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: sandbox,
    SA360_SMS_CANARY_RECIPIENT_E164: phone,
  };
  const portal = Fastify();
  await portal.register(clientSmsOptInRoutes, { env });
  const begun = await portal.inject({
    method: "POST",
    url: "/sms-opt-in",
    headers: { ...portalHeaders(sandbox), "content-type": "application/json" },
    payload: { phoneE164: phone, affirmDisclosure: true, version: SMS_CONSENT_VERSION_GHL },
  });
  const code = (begun.json() as { challengeCode: string }).challengeCode;
  const callbacks = Fastify();
  await callbacks.register(externalWebhookNoticeCallbackRoutes, {
    statusUrl: STATUS_URL,
    inboundUrl: INBOUND_URL,
    authToken: TOKEN,
    env,
  });
  const ownParams = { From: phone, Body: `OWN ${code}` };
  await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, ownParams, TOKEN),
    },
    payload: new URLSearchParams(ownParams).toString(),
  });
  const consented = await portal.inject({
    method: "POST",
    url: "/sms-opt-in/consent",
    headers: { ...portalHeaders(sandbox), "content-type": "application/json" },
    payload: { affirmDisclosure: true, version: SMS_CONSENT_VERSION_GHL },
  });
  assert.equal(consented.statusCode, 200);
  const enabled = await portal.inject({
    method: "POST",
    url: "/sms-opt-in/enabled",
    headers: { ...portalHeaders(sandbox), "content-type": "application/json" },
    payload: { enabled: true },
  });
  assert.equal(enabled.statusCode, 200);
  const ghlConsent = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId: sandbox },
  });
  assert.equal(ghlConsent.smsConsentVersion, SMS_CONSENT_VERSION_GHL);

  const attempt = await accept(sandbox, "canary_lead");
  const oldAttempt = await accept(historical, "historical_lead");
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId: historical,
      enabled: true,
      recipientEmail: "historical-ops@example.com",
      recipientEmailVerifiedAt: new Date(Date.now() - 120_000),
      enabledAt: new Date(Date.now() - 120_000),
    },
  });
  const canaryEnv = { ...env, SA360_SMS_CANARY_ATTEMPT_ID: attempt.id };
  const cursorBefore = await prisma.externalWebhookNoticeDiscoveryCursor.findUnique({ where: { id: "acceptance" } });
  const discovered = await discoverExternalWebhookNotices(prisma, {
    env: canaryEnv,
    now: new Date(Date.now() + 60_000),
    emailConfigured: true,
    twilioConfig: twilioReady,
    enqueue: async () => {
      throw new Error("discovery_enqueue");
    },
  });
  assert.equal(discovered.skipped, "canary_isolation");
  assert.equal(discovered.scanned, 0);
  assert.equal(discovered.enqueued, 0);
  const cursorAfter = await prisma.externalWebhookNoticeDiscoveryCursor.findUnique({ where: { id: "acceptance" } });
  assert.equal(cursorAfter?.lastAttemptId ?? null, cursorBefore?.lastAttemptId ?? null);
  assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: oldAttempt.id } }), 0);

  const admin = Fastify();
  await admin.register(adminExternalWebhookNoticeDispatchRoutes, { env: canaryEnv });
  const drain = await admin.inject({
    method: "POST",
    url: "/external-webhook-notice/internal/discover",
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(drain.statusCode, 200);
  assert.match(drain.body, /canary_isolation/);
  assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { clientAccountId: historical } }), 0);

  let smsCalls = 0;
  let emailCalls = 0;
  const refused = await runIsolatedSmsCanary(prisma, {
    attemptId: attempt.id,
    env: canaryEnv,
    twilioConfig: twilioReady,
    sms: async () => {
      smsCalls += 1;
      throw new Error("ghl_consent_must_not_send_webhook_sms");
    },
  });
  assert.equal(refused.smsCalls, 0);
  assert.equal(refused.skipped, "recipient_not_ready");
  assert.equal(smsCalls, 0);
  const webhookClient = await createClient();
  await enroll(webhookClient, "+15555551922");
  const webhookAttempt = await accept(webhookClient, "webhook_canary_lead");
  const webhookEnv = {
    ...env,
    SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: webhookClient,
    SA360_SMS_CANARY_ATTEMPT_ID: webhookAttempt.id,
    SA360_SMS_CANARY_RECIPIENT_E164: "+15555551922",
  };
  const first = await runIsolatedSmsCanary(prisma, {
    attemptId: webhookAttempt.id,
    env: webhookEnv,
    twilioConfig: twilioReady,
    sms: async () => {
      smsCalls += 1;
      return {
        ok: true,
        provider: "twilio",
        providerMessageId: `SM${"e".repeat(32)}`,
        providerStatus: "queued",
        statusClass: "pending",
      };
    },
  });
  assert.equal(first.smsCalls, 1);
  assert.equal(first.emailCalls, 0);
  assert.equal(smsCalls, 1);
  const receipt = await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: first.receiptId ?? "" } });
  assert.equal(receipt.channel, "sms");
  assert.equal(receipt.status, "provider_accepted");
  assert.equal(receipt.deliveryEvidence, false);
  assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: attempt.id, channel: "email" } }), 0);

  const second = await runIsolatedSmsCanary(prisma, {
    attemptId: webhookAttempt.id,
    env: webhookEnv,
    twilioConfig: twilioReady,
    sms: async () => {
      smsCalls += 1;
      throw new Error("second");
    },
  });
  assert.equal(second.smsCalls, 0);
  assert.equal(smsCalls, 1);
  assert.equal(second.skipped, "provider_accepted");

  const deliveredParams = { MessageSid: receipt.providerMessageId ?? "", MessageStatus: "delivered" };
  const delivered = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, deliveredParams, TOKEN),
    },
    payload: new URLSearchParams(deliveredParams).toString(),
  });
  assert.equal(delivered.statusCode, 200);
  assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status, "sent");
  const duplicate = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, deliveredParams, TOKEN),
    },
    payload: new URLSearchParams(deliveredParams).toString(),
  });
  assert.match(duplicate.body, /duplicate/);

  const emailReceipt = await prisma.externalWebhookNotificationReceipt.create({
    data: {
      idempotencyKey: `external_webhook:${oldAttempt.id}:email:historical-ops@example.com`,
      acceptanceId: oldAttempt.id,
      attemptId: oldAttempt.id,
      clientAccountId: historical,
      sourceLeadEventId: oldAttempt.sourceLeadEventId,
      destinationId: oldAttempt.destinationId,
      channel: "email",
      recipient: "historical-ops@example.com",
      status: "pending",
      acceptedAt: oldAttempt.httpAcceptedAt ?? new Date(),
      templateId: "delivery_accepted",
    },
  });
  const emailDispatch = await dispatchExternalWebhookNotice(prisma, emailReceipt.id, {
    env: canaryEnv,
    emailConfigured: true,
    mail: async () => {
      emailCalls += 1;
      return { ok: true, id: "email_should_not_send" };
    },
  });
  assert.equal(emailDispatch.skipped, "canary_isolation");
  assert.equal(emailCalls, 0);
  assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: emailReceipt.id } })).status, "pending");
  await portal.close();
  await callbacks.close();
  await admin.close();
});

test("uncertain canary sends are not retried, and 21610 suppresses without a second send", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const uncertainClient = await createClient();
  const stopClient = await createClient();
  await enroll(uncertainClient, "+15555551903");
  await enroll(stopClient, "+15555551904");
  const uncertainAttempt = await accept(uncertainClient, "uncertain_lead");
  const stopAttempt = await accept(stopClient, "stop_lead");
  const uncertainEnv = canaryEnvFor(uncertainClient, uncertainAttempt.id, "+15555551903");
  let calls = 0;
  const crashed = await runIsolatedSmsCanary(prisma, {
    attemptId: uncertainAttempt.id,
    env: uncertainEnv,
    twilioConfig: twilioReady,
    sms: async () => {
      calls += 1;
      throw new Error("socket");
    },
  });
  assert.equal(crashed.smsCalls, 1);
  assert.equal(calls, 1);
  const replay = await runIsolatedSmsCanary(prisma, {
    attemptId: uncertainAttempt.id,
    env: uncertainEnv,
    twilioConfig: twilioReady,
    sms: async () => {
      calls += 1;
      throw new Error("socket");
    },
  });
  assert.equal(replay.smsCalls, 0);
  assert.equal(replay.skipped, "uncertain");
  assert.equal(calls, 1);

  const stopEnv = canaryEnvFor(stopClient, stopAttempt.id, "+15555551904");
  const sid = `SM${"f".repeat(32)}`;
  const stopped = await runIsolatedSmsCanary(prisma, {
    attemptId: stopAttempt.id,
    env: stopEnv,
    twilioConfig: twilioReady,
    sms: async () => ({
      ok: false,
      provider: "twilio",
      skipped: false,
      errorClass: "stop_suppressed",
      error: "Twilio 400 code 21610",
      providerCode: 21610,
      providerMessageId: null,
      providerStatus: null,
    }),
  });
  assert.equal(stopped.smsCalls, 1);
  assert.equal(
    (await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: stopClient } })).smsSuppressionState,
    "suppressed"
  );
  const again = await runIsolatedSmsCanary(prisma, {
    attemptId: stopAttempt.id,
    env: stopEnv,
    twilioConfig: twilioReady,
    sms: async () => {
      throw new Error("resend");
    },
  });
  assert.equal(again.smsCalls, 0);

  const callbackClient = await createClient();
  await enroll(callbackClient, "+15555551905");
  const callbackAttempt = await accept(callbackClient, "callback_lead");
  const callbackEnv = canaryEnvFor(callbackClient, callbackAttempt.id, "+15555551905");
  const accepted = await runIsolatedSmsCanary(prisma, {
    attemptId: callbackAttempt.id,
    env: callbackEnv,
    twilioConfig: twilioReady,
    sms: async () => ({
      ok: true,
      provider: "twilio",
      providerMessageId: sid,
      providerStatus: "queued",
      statusClass: "pending",
    }),
  });
  const callbacks = Fastify();
  await callbacks.register(externalWebhookNoticeCallbackRoutes, {
    statusUrl: STATUS_URL,
    inboundUrl: INBOUND_URL,
    authToken: TOKEN,
    env: callbackEnv,
  });
  const failParams = { MessageSid: sid, MessageStatus: "failed", ErrorCode: "21610" };
  const failed = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, failParams, TOKEN),
    },
    payload: new URLSearchParams(failParams).toString(),
  });
  assert.equal(failed.statusCode, 200);
  assert.match(failed.body, /updated/);
  const duplicate = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, failParams, TOKEN),
    },
    payload: new URLSearchParams(failParams).toString(),
  });
  assert.match(duplicate.body, /duplicate/);
  assert.equal(
    (await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: callbackClient } })).smsSuppressionState,
    "suppressed"
  );
  assert.equal(accepted.smsCalls, 1);
  await callbacks.close();
});

function canaryEnvFor(clientAccountId: string, attemptId: string, phone: string): NodeJS.ProcessEnv {
  return {
    ...optInEnv(clientAccountId),
    SA360_SMS_NOTIFICATIONS_ENABLED: "true",
    SA360_SMS_CANARY_ENABLED: "true",
    SA360_SMS_CANARY_CLIENT_ACCOUNT_ID: clientAccountId,
    SA360_SMS_CANARY_ATTEMPT_ID: attemptId,
    SA360_SMS_CANARY_RECIPIENT_E164: phone,
  };
}

async function enroll(clientAccountId: string, phone: string) {
  const recordedPhone = await recordNotificationPhone(prisma, { clientAccountId, phoneE164: phone });
  assert.equal(recordedPhone.ok, true);
  const consent = await recordSmsConsent(prisma, {
    clientAccountId,
    version: SMS_CONSENT_VERSION_V2,
    text: composeSmsConsentText({ privacyPolicyUrl: PRIVACY, termsUrl: TERMS }),
  });
  assert.equal(consent.ok, true);
  const enabled = await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
  assert.equal(enabled.ok, true);
}

test("a one-time link records consent without portal login, and a verbal note stays pending", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL ?? "");
  const clientAccountId = await createClient();
  const phone = "+15555551906";
  const env = {
    ...optInEnv(clientAccountId),
    SA360_TEAM_WORKSPACE_ENABLED: "true",
    SA360_STAFF_ASSERTION_SECRET: "sms-verbal-assertion-secret-32bx",
  };
  const issued = await issueSmsOptInLink(prisma, {
    clientAccountId,
    phoneE164: phone,
    confirmationEmail: "recipient@lifeagentlaunch.invalid",
    env,
    mail: async () => {
      throw new Error("email must not send when the public origin is unset");
    },
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  assert.equal(issued.smsEnabled, false);
  assert.equal(issued.consentRecorded, false);
  assert.equal(issued.url, null);
  assert.equal(issued.email, "origin_unconfigured");

  const app = Fastify();
  await app.register(publicSmsOptInRoutes, { env });
  const unread = await app.inject({ method: "POST", url: `/public/sms-opt-in/${issued.rawToken}`, payload: {} });
  assert.equal(unread.statusCode, 400);
  const viewed = await app.inject({ method: "GET", url: `/public/sms-opt-in/${issued.rawToken}` });
  assert.equal(viewed.statusCode, 200);
  const view = viewed.json() as { consentRecorded: boolean; smsEnabled: boolean; portalLoginRequired: boolean; disclosure: { recordable: boolean; privacyPolicyUrl: string } };
  assert.equal(view.consentRecorded, false);
  assert.equal(view.smsEnabled, false);
  assert.equal(view.portalLoginRequired, false);
  assert.equal(view.disclosure.recordable, true);
  assert.equal(view.disclosure.privacyPolicyUrl, PRIVACY);
  const confirmed = await app.inject({
    method: "POST",
    url: `/public/sms-opt-in/${issued.rawToken}`,
    headers: { "content-type": "application/json" },
    payload: { affirmDisclosure: true },
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal((confirmed.json() as { smsEnabled: boolean }).smsEnabled, true);
  const stored = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(stored.smsConsentCollection, "recipient_link");
  assert.equal(stored.smsConsentVersion, SMS_CONSENT_VERSION_GHL);
  assert.equal(stored.smsOptInTokenHash, null);
  const reused = await app.inject({
    method: "POST",
    url: `/public/sms-opt-in/${issued.rawToken}`,
    headers: { "content-type": "application/json" },
    payload: { affirmDisclosure: true },
  });
  assert.equal(reused.statusCode, 404);
  assert.equal(reused.body.includes(issued.rawToken), false);
  assert.equal(reused.headers["referrer-policy"], "no-referrer");
  assert.match(String(reused.headers["cache-control"]), /no-store/);
  assert.equal(viewed.headers["referrer-policy"], "no-referrer");
  assert.match(String(viewed.headers["cache-control"]), /no-store/);

  const verbalClient = await createClient();
  const operatorId = await ensureVerbalOperator();
  const verbal = Fastify();
  await verbal.register(adminSmsVerbalConsentRoutes, { prefix: "/admin/v1", env });
  const sharedAdmin = await verbal.inject({
    method: "POST",
    url: `/admin/v1/team-workspace/clients/${verbalClient}/sms-verbal-consent`,
    headers: { "content-type": "application/json", "x-sa360-admin-key": ADMIN_KEY },
    payload: verbalBody("+15555551907"),
  });
  assert.equal(sharedAdmin.statusCode, 403);
  const noted = await verbal.inject({
    method: "POST",
    url: `/admin/v1/team-workspace/clients/${verbalClient}/sms-verbal-consent`,
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": ADMIN_KEY,
      [STAFF_ASSERTION_HEADER]: signStaffAssertion({ staffPrincipalId: operatorId, secret: env.SA360_STAFF_ASSERTION_SECRET }).token,
    },
    payload: verbalBody("+15555551907"),
  });
  assert.equal(noted.statusCode, 200);
  const note = noted.json() as { status: string; smsEnabled: boolean; consentRecorded: boolean; email: string };
  assert.equal(note.status, "pending_confirmation");
  assert.equal(note.smsEnabled, false);
  assert.equal(note.consentRecorded, false);
  assert.equal(note.email, "origin_unconfigured");
  const pending = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: verbalClient } });
  assert.equal(pending.smsEnabled, false);
  assert.equal(pending.smsConsentRecordedAt, null);
  assert.equal(pending.smsVerbalOperatorId, operatorId);
  assert.equal(pending.smsVerbalAffirmation, "Yes, text this number.");
  assert.equal(pending.smsConsentCollection, "pending_confirmation");
  const statusDenied = await verbal.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${verbalClient}/sms-consent-status`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(statusDenied.statusCode, 403);
  const status = await verbal.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${verbalClient}/sms-consent-status`,
    headers: {
      "x-sa360-admin-key": ADMIN_KEY,
      [STAFF_ASSERTION_HEADER]: signStaffAssertion({ staffPrincipalId: operatorId, secret: env.SA360_STAFF_ASSERTION_SECRET }).token,
    },
  });
  assert.equal(status.statusCode, 200);
  const account = status.json() as { recipientConsentConfirmed: boolean; smsEnabled: boolean; linkOutstanding: boolean };
  assert.equal(account.recipientConsentConfirmed, false);
  assert.equal(account.smsEnabled, false);
  assert.equal(account.linkOutstanding, true);
  assert.equal(status.body.includes("smsOptInToken"), false);
  assert.equal(status.body.includes("/portal/sms-opt-in/"), false);
  await app.close();
  await verbal.close();
});

test("token confirmation is atomic across replacement, replay, STOP, and a phone change", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL ?? "");
  const env = optInEnv(await createClient());
  const clientAccountId = env.SA360_SMS_OPT_IN_CLIENT_ACCOUNT_ID ?? "";
  const phone = "+15555551909";
  const first = await issueSmsOptInLink(prisma, { clientAccountId, phoneE164: phone, env, mail: async () => ({ ok: false, error: "not sent" }) });
  const second = await issueSmsOptInLink(prisma, { clientAccountId, phoneE164: phone, env, mail: async () => ({ ok: false, error: "not sent" }) });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal((await confirmSmsOptInLink(prisma, { rawToken: first.rawToken, affirmDisclosure: true, env })).ok, false);
  const confirmed = await confirmSmsOptInLink(prisma, { rawToken: second.rawToken, affirmDisclosure: true, env });
  assert.equal(confirmed.ok, true);
  const replay = await confirmSmsOptInLink(prisma, { rawToken: second.rawToken, affirmDisclosure: true, env });
  assert.equal(replay.ok, false);
  const stored = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(stored.recipientPhoneE164, phone);
  assert.equal(stored.smsEnabled, true);
  assert.equal(stored.smsConsentVersion, SMS_CONSENT_VERSION_GHL);
  assert.equal(stored.smsOptInTokenHash, null);
  assert.equal(stored.smsHandsetProvenAt, null);

  const racedClient = await createClient();
  const racedEnv = optInEnv(racedClient);
  const racedPhone = "+15555551910";
  const raced = await issueSmsOptInLink(prisma, { clientAccountId: racedClient, phoneE164: racedPhone, env: racedEnv, mail: async () => ({ ok: false, error: "not sent" }) });
  assert.equal(raced.ok, true);
  if (!raced.ok) return;
  const [racedConfirm] = await Promise.all([
    confirmSmsOptInLink(prisma, { rawToken: raced.rawToken, affirmDisclosure: true, env: racedEnv }),
    recordNotificationPhone(prisma, { clientAccountId: racedClient, phoneE164: "+15555551911" }),
  ]);
  const racedRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: racedClient } });
  assert.equal(racedRow.smsHandsetProvenAt, null);
  if (racedRow.recipientPhoneE164 !== racedPhone) {
    assert.equal(racedRow.smsEnabled, false);
    assert.equal(racedRow.smsConsentRecordedAt, null);
  }
  if (racedRow.smsEnabled) assert.equal(racedRow.recipientPhoneE164, racedPhone);
  assert.equal(racedConfirm.ok === true || racedRow.smsEnabled === false, true);

  const stoppedClient = await createClient();
  const stoppedEnv = optInEnv(stoppedClient);
  const stopped = await issueSmsOptInLink(prisma, {
    clientAccountId: stoppedClient,
    phoneE164: "+15555551912",
    env: stoppedEnv,
    mail: async () => ({ ok: false, error: "not sent" }),
  });
  assert.equal(stopped.ok, true);
  if (!stopped.ok) return;
  assert.equal((await suppressSmsLocally(prisma, { clientAccountId: stoppedClient })).ok, true);
  const blocked = await confirmSmsOptInLink(prisma, { rawToken: stopped.rawToken, affirmDisclosure: true, env: stoppedEnv });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, "stop_suppressed");
  const stoppedRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: stoppedClient } });
  assert.equal(stoppedRow.smsEnabled, false);
  assert.equal(stoppedRow.smsSuppressionState, "suppressed");
  assert.equal(stoppedRow.smsConsentRecordedAt, null);

  const doubleClient = await createClient();
  const doubleEnv = optInEnv(doubleClient);
  const doublePhone = "+15555551913";
  const doubleIssued = await issueSmsOptInLink(prisma, {
    clientAccountId: doubleClient,
    phoneE164: doublePhone,
    env: doubleEnv,
    mail: async () => ({ ok: false, error: "not sent" }),
  });
  assert.equal(doubleIssued.ok, true);
  if (!doubleIssued.ok) return;
  const both = await Promise.all([
    confirmSmsOptInLink(prisma, { rawToken: doubleIssued.rawToken, affirmDisclosure: true, env: doubleEnv }),
    confirmSmsOptInLink(prisma, { rawToken: doubleIssued.rawToken, affirmDisclosure: true, env: doubleEnv }),
  ]);
  assert.equal(both.filter((item) => item.ok).length, 1);
  const doubleRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: doubleClient } });
  assert.equal(doubleRow.smsEnabled, true);
  assert.equal(doubleRow.recipientPhoneE164, doublePhone);
  assert.equal(doubleRow.smsOptInTokenHash, null);
  assert.equal(doubleRow.smsHandsetProvenAt, null);
});

test("portal consent stays off the wrong phone when STOP, a phone change, or a second submit races it", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL ?? "");
  const clientAccountId = await createClient();
  const env = optInEnv(clientAccountId);
  const phone = "+15555551914";
  const begun = await beginRecipientSmsOptIn(prisma, {
    clientAccountId,
    phoneE164: phone,
    affirmDisclosure: true,
    version: SMS_CONSENT_VERSION_GHL,
    env,
  });
  assert.equal(begun.ok, true);
  if (!begun.ok) return;
  const proven = await confirmSmsHandsetInbound(prisma, { phoneE164: phone, code: begun.challengeCode });
  assert.equal(proven.ok, true);

  const phoneClient = await createClient();
  const phoneEnv = optInEnv(phoneClient);
  const original = "+15555551915";
  const moved = "+15555551916";
  const phoneBegun = await beginRecipientSmsOptIn(prisma, {
    clientAccountId: phoneClient,
    phoneE164: original,
    affirmDisclosure: true,
    version: SMS_CONSENT_VERSION_GHL,
    env: phoneEnv,
  });
  assert.equal(phoneBegun.ok, true);
  if (!phoneBegun.ok) return;
  assert.equal((await confirmSmsHandsetInbound(prisma, { phoneE164: original, code: phoneBegun.challengeCode })).ok, true);
  await Promise.all([
    recordRecipientSmsConsent(prisma, { clientAccountId: phoneClient, affirmDisclosure: true, version: SMS_CONSENT_VERSION_GHL, env: phoneEnv }),
    recordNotificationPhone(prisma, { clientAccountId: phoneClient, phoneE164: moved }),
  ]);
  const phoneRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: phoneClient } });
  if (phoneRow.recipientPhoneE164 !== original) {
    assert.equal(phoneRow.smsConsentRecordedAt, null);
    assert.equal(phoneRow.smsEnabled, false);
  }
  if (phoneRow.smsConsentRecordedAt) assert.equal(phoneRow.recipientPhoneE164, original);

  const stopClient = await createClient();
  const stopEnv = optInEnv(stopClient);
  const stopPhone = "+15555551917";
  const stopBegun = await beginRecipientSmsOptIn(prisma, {
    clientAccountId: stopClient,
    phoneE164: stopPhone,
    affirmDisclosure: true,
    version: SMS_CONSENT_VERSION_GHL,
    env: stopEnv,
  });
  assert.equal(stopBegun.ok, true);
  if (!stopBegun.ok) return;
  assert.equal((await confirmSmsHandsetInbound(prisma, { phoneE164: stopPhone, code: stopBegun.challengeCode })).ok, true);
  const recorded = await recordRecipientSmsConsent(prisma, {
    clientAccountId: stopClient,
    affirmDisclosure: true,
    version: SMS_CONSENT_VERSION_GHL,
    env: stopEnv,
  });
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;
  assert.equal(recorded.state.smsEnabled, false);
  await Promise.all([
    setRecipientSmsEnabled(prisma, { clientAccountId: stopClient, enabled: true, env: stopEnv }),
    suppressSmsLocally(prisma, { clientAccountId: stopClient }),
  ]);
  const stopped = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: stopClient } });
  assert.equal(stopped.smsSuppressionState, "suppressed");
  assert.equal(stopped.smsEnabled, false);
  const again = await setRecipientSmsEnabled(prisma, { clientAccountId: stopClient, enabled: true, env: stopEnv });
  assert.equal(again.ok, false);
  const afterStop = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: stopClient } });
  assert.equal(afterStop.smsEnabled, false);
  assert.equal(afterStop.smsSuppressionState, "suppressed");

  const duplicate = await recordRecipientSmsConsent(prisma, {
    clientAccountId,
    affirmDisclosure: true,
    version: SMS_CONSENT_VERSION_GHL,
    env,
  });
  assert.equal(duplicate.ok, true);
  const duplicateAgain = await recordRecipientSmsConsent(prisma, {
    clientAccountId,
    affirmDisclosure: true,
    version: SMS_CONSENT_VERSION_GHL,
    env,
  });
  assert.equal(duplicateAgain.ok, true);
  const firstEnable = await setRecipientSmsEnabled(prisma, { clientAccountId, enabled: true, env });
  const secondEnable = await setRecipientSmsEnabled(prisma, { clientAccountId, enabled: true, env });
  assert.equal(firstEnable.ok && secondEnable.ok, true);
  const enabledRow = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(enabledRow.smsEnabled, true);
  assert.equal(enabledRow.recipientPhoneE164, phone);
  assert.equal(enabledRow.smsHandsetProvenAt === null, false);
  const status = await readSmsConsentStatus(prisma, clientAccountId);
  assert.equal(status.ok, true);
  if (!status.ok) return;
  assert.equal(status.recipientConsentConfirmed, true);
  assert.equal(status.smsEnabled, true);
  assert.equal(status.handsetOwnershipProven, true);
  assert.equal(status.linkOutstanding, false);
});

function verbalBody(phone: string) {
  return {
    phoneE164: phone,
    affirmativeResponse: "Yes, text this number.",
    disclosureVersion: SMS_CONSENT_VERSION_GHL,
    confirmationEmail: "recipient@lifeagentlaunch.invalid",
    evidence: "Operator call note in the local test.",
  };
}

async function ensureVerbalOperator(): Promise<string> {
  const email = "matt@lifeagentlaunch.com";
  const existing = await prisma.staffPrincipal.findUnique({ where: { email } });
  const principal = existing
    ? await prisma.staffPrincipal.update({
        where: { id: existing.id },
        data: {
          status: "active",
          disabledAt: null,
          provider: "google",
          providerSubject: existing.providerSubject ?? "sms-verbal-matt-test",
          emailVerified: true,
        },
      })
    : await prisma.staffPrincipal.create({
        data: {
          id: "cverbaloperator0000000000",
          email,
          emailVerified: true,
          displayName: "Matt",
          provider: "google",
          providerSubject: "sms-verbal-matt-test",
          status: "active",
          disabledAt: null,
        },
      });
  const grant = await prisma.staffPermission.findFirst({
    where: { staffPrincipalId: principal.id, permission: "team_workspace", status: "granted", revokedAt: null },
  });
  if (!grant) {
    await prisma.staffPermission.create({
      data: { staffPrincipalId: principal.id, permission: "team_workspace", status: "granted" },
    });
  }
  return principal.id;
}
