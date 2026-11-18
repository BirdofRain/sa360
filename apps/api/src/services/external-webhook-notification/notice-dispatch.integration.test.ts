import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { externalWebhookNoticeCallbackRoutes, TWILIO_EMPTY_INBOUND_TWIML } from "../../routes/external-webhook-notice-callbacks.js";
import { discoverExternalWebhookNotices } from "./notice-discovery.js";
import { dispatchExternalWebhookNotice, promoteStaleExternalWebhookNotices } from "./notice-dispatch.js";
import { claimExternalWebhookNotice } from "./notice-receipt.js";
import { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION, recordNotificationPhone, recordSmsConsent, setSmsNotificationEnabled } from "./sms-consent.js";
import { twilioRequestSignature } from "./twilio-signature.js";
import { readTwilioMessagingConfig } from "./twilio-programmable-messaging.js";

const LEAD = "DispatchLeadZz";
const PHONE = "+15555550111";
const TOKEN = "c".repeat(32);
const STATUS_URL = "https://example.test/integrations/twilio/external-webhook-notice/status";
const INBOUND_URL = "https://example.test/integrations/twilio/external-webhook-notice/inbound";
const twilioReady = readTwilioMessagingConfig({
  SA360_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  SA360_TWILIO_AUTH_TOKEN: TOKEN,
  SA360_TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
});
const clientIds: string[] = [];

function otherDb(): PrismaClient {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const sep = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=2` } } });
}

after(async () => {
  if (clientIds.length === 0) return;
  await prisma.externalWebhookNotificationReceipt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.externalWebhookNoticeDiscoveryCursor.deleteMany({ where: { id: "acceptance" } }).catch(() => undefined);
});

async function client(): Promise<string> {
  const clientAccountId = `b4_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Notice dispatch", status: "onboarding" },
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
  const payload = JSON.stringify({ firstName: LEAD });
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
    data: { state: "attempted", outcome: "http_accepted", httpStatus: 204, requestLeftSa360: true, proves: ["http_2xx"] },
  });
}

test("discovery and one winning dispatch leave provider acceptance short of delivery", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      enabled: true,
      recipientEmail: "ops@example.com",
      recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
      enabledAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: PHONE });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
  const attempt = await accept(clientAccountId, "lead_dispatch");
  const outcomeBefore = attempt.outcome;
  const ids: string[] = [];
  const discovered = await discoverExternalWebhookNotices(prisma, {
    env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
    now: new Date(Date.now() + 60_000),
    emailConfigured: true,
    twilioConfig: twilioReady,
    enqueue: async (id) => {
      ids.push(id);
    },
  });
  assert.equal(discovered.enabled, true);
  assert.equal(discovered.scanned, 1);
  assert.equal(ids.length, 2);
  const off = await discoverExternalWebhookNotices(prisma, { env: {} });
  assert.equal(off.enabled, false);
  assert.equal((await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).outcome, outcomeBefore);

  const email = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
    where: { attemptId: attempt.id, channel: "email" },
  });
  let mailCalls = 0;
  const other = otherDb();
  const [sent, raced] = await Promise.all([
    dispatchExternalWebhookNotice(prisma, email.id, {
      emailConfigured: true,
      mail: async (input) => {
        mailCalls += 1;
        assert.equal(input.text.includes(LEAD), false);
        assert.equal(input.subject.includes(LEAD), false);
        assert.equal(input.idempotencyKey, email.idempotencyKey);
        return { ok: true, id: "email_notice_1" };
      },
    }),
    dispatchExternalWebhookNotice(other, email.id, {
      emailConfigured: true,
      mail: async () => {
        mailCalls += 1;
        return { ok: true, id: "email_notice_2" };
      },
    }),
  ]);
  await other.$disconnect();
  assert.equal([sent.status, raced.status, sent.skipped, raced.skipped].includes("provider_accepted"), true);
  assert.equal(mailCalls, 1);
  const emailRow = await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: email.id } });
  assert.equal(emailRow.status, "provider_accepted");
  assert.equal(emailRow.deliveryEvidence, false);
  assert.equal(emailRow.providerMessageId, "email_notice_1");

  const sms = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
    where: { attemptId: attempt.id, channel: "sms" },
  });
  let smsCalls = 0;
  const held = await dispatchExternalWebhookNotice(prisma, sms.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "false" },
    twilioConfig: twilioReady,
    sms: async () => {
      smsCalls += 1;
      throw new Error("sms");
    },
  });
  assert.equal(held.skipped, "sms_disabled");
  assert.equal(smsCalls, 0);
  const posted = await dispatchExternalWebhookNotice(prisma, sms.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig: twilioReady,
    sms: async (input) => {
      smsCalls += 1;
      assert.equal(input.body.includes(LEAD), false);
      assert.equal(input.body.includes(PHONE), false);
      return {
        ok: true,
        provider: "twilio",
        providerMessageId: `SM${"d".repeat(32)}`,
        providerStatus: "queued",
        statusClass: "pending",
      };
    },
  });
  assert.equal(posted.status, "provider_accepted");
  assert.equal(smsCalls, 1);
  const smsRow = await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sms.id } });
  assert.equal(smsRow.status, "provider_accepted");
  assert.equal(smsRow.deliveryEvidence, false);

  const app = Fastify();
  await app.register(externalWebhookNoticeCallbackRoutes, {
    statusUrl: STATUS_URL,
    inboundUrl: INBOUND_URL,
    authToken: TOKEN,
  });
  const bad = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "nope" },
    payload: new URLSearchParams({ MessageSid: smsRow.providerMessageId ?? "", MessageStatus: "delivered" }).toString(),
  });
  assert.equal(bad.statusCode, 403);
  assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sms.id } })).status, "provider_accepted");

  const deliveredParams = { MessageSid: smsRow.providerMessageId ?? "", MessageStatus: "delivered" };
  const delivered = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, deliveredParams, TOKEN),
    },
    payload: new URLSearchParams(deliveredParams).toString(),
  });
  assert.equal(delivered.statusCode, 200);
  assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sms.id } })).status, "sent");
  const late = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, { MessageSid: deliveredParams.MessageSid, MessageStatus: "queued" }, TOKEN),
    },
    payload: new URLSearchParams({ MessageSid: deliveredParams.MessageSid, MessageStatus: "queued" }).toString(),
  });
  assert.equal(late.statusCode, 200);
  assert.match(late.body, /duplicate/);
  assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sms.id } })).status, "sent");
  await app.close();
});

test("a crashed claim becomes uncertain, 21610 and STOP persist, and START does not clear them", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: "+15555550122" });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
  const attempt = await accept(clientAccountId, "lead_stop");
  await prisma.externalWebhookNoticeDiscoveryCursor.deleteMany({ where: { id: "acceptance" } });
  const ids: string[] = [];
  await discoverExternalWebhookNotices(prisma, {
    env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
    now: new Date(Date.now() + 60_000),
    emailConfigured: false,
    twilioConfig: twilioReady,
    enqueue: async (id) => {
      ids.push(id);
    },
  });
  const sms = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
    where: { attemptId: attempt.id, channel: "sms" },
  });
  const uncertain = await dispatchExternalWebhookNotice(prisma, sms.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig: twilioReady,
    sms: async () => {
      throw new Error("socket");
    },
  });
  assert.equal(uncertain.status, "uncertain");
  let calls = 0;
  const replay = await dispatchExternalWebhookNotice(prisma, sms.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig: twilioReady,
    sms: async () => {
      calls += 1;
      throw new Error("socket");
    },
  });
  assert.equal(replay.skipped, "uncertain");
  assert.equal(calls, 0);

  const second = await accept(clientAccountId, "lead_21610");
  await prisma.externalWebhookNoticeDiscoveryCursor.deleteMany({ where: { id: "acceptance" } });
  await discoverExternalWebhookNotices(prisma, {
    env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
    now: new Date(Date.now() + 60_000),
    twilioConfig: twilioReady,
  });
  const stopReceipt = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
    where: { attemptId: second.id, channel: "sms", status: "pending" },
  });
  const stopped = await dispatchExternalWebhookNotice(prisma, stopReceipt.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
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
  assert.equal(stopped.status, "suppressed");
  const preference = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(preference.smsSuppressionState, "suppressed");

  const app = Fastify();
  await app.register(externalWebhookNoticeCallbackRoutes, {
    statusUrl: STATUS_URL,
    inboundUrl: INBOUND_URL,
    authToken: TOKEN,
  });
  const startParams = { From: "+15555550122", Body: "START" };
  const start = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, startParams, TOKEN),
    },
    payload: new URLSearchParams(startParams).toString(),
  });
  assert.equal(start.statusCode, 200);
  assertEmptyInboundTwiml(start);
  assert.equal(
    (await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } })).smsSuppressionState,
    "suppressed"
  );
  process.env.SA360_SMS_INBOUND_OPT_OUT_ENABLED = "true";
  try {
    const startAgain = await app.inject({
      method: "POST",
      url: "/integrations/twilio/external-webhook-notice/inbound",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilioRequestSignature(INBOUND_URL, startParams, TOKEN),
      },
      payload: new URLSearchParams(startParams).toString(),
    });
    assertEmptyInboundTwiml(startAgain);
    assert.equal(
      (await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } })).smsSuppressionState,
      "suppressed"
    );
  } finally {
    delete process.env.SA360_SMS_INBOUND_OPT_OUT_ENABLED;
  }

  const staleClient = await client();
  await recordNotificationPhone(prisma, { clientAccountId: staleClient, phoneE164: "+15555550133" });
  await recordSmsConsent(prisma, { clientAccountId: staleClient, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  await setSmsNotificationEnabled(prisma, { clientAccountId: staleClient, enabled: true });
  const third = await accept(staleClient, "lead_stale");
  await prisma.externalWebhookNoticeDiscoveryCursor.deleteMany({ where: { id: "acceptance" } });
  await discoverExternalWebhookNotices(prisma, {
    env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
    now: new Date(Date.now() + 60_000),
    twilioConfig: twilioReady,
  });
  const stale = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
    where: { attemptId: third.id, channel: "sms", status: "pending" },
  });
  const claimed = await claimExternalWebhookNotice(
    prisma,
    { idempotencyKey: stale.idempotencyKey, dispatchEnabled: true },
    { twilioConfig: twilioReady }
  );
  assert.equal(claimed.claimed, true);
  await prisma.externalWebhookNotificationReceipt.updateMany({
    where: { id: stale.id, status: "sending" },
    data: { claimedAt: new Date("2020-01-01T00:00:00.000Z") },
  });
  const promoted = await promoteStaleExternalWebhookNotices(prisma, new Date());
  assert.equal(promoted.promoted >= 1, true);
  assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: stale.id } })).status, "uncertain");
  const resent = await dispatchExternalWebhookNotice(prisma, stale.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    sms: async () => {
      throw new Error("must not resend");
    },
  });
  assert.equal(resent.skipped, "uncertain");
  await app.close();
});

function assertEmptyInboundTwiml(response: { body: string; headers: Record<string, string | string[] | undefined> }): void {
  assert.equal(response.body, TWILIO_EMPTY_INBOUND_TWIML);
  assert.equal(response.body.includes("<Message"), false);
  const type = response.headers["content-type"];
  assert.match(String(Array.isArray(type) ? type[0] : type), /text\/xml/);
}
