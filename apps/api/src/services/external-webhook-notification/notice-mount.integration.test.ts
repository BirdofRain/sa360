import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { buildApp } from "../../app.js";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  discoverExternalWebhookNotices,
  externalWebhookNoticeRoleSeesAllTransactions,
  externalWebhookNoticeTransactionVisibility,
} from "./notice-discovery.js";
import { dispatchExternalWebhookNotice } from "./notice-dispatch.js";
import { enqueueExternalWebhookNotice } from "./notice-queue.js";
import { recoverPendingExternalWebhookNotices } from "./notice-recovery.js";
import { recordEligibleExternalWebhookNotice } from "./notice-receipt.js";
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
const ADMIN_KEY = "notice-mount-admin-key";
const twilioReady = readTwilioMessagingConfig({
  SA360_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  SA360_TWILIO_AUTH_TOKEN: TOKEN,
  SA360_TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
});
const clientIds: string[] = [];

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
    await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { id: { in: attemptIds } } }).catch(() => undefined);
  }
  await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
});

async function client(): Promise<string> {
  const clientAccountId = `b5_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Notice mount", status: "onboarding" },
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

async function sealOthers(keep: string[]): Promise<void> {
  if (keep.length === 0) return;
  await prisma.$executeRaw`
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
  `;
}

test("mounted notice routes stay idle when the flag is off and reject bad signatures", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const previousAdmin = process.env.ADMIN_API_KEY;
  const previousFlag = process.env.SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED;
  const previousStatus = process.env.SA360_TWILIO_STATUS_CALLBACK_URL;
  const previousToken = process.env.SA360_TWILIO_AUTH_TOKEN;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  delete process.env.SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED;
  process.env.SA360_TWILIO_STATUS_CALLBACK_URL = STATUS_URL;
  process.env.SA360_TWILIO_AUTH_TOKEN = TOKEN;
  const app = await buildApp();
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/admin/v1/external-webhook-notice/internal/discover",
    });
    assert.equal(missing.statusCode, 401);
    const discover = await app.inject({
      method: "POST",
      url: "/admin/v1/external-webhook-notice/internal/discover",
      headers: { "x-sa360-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: "{}",
    });
    assert.equal(discover.statusCode, 200);
    assert.match(discover.body, /flag_off/);
    const dispatch = await app.inject({
      method: "POST",
      url: "/admin/v1/external-webhook-notice/internal/dispatch",
      headers: { "x-sa360-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: JSON.stringify({ receiptId: "receipt_unused" }),
    });
    assert.equal(dispatch.statusCode, 200);
    assert.match(dispatch.body, /flag_off/);
    const unsigned = await app.inject({
      method: "POST",
      url: "/integrations/twilio/external-webhook-notice/status",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "nope" },
      payload: "MessageSid=SM" + "a".repeat(32) + "&MessageStatus=delivered",
    });
    assert.equal(unsigned.statusCode, 403);
    const leadcapture = await app.inject({
      method: "POST",
      url: "/webhooks/leadcaptureio",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "first_name=Ada&email=ada%40example.com",
    });
    assert.notEqual(leadcapture.statusCode, 415);
  } finally {
    await app.close();
    if (previousAdmin == null) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdmin;
    if (previousFlag == null) delete process.env.SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED;
    else process.env.SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED = previousFlag;
    if (previousStatus == null) delete process.env.SA360_TWILIO_STATUS_CALLBACK_URL;
    else process.env.SA360_TWILIO_STATUS_CALLBACK_URL = previousStatus;
    if (previousToken == null) delete process.env.SA360_TWILIO_AUTH_TOKEN;
    else process.env.SA360_TWILIO_AUTH_TOKEN = previousToken;
  }
});

test("a signed mounted callback confirms delivery once and does not regress it", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      enabled: true,
      recipientEmail: "ops-mount@example.com",
      recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
      enabledAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: "+15555550801" });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
  const attempt = await accept(clientAccountId, "mount_status");
  const recorded = await recordEligibleExternalWebhookNotice(
    prisma,
    { attemptId: attempt.id, channel: "sms" },
    { twilioConfig: twilioReady, env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" } }
  );
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;
  const sid = `SM${"e".repeat(32)}`;
  let calls = 0;
  const sent = await dispatchExternalWebhookNotice(prisma, recorded.receipt.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true", SA360_TWILIO_STATUS_CALLBACK_URL: STATUS_URL },
    twilioConfig: twilioReady,
    sms: async (input) => {
      calls += 1;
      assert.equal(input.statusCallback, STATUS_URL);
      return { ok: true, provider: "twilio", providerMessageId: sid, providerStatus: "queued", statusClass: "pending" };
    },
  });
  assert.equal(sent.status, "provider_accepted");
  assert.equal(calls, 1);
  const previousStatus = process.env.SA360_TWILIO_STATUS_CALLBACK_URL;
  const previousToken = process.env.SA360_TWILIO_AUTH_TOKEN;
  process.env.SA360_TWILIO_STATUS_CALLBACK_URL = STATUS_URL;
  process.env.SA360_TWILIO_AUTH_TOKEN = TOKEN;
  const app = await buildApp();
  try {
    const deliveredParams = { MessageSid: sid, MessageStatus: "delivered" };
    const internalParams = { MessageSid: sid, MessageStatus: "delivered" };
    const internal = await app.inject({
      method: "POST",
      url: "/integrations/twilio/external-webhook-notice/status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilioRequestSignature("http://127.0.0.1:3001/admin/v1/external-webhook-notice/status", internalParams, TOKEN),
      },
      payload: new URLSearchParams(internalParams).toString(),
    });
    assert.equal(internal.statusCode, 403);
    assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: recorded.receipt.id } })).status, "provider_accepted");
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
    assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: recorded.receipt.id } })).status, "sent");
    const late = await app.inject({
      method: "POST",
      url: "/integrations/twilio/external-webhook-notice/status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilioRequestSignature(STATUS_URL, { MessageSid: sid, MessageStatus: "queued" }, TOKEN),
      },
      payload: new URLSearchParams({ MessageSid: sid, MessageStatus: "queued" }).toString(),
    });
    assert.equal(late.statusCode, 200);
    assert.match(late.body, /duplicate/);
    assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: recorded.receipt.id } })).deliveryEvidence, true);
  } finally {
    await app.close();
    if (previousStatus == null) delete process.env.SA360_TWILIO_STATUS_CALLBACK_URL;
    else process.env.SA360_TWILIO_STATUS_CALLBACK_URL = previousStatus;
    if (previousToken == null) delete process.env.SA360_TWILIO_AUTH_TOKEN;
    else process.env.SA360_TWILIO_AUTH_TOKEN = previousToken;
  }
});

test("a pending receipt behind the cursor is dispatched once after enqueue fails", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = await client();
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      enabled: true,
      recipientEmail: "ops-recover@example.com",
      recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
      enabledAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  const attempt = await accept(clientAccountId, "pending_recover");
  const recorded = await recordEligibleExternalWebhookNotice(
    prisma,
    { attemptId: attempt.id, channel: "email" },
    { emailConfigured: false }
  );
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;
  assert.equal(recorded.receipt.status, "pending");
  const previous = await prisma.externalWebhookNoticeDiscoveryCursor.findUnique({ where: { id: "acceptance" } });
  await prisma.externalWebhookNoticeDiscoveryCursor.upsert({
    where: { id: "acceptance" },
    create: {
      id: "acceptance",
      lastHttpAcceptedAt: new Date(attempt.httpAcceptedAt!.getTime() + 1_000),
      lastAttemptId: "zzzzzzzzzzzzzzzzzzzzzzzz",
      updatedAt: new Date(),
    },
    update: {
      lastHttpAcceptedAt: new Date(attempt.httpAcceptedAt!.getTime() + 1_000),
      lastAttemptId: "zzzzzzzzzzzzzzzzzzzzzzzz",
    },
  });
  try {
    await discoverExternalWebhookNotices(prisma, {
      env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
      now: new Date(Date.now() + 60_000),
      limit: 1,
      emailConfigured: true,
      enqueue: async (id) => {
        assert.notEqual(id, recorded.receipt.id);
      },
    });
    await assert.rejects(() =>
      recoverPendingExternalWebhookNotices(prisma, {
        ids: [recorded.receipt.id],
        enqueue: async () => {
          throw new Error("redis down");
        },
      })
    );
    assert.equal((await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: recorded.receipt.id } })).status, "pending");
    const again = await recoverPendingExternalWebhookNotices(prisma, {
      ids: [recorded.receipt.id],
      enqueue: (id) => enqueueExternalWebhookNotice(id),
    });
    assert.equal(again.enqueued, 1);
    const duplicate = await enqueueExternalWebhookNotice(recorded.receipt.id);
    assert.ok(duplicate === "already_queued" || duplicate === "queued");
    let mailCalls = 0;
    const [first, second] = await Promise.all([
      dispatchExternalWebhookNotice(prisma, recorded.receipt.id, {
        emailConfigured: true,
        mail: async () => {
          mailCalls += 1;
          return { ok: true, id: "email_recovered_once" };
        },
      }),
      dispatchExternalWebhookNotice(prisma, recorded.receipt.id, {
        emailConfigured: true,
        mail: async () => {
          mailCalls += 1;
          return { ok: true, id: "email_recovered_twice" };
        },
      }),
    ]);
    assert.equal(mailCalls, 1);
    assert.equal([first.status, second.status, first.skipped, second.skipped].includes("provider_accepted"), true);
    const skippedTerminal = await recoverPendingExternalWebhookNotices(prisma, {
      ids: [recorded.receipt.id],
      enqueue: async () => {
        throw new Error("terminal rows are not recovered");
      },
    });
    assert.equal(skippedTerminal.scanned, 0);
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
});

test("a restricted database role does not see other transactions, and the revisit window is bounded", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  assert.equal(await externalWebhookNoticeRoleSeesAllTransactions(prisma), false);
  assert.equal(await externalWebhookNoticeTransactionVisibility(prisma), "snapshot");
  const databaseUrl = process.env.SA360_TEST_DATABASE_URL ?? "";
  const sep = databaseUrl.includes("?") ? "&" : "?";
  const other = new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=1` } } });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const open = other.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1`;
    markStarted();
    await gate;
  }, { timeout: 20_000 });
  await started;
  try {
    const visible = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE xact_start IS NOT NULL
        AND pid <> pg_backend_pid()
    `;
    assert.ok((visible[0]?.count ?? 0) >= 1);
  } finally {
    release();
    await open.catch(() => undefined);
    await other.$disconnect();
  }

  const clientAccountId = await client();
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      enabled: true,
      recipientEmail: "ops-window@example.com",
      recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
      enabledAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  await recordNotificationPhone(prisma, { clientAccountId, phoneE164: "+15555550802" });
  await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
  const attempt = await accept(clientAccountId, "restricted_window");
  const at = new Date("2099-07-01T00:00:00.000Z");
  await prisma.$executeRaw`ALTER TABLE "ExternalWebhookDeliveryAttempt" DISABLE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"`;
  try {
    await prisma.$executeRaw`
      UPDATE "ExternalWebhookDeliveryAttempt"
      SET "httpAcceptedAt" = ${at}
      WHERE id = ${attempt.id}
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE "ExternalWebhookDeliveryAttempt" ENABLE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"`;
  }
  await sealOthers([attempt.id]);
  const previous = await prisma.externalWebhookNoticeDiscoveryCursor.findUnique({ where: { id: "acceptance" } });
  await prisma.externalWebhookNoticeDiscoveryCursor.upsert({
    where: { id: "acceptance" },
    create: { id: "acceptance", lastHttpAcceptedAt: new Date(at.getTime() - 1), lastAttemptId: "", updatedAt: at },
    update: { lastHttpAcceptedAt: new Date(at.getTime() - 1), lastAttemptId: "" },
  });
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const existing = await prisma.externalWebhookNoticeChannelDecision.findUnique({
        where: { attemptId_channel: { attemptId: attempt.id, channel: "sms" } },
      });
      if (existing) break;
      await discoverExternalWebhookNotices(prisma, {
        env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
        now: new Date(at.getTime() + 60_000),
        limit: 25,
        emailConfigured: true,
        twilioConfig: twilioReady,
        transactionVisibility: "restricted",
      });
    }
    const decision = await prisma.externalWebhookNoticeChannelDecision.findUniqueOrThrow({
      where: { attemptId_channel: { attemptId: attempt.id, channel: "sms" } },
    });
    assert.equal(decision.reason, "not_opted_in");
    assert.ok(decision.revisitAfter && decision.revisitAfter.getTime() > Date.now());
    await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
    await prisma.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsEnabledAt" = ${new Date(at.getTime() - 60_000)},
          "smsConsentRecordedAt" = ${new Date(at.getTime() - 60_000)}
      WHERE "clientAccountId" = ${clientAccountId}
    `;
    await discoverExternalWebhookNotices(prisma, {
      env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
      now: new Date(),
      limit: 5,
      emailConfigured: true,
      twilioConfig: twilioReady,
      transactionVisibility: "restricted",
    });
    const sms = await prisma.externalWebhookNotificationReceipt.findMany({ where: { attemptId: attempt.id, channel: "sms" } });
    assert.equal(sms.length, 1);
    assert.equal(sms[0]?.status, "pending");

    const laterClient = await client();
    await prisma.clientDeliveryNotificationPreference.create({
      data: {
        clientAccountId: laterClient,
        enabled: true,
        recipientEmail: "ops-expired@example.com",
        recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
        enabledAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await recordNotificationPhone(prisma, { clientAccountId: laterClient, phoneE164: "+15555550803" });
    await recordSmsConsent(prisma, { clientAccountId: laterClient, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
    const expired = await accept(laterClient, "restricted_expired");
    const expiredAt = new Date("2099-08-01T00:00:00.000Z");
    await prisma.$executeRaw`ALTER TABLE "ExternalWebhookDeliveryAttempt" DISABLE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"`;
    try {
      await prisma.$executeRaw`
        UPDATE "ExternalWebhookDeliveryAttempt"
        SET "httpAcceptedAt" = ${expiredAt}
        WHERE id = ${expired.id}
      `;
    } finally {
      await prisma.$executeRaw`ALTER TABLE "ExternalWebhookDeliveryAttempt" ENABLE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"`;
    }
    await sealOthers([attempt.id, expired.id]);
    await prisma.externalWebhookNoticeDiscoveryCursor.update({
      where: { id: "acceptance" },
      data: { lastHttpAcceptedAt: new Date(expiredAt.getTime() - 1), lastAttemptId: "" },
    });
    await discoverExternalWebhookNotices(prisma, {
      env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
      now: new Date(expiredAt.getTime() + 60_000),
      limit: 1,
      emailConfigured: true,
      twilioConfig: twilioReady,
      transactionVisibility: "restricted",
    });
    await prisma.externalWebhookNoticeChannelDecision.updateMany({
      where: { attemptId: expired.id, channel: "sms" },
      data: { revisitAfter: new Date(Date.now() - 60_000) },
    });
    await setSmsNotificationEnabled(prisma, { clientAccountId: laterClient, enabled: true });
    await prisma.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsEnabledAt" = ${new Date(expired.httpAcceptedAt!.getTime() - 60_000)},
          "smsConsentRecordedAt" = ${new Date(expired.httpAcceptedAt!.getTime() - 60_000)}
      WHERE "clientAccountId" = ${laterClient}
    `;
    await discoverExternalWebhookNotices(prisma, {
      env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
      now: new Date(Date.now() + 60_000),
      limit: 5,
      emailConfigured: true,
      twilioConfig: twilioReady,
      transactionVisibility: "restricted",
    });
    assert.equal(await prisma.externalWebhookNotificationReceipt.count({ where: { attemptId: expired.id, channel: "sms" } }), 0);
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
});
