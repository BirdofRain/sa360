import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import Fastify from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { externalWebhookNoticeCallbackRoutes } from "../../routes/external-webhook-notice-callbacks.js";
import { discoverExternalWebhookNotices } from "./notice-discovery.js";
import { dispatchExternalWebhookNotice } from "./notice-dispatch.js";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  recordNotificationPhone,
  recordSmsConsent,
  setSmsNotificationEnabled,
} from "./sms-consent.js";
import { twilioRequestSignature } from "./twilio-signature.js";
import { readTwilioMessagingConfig } from "./twilio-programmable-messaging.js";

const TOKEN = "c".repeat(32);
const STATUS_URL = "https://hooks.example.com/integrations/twilio/external-webhook-notice/status";
const INBOUND_URL = "https://hooks.example.com/integrations/twilio/external-webhook-notice/inbound";
const ENABLED = { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" };
const twilioReady = readTwilioMessagingConfig({
  SA360_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  SA360_TWILIO_AUTH_TOKEN: TOKEN,
  SA360_TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
});
const twilioDown = { ok: false as const, reason: "incomplete" as const };
const clientIds: string[] = [];

function otherDb(): PrismaClient {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const sep = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=2` } } });
}

after(async () => {
  if (clientIds.length === 0) return;
  const attempts = await prisma.externalWebhookDeliveryAttempt.findMany({
    where: { clientAccountId: { in: clientIds } },
    select: { id: true },
  });
  const attemptIds = attempts.map((row) => row.id);
  if (attemptIds.length > 0) {
    await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { attemptId: { in: attemptIds } } }).catch(() => undefined);
    await prisma.externalWebhookNotificationReceipt.deleteMany({ where: { attemptId: { in: attemptIds } } }).catch(() => undefined);
  }
  await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
});

async function client(): Promise<string> {
  const clientAccountId = `b41_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Notice recovery", status: "onboarding" },
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
  const payload = JSON.stringify({ firstName: "HiddenLeadZz" });
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

async function emailReady(clientAccountId: string) {
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      enabled: true,
      recipientEmail: `${clientAccountId}@example.com`,
      recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
      enabledAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
}

async function smsReady(clientAccountId: string, phone: string) {
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: phone });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
}

async function stamp(ids: string[], at: Date) {
  await prisma.$executeRaw`ALTER TABLE "ExternalWebhookDeliveryAttempt" DISABLE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"`;
  try {
    await prisma.$executeRaw`
      UPDATE "ExternalWebhookDeliveryAttempt"
      SET "httpAcceptedAt" = ${at}
      WHERE id IN (${Prisma.join(ids)})
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE "ExternalWebhookDeliveryAttempt" ENABLE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"`;
  }
}

async function sealOthers(keep: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "ExternalWebhookNoticeChannelDecision" ("id", "attemptId", "channel", "reason", "createdAt")
    SELECT gen_random_uuid()::text, a.id, ch.channel, 'not_opted_in', CURRENT_TIMESTAMP
    FROM "ExternalWebhookDeliveryAttempt" a
    CROSS JOIN (
      SELECT 'email'::"ExternalWebhookNoticeChannel" AS channel
      UNION ALL
      SELECT 'sms'::"ExternalWebhookNoticeChannel"
    ) ch
    WHERE a.outcome = 'http_accepted'
      AND a."httpAcceptedAt" IS NOT NULL
      AND a.id NOT IN (${Prisma.join(keep)})
      AND NOT EXISTS (
        SELECT 1 FROM "ExternalWebhookNotificationReceipt" r
        WHERE r."attemptId" = a.id AND r.channel = ch.channel
      )
      AND NOT EXISTS (
        SELECT 1 FROM "ExternalWebhookNoticeChannelDecision" d
        WHERE d."attemptId" = a.id AND d.channel = ch.channel
      )
    RETURNING id
  `;
  return rows.map((row) => row.id);
}

async function withCursor(at: Date, run: () => Promise<void>) {
  const previous = await prisma.externalWebhookNoticeDiscoveryCursor.findUnique({ where: { id: "acceptance" } });
  await prisma.externalWebhookNoticeDiscoveryCursor.upsert({
    where: { id: "acceptance" },
    create: { id: "acceptance", lastHttpAcceptedAt: new Date(at.getTime() - 1), lastAttemptId: "", updatedAt: at },
    update: { lastHttpAcceptedAt: new Date(at.getTime() - 1), lastAttemptId: "" },
  });
  try {
    await run();
  } finally {
    if (previous) {
      await prisma.externalWebhookNoticeDiscoveryCursor.update({
        where: { id: "acceptance" },
        data: { lastHttpAcceptedAt: previous.lastHttpAcceptedAt, lastAttemptId: previous.lastAttemptId },
      });
    } else {
      await prisma.externalWebhookNoticeDiscoveryCursor.deleteMany({ where: { id: "acceptance" } });
    }
  }
}

test("a shared acceptance timestamp stays reachable across pages and a restart", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await emailReady(clientAccountId);
  const attempts: Array<{ id: string }> = [];
  for (const lead of ["page_a", "page_b", "page_c"]) attempts.push(await accept(clientAccountId, lead));
  const at = new Date("2099-01-01T00:00:00.000Z");
  await stamp(attempts.map((row) => row.id), at);
  const sealed = await sealOthers(attempts.map((row) => row.id));
  try {
    await withCursor(at, async () => {
      const seen: string[] = [];
      for (let page = 0; page < 3; page += 1) {
        const discovered = await discoverExternalWebhookNotices(prisma, {
          env: ENABLED,
          now: new Date(at.getTime() + 60_000),
          limit: 1,
          emailConfigured: true,
          twilioConfig: twilioDown,
        });
        assert.equal(discovered.scanned, 1);
        assert.ok(discovered.cursor);
        seen.push(discovered.cursor.attemptId);
      }
      const expected = [...attempts.map((row) => row.id)].sort();
      assert.deepEqual(seen, expected);
      const again = await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 1,
        emailConfigured: true,
        twilioConfig: twilioDown,
      });
      assert.equal(again.scanned, 0);
      for (const id of expected) {
        const receipts = await prisma.externalWebhookNotificationReceipt.findMany({ where: { attemptId: id, channel: "email" } });
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0]?.status, "pending");
        assert.equal(receipts[0]?.acceptedAt.toISOString(), at.toISOString());
      }
    });
  } finally {
    if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
  }
});

test("a late commit behind the cursor is recovered once", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await emailReady(clientAccountId);
  const first = await accept(clientAccountId, "late_seen");
  const at = new Date("2099-02-01T00:00:00.000Z");
  await stamp([first.id], at);
  const sealed = await sealOthers([first.id]);
  try {
    await withCursor(at, async () => {
      await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 5,
        emailConfigured: true,
        twilioConfig: twilioDown,
      });
      const late = await accept(clientAccountId, "late_commit");
      await stamp([late.id], new Date(at.getTime() - 5_000));
      const recovered = await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 5,
        emailConfigured: true,
        twilioConfig: twilioDown,
      });
      assert.equal(recovered.scanned, 1);
      const receipts = await prisma.externalWebhookNotificationReceipt.findMany({
        where: { attemptId: late.id, channel: "email" },
      });
      assert.equal(receipts.length, 1);
      const replay = await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 5,
        emailConfigured: true,
        twilioConfig: twilioDown,
      });
      assert.equal(replay.scanned, 0);
      assert.equal(
        await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: late.id, channel: "email" } }),
        1
      );
    });
  } finally {
    if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
  }
});

test("provider outages leave a pending notice and recovery sends once", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await emailReady(clientAccountId);
  await smsReady(clientAccountId, "+15555550901");
  const attempt = await accept(clientAccountId, "provider_down");
  const at = new Date("2099-03-01T00:00:00.000Z");
  await stamp([attempt.id], at);
  const sealed = await sealOthers([attempt.id]);
  try {
    await withCursor(at, async () => {
      const discovered = await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 5,
        emailConfigured: false,
        twilioConfig: twilioDown,
      });
      assert.equal(discovered.scanned, 1);
      const email = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
        where: { attemptId: attempt.id, channel: "email" },
      });
      const sms = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
        where: { attemptId: attempt.id, channel: "sms" },
      });
      assert.equal(email.status, "pending");
      assert.equal(sms.status, "pending");
      assert.equal(email.acceptedAt.toISOString(), at.toISOString());
      let mailCalls = 0;
      const heldMail = await dispatchExternalWebhookNotice(prisma, email.id, {
        env: {},
        emailConfigured: false,
        mail: async () => {
          mailCalls += 1;
          return { ok: true, id: "email_should_not_send" };
        },
      });
      assert.equal(heldMail.skipped, "email_not_configured");
      assert.equal(mailCalls, 0);
      assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: email.id } })).status, "pending");
      const sent = await dispatchExternalWebhookNotice(prisma, email.id, {
        env: {},
        emailConfigured: true,
        mail: async () => {
          mailCalls += 1;
          return { ok: true, id: "email_notice_recovered" };
        },
      });
      assert.equal(sent.status, "provider_accepted");
      const replay = await dispatchExternalWebhookNotice(prisma, email.id, {
        env: {},
        emailConfigured: true,
        mail: async () => {
          mailCalls += 1;
          return { ok: true, id: "email_notice_duplicate" };
        },
      });
      assert.equal(replay.skipped, "provider_accepted");
      assert.equal(mailCalls, 1);

      let smsCalls = 0;
      const heldSms = await dispatchExternalWebhookNotice(prisma, sms.id, {
        env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true", SA360_TWILIO_STATUS_CALLBACK_URL: "https://127.0.0.1/admin/v1/notice" },
        twilioConfig: twilioDown,
        sms: async () => {
          smsCalls += 1;
          throw new Error("sms");
        },
      });
      assert.equal(heldSms.skipped, "invalid_twilio_config");
      assert.equal(smsCalls, 0);
      assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sms.id } })).status, "pending");
      const texted = await dispatchExternalWebhookNotice(prisma, sms.id, {
        env: {
          SA360_SMS_NOTIFICATIONS_ENABLED: "true",
          SA360_TWILIO_STATUS_CALLBACK_URL: STATUS_URL,
        },
        twilioConfig: twilioReady,
        sms: async (input) => {
          smsCalls += 1;
          assert.equal(input.statusCallback, STATUS_URL);
          assert.equal(input.body.includes("HiddenLeadZz"), false);
          return {
            ok: true,
            provider: "twilio",
            providerMessageId: `SM${"e".repeat(32)}`,
            providerStatus: "queued",
            statusClass: "pending",
          };
        },
      });
      assert.equal(texted.status, "provider_accepted");
      const textReplay = await dispatchExternalWebhookNotice(prisma, sms.id, {
        env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
        twilioConfig: twilioReady,
        sms: async () => {
          smsCalls += 1;
          throw new Error("duplicate");
        },
      });
      assert.equal(textReplay.skipped, "provider_accepted");
      assert.equal(smsCalls, 1);
      const smsRow = await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sms.id } });
      assert.equal(smsRow.status, "provider_accepted");
      assert.equal(smsRow.deliveryEvidence, false);
    });
  } finally {
    if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
  }
});

test("consent recorded after acceptance does not backfill an SMS notice", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await emailReady(clientAccountId);
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: "+15555550902" });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  const attempt = await accept(clientAccountId, "consent_later");
  const at = attempt.httpAcceptedAt ?? new Date();
  const sealed = await sealOthers([attempt.id]);
  try {
    await withCursor(at, async () => {
      await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 1,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
      assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: attempt.id, channel: "sms" } }), 0);
      const decision = await prisma.externalWebhookNoticeChannelDecision.findUniqueOrThrow({
        where: { attemptId_channel: { attemptId: attempt.id, channel: "sms" } },
      });
      assert.equal(decision.reason, "not_opted_in");
      const enabled = await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
      assert.equal(enabled.ok, true);
      await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(Date.now() + 60_000),
        limit: 5,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
      assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: attempt.id, channel: "sms" } }), 0);
      const later = await accept(clientAccountId, "consent_later_next");
      await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(Date.now() + 60_000),
        limit: 5,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
      const next = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
        where: { attemptId: later.id, channel: "sms" },
      });
      assert.equal(next.status, "pending");
      assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: attempt.id, channel: "sms" } }), 0);
    });
  } finally {
    if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
  }
});

test("a shared STOP number is suppressed for every client, and START does not clear it", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const phone = "+15555550903";
  const first = await client();
  const second = await client();
  await emailReady(first);
  await emailReady(second);
  await smsReady(first, phone);
  await smsReady(second, phone);
  const left = await accept(first, "shared_stop_a");
  const right = await accept(second, "shared_stop_b");
  const at = new Date("2099-05-01T00:00:00.000Z");
  await stamp([left.id, right.id], at);
  const sealed = await sealOthers([left.id, right.id]);
  const previousInbound = process.env.SA360_SMS_INBOUND_OPT_OUT_ENABLED;
  try {
    await withCursor(at, async () => {
      await discoverExternalWebhookNotices(prisma, {
        env: ENABLED,
        now: new Date(at.getTime() + 60_000),
        limit: 5,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
      const sms = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
        where: { attemptId: left.id, channel: "sms", status: "pending" },
      });
      const stopped = await dispatchExternalWebhookNotice(prisma, sms.id, {
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
      const other = await prisma.externalWebhookNotificationReceipt.findFirstOrThrow({
        where: { attemptId: right.id, channel: "sms" },
      });
      assert.equal(other.status, "suppressed");
      for (const id of [first, second]) {
        const preference = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: id } });
        assert.equal(preference.smsSuppressionState, "suppressed");
        assert.equal(preference.smsEnabled, false);
      }
      const replacement = await recordNotificationPhone(prisma, { clientAccountId: second, phoneE164: "+15555550999" });
      assert.equal(replacement.ok, false);
      if (!replacement.ok) assert.equal(replacement.code, "stop_suppressed");
      assert.equal(
        (await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: second } })).recipientPhoneE164,
        phone
      );

      const inboundA = await client();
      const inboundB = await client();
      const inboundPhone = "+15555550904";
      await smsReady(inboundA, inboundPhone);
      await smsReady(inboundB, inboundPhone);
      process.env.SA360_SMS_INBOUND_OPT_OUT_ENABLED = "true";
      const app = Fastify();
      await app.register(externalWebhookNoticeCallbackRoutes, {
        statusUrl: STATUS_URL,
        inboundUrl: INBOUND_URL,
        authToken: TOKEN,
      });
      const stopParams = { From: inboundPhone, Body: "STOP" };
      const stop = await app.inject({
        method: "POST",
        url: "/integrations/twilio/external-webhook-notice/inbound",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": twilioRequestSignature(INBOUND_URL, stopParams, TOKEN),
        },
        payload: new URLSearchParams(stopParams).toString(),
      });
      assert.equal(stop.statusCode, 200);
      assert.match(stop.body, /suppressed/);
      const startParams = { From: inboundPhone, Body: "START" };
      const start = await app.inject({
        method: "POST",
        url: "/integrations/twilio/external-webhook-notice/inbound",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": twilioRequestSignature(INBOUND_URL, startParams, TOKEN),
        },
        payload: new URLSearchParams(startParams).toString(),
      });
      assert.match(start.body, /ignored/);
      for (const id of [inboundA, inboundB]) {
        const preference = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: id } });
        assert.equal(preference.smsSuppressionState, "suppressed");
        assert.equal(preference.smsEnabled, false);
      }
      await app.close();
    });
  } finally {
    if (previousInbound == null) delete process.env.SA360_SMS_INBOUND_OPT_OUT_ENABLED;
    else process.env.SA360_SMS_INBOUND_OPT_OUT_ENABLED = previousInbound;
    if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
  }
});

test("a preference committed by an older transaction still qualifies on the next pass", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await emailReady(clientAccountId);
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: "+15555550905" });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  const db = otherDb();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const work = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1`;
    markStarted();
    await gate;
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsEnabled" = true,
          "smsEnabledAt" = transaction_timestamp(),
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "smsEnabled" = false
        AND "smsSuppressionState" = 'clear'
        AND "smsConsentVersion" = ${SMS_CONSENT_VERSION}
    `;
  }, { timeout: 20_000 });
  await started;
  try {
    const attempt = await accept(clientAccountId, "late_preference");
    const at = attempt.httpAcceptedAt ?? new Date();
    const sealed = await sealOthers([attempt.id]);
    try {
      await withCursor(at, async () => {
        await discoverExternalWebhookNotices(prisma, {
          env: ENABLED,
          now: new Date(at.getTime() + 60_000),
          limit: 1,
          emailConfigured: true,
          twilioConfig: twilioReady,
        });
        const decision = await prisma.externalWebhookNoticeChannelDecision.findUniqueOrThrow({
          where: { attemptId_channel: { attemptId: attempt.id, channel: "sms" } },
        });
        assert.equal(decision.reason, "not_opted_in");
        assert.ok(decision.revisitAfter);
        release();
        await work;
        await discoverExternalWebhookNotices(prisma, {
          env: ENABLED,
          now: new Date(Date.now() + 60_000),
          limit: 5,
          emailConfigured: true,
          twilioConfig: twilioReady,
        });
        const sms = await prisma.externalWebhookNotificationReceipt.findMany({
          where: { attemptId: attempt.id, channel: "sms" },
        });
        assert.equal(sms.length, 1);
        assert.equal(sms[0]?.status, "pending");
        assert.equal(sms[0]?.acceptedAt.toISOString(), at.toISOString());
      });
    } finally {
      if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
    }
  } finally {
    release();
    await work.catch(() => undefined);
    await db.$disconnect();
  }
});

test("two discovery calls do not double-send when the first is interrupted after the cursor moves", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await emailReady(clientAccountId);
  const attempt = await accept(clientAccountId, "restart_once");
  const at = new Date("2099-06-01T00:00:00.000Z");
  await stamp([attempt.id], at);
  const sealed = await sealOthers([attempt.id]);
  try {
    await withCursor(at, async () => {
      const db = otherDb();
      try {
        const first = await discoverExternalWebhookNotices(db, {
          env: ENABLED,
          now: new Date(at.getTime() + 60_000),
          limit: 1,
          emailConfigured: true,
          twilioConfig: twilioDown,
        });
        assert.equal(first.cursor?.attemptId, attempt.id);
        const second = await discoverExternalWebhookNotices(prisma, {
          env: ENABLED,
          now: new Date(at.getTime() + 60_000),
          limit: 1,
          emailConfigured: true,
          twilioConfig: twilioDown,
        });
        assert.equal(second.scanned, 0);
        assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: attempt.id, channel: "email" } }), 1);
      } finally {
        await db.$disconnect();
      }
    });
  } finally {
    if (sealed.length > 0) await prisma.externalWebhookNoticeChannelDecision.deleteMany({ where: { id: { in: sealed } } });
  }
});
