import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { buildApp } from "../../app.js";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { discoverExternalWebhookNotices, externalWebhookNoticeTransactionVisibility } from "./notice-discovery.js";
import { dispatchExternalWebhookNotice } from "./notice-dispatch.js";
import { enqueueExternalWebhookNotice } from "./notice-queue.js";
import {
  EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID,
  recoverPendingExternalWebhookNotices,
} from "./notice-recovery.js";
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

test("pending recovery rotates past a blocked page and sends the later receipt once", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const clientAccountId = await client();
    await prisma.clientDeliveryNotificationPreference.create({
      data: {
        clientAccountId,
        enabled: true,
        recipientEmail: `ops-page-${index}@example.com`,
        recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
        enabledAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    const attempt = await accept(clientAccountId, `page_${index}`);
    const recorded = await recordEligibleExternalWebhookNotice(
      prisma,
      { attemptId: attempt.id, channel: "email" },
      { emailConfigured: false }
    );
    assert.equal(recorded.ok, true);
    if (recorded.ok) ids.push(recorded.receipt.id);
  }
  const first = await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: ids[0] } });
  const previous = await prisma.externalWebhookNoticeDiscoveryCursor.findUnique({
    where: { id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID },
  });
  await prisma.externalWebhookNoticeDiscoveryCursor.upsert({
    where: { id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID },
    create: {
      id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID,
      lastHttpAcceptedAt: new Date(first.createdAt.getTime() - 1),
      lastAttemptId: "",
      updatedAt: new Date(),
    },
    update: { lastHttpAcceptedAt: new Date(first.createdAt.getTime() - 1), lastAttemptId: "" },
  });
  const seen: string[] = [];
  try {
    for (let page = 0; page < 3; page += 1) {
      await recoverPendingExternalWebhookNotices(prisma, {
        limit: 2,
        enqueue: async (id) => {
          if (ids.includes(id)) seen.push(id);
        },
      });
    }
    assert.ok(seen.includes(ids[4] ?? ""));
    assert.ok(seen.includes(ids[0] ?? ""));
    let mailCalls = 0;
    const sent = await dispatchExternalWebhookNotice(prisma, ids[4] ?? "", {
      emailConfigured: true,
      mail: async () => {
        mailCalls += 1;
        return { ok: true, id: "email_later_page" };
      },
    });
    const replay = await dispatchExternalWebhookNotice(prisma, ids[4] ?? "", {
      emailConfigured: true,
      mail: async () => {
        mailCalls += 1;
        return { ok: true, id: "email_later_page_again" };
      },
    });
    assert.equal(sent.status, "provider_accepted");
    assert.equal(replay.skipped, "provider_accepted");
    assert.equal(mailCalls, 1);
    for (const blocked of ids.slice(0, 4)) {
      assert.equal(
        (await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: blocked } })).status,
        "pending"
      );
    }
    await assert.rejects(() =>
      recoverPendingExternalWebhookNotices(prisma, {
        ids: [ids[0] ?? ""],
        enqueue: async () => {
          throw new Error("redis down");
        },
      })
    );
    assert.equal(
      (await prisma.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: ids[0] } })).status,
      "pending"
    );
  } finally {
    if (previous) {
      await prisma.externalWebhookNoticeDiscoveryCursor.update({
        where: { id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID },
        data: { lastHttpAcceptedAt: previous.lastHttpAcceptedAt, lastAttemptId: previous.lastAttemptId },
      });
    } else {
      await prisma.externalWebhookNoticeDiscoveryCursor.deleteMany({
        where: { id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID },
      });
    }
  }
});

test("a restricted role cannot prove foreign transaction visibility, and rotation still recovers eligibility", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  execFileSync(
    "sudo",
    [
      "-n",
      "-u",
      "postgres",
      "psql",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
       `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_notice_visibility_probe') THEN
           CREATE ROLE sa360_notice_visibility_probe LOGIN NOSUPERUSER NOINHERIT PASSWORD 'notice-probe-test';
         ELSE
           ALTER ROLE sa360_notice_visibility_probe LOGIN NOSUPERUSER NOINHERIT PASSWORD 'notice-probe-test';
         END IF;
       END $$;`,
    ],
    { stdio: "pipe" }
  );
  const sep = databaseUrl.includes("?") ? "&" : "?";
  const probeUrl = `postgresql://sa360_notice_visibility_probe:notice-probe-test@127.0.0.1:5432/${databaseName}${sep}connection_limit=1`;
  const probe = new PrismaClient({ datasources: { db: { url: probeUrl } } });
  const sameRole = new PrismaClient({ datasources: { db: { url: probeUrl } } });
  const foreign = new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=1` } } });
  let releaseForeign = () => {};
  let releaseSame = () => {};
  const foreignGate = new Promise<void>((resolve) => {
    releaseForeign = resolve;
  });
  const sameGate = new Promise<void>((resolve) => {
    releaseSame = resolve;
  });
  try {
    let foreignPid = 0;
    let markForeign = () => {};
    const foreignStarted = new Promise<void>((resolve) => {
      markForeign = resolve;
    });
    const foreignTx = foreign.$transaction(async (tx) => {
      const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      foreignPid = pid[0]?.pid ?? 0;
      markForeign();
      await foreignGate;
    }, { timeout: 20_000 });
    await foreignStarted;
    assert.equal(await externalWebhookNoticeTransactionVisibility(probe, { backendPid: foreignPid }), "unproven");
    let samePid = 0;
    let markSame = () => {};
    const sameStarted = new Promise<void>((resolve) => {
      markSame = resolve;
    });
    const sameTx = sameRole.$transaction(async (tx) => {
      const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      samePid = pid[0]?.pid ?? 0;
      markSame();
      await sameGate;
    }, { timeout: 20_000 });
    await sameStarted;
    const seen = await probe.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE pid = ${samePid} AND xact_start IS NOT NULL
    `;
    assert.equal(seen[0]?.count ?? 0, 1);
    assert.equal(await externalWebhookNoticeTransactionVisibility(probe, { backendPid: samePid }), "unproven");
    releaseForeign();
    releaseSame();
    await foreignTx.catch(() => undefined);
    await sameTx.catch(() => undefined);
  } finally {
    releaseForeign();
    releaseSame();
    await probe.$disconnect();
    await sameRole.$disconnect();
    await foreign.$disconnect();
    try {
      execFileSync(
        "sudo",
        [
          "-n",
          "-u",
          "postgres",
          "psql",
          "-d",
          databaseName,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `DROP ROLE IF EXISTS sa360_notice_visibility_probe;`,
        ],
        { stdio: "pipe" }
      );
    } catch {
      // A leftover session can keep the role until the next test recreates it.
    }
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
    const discover = () =>
      discoverExternalWebhookNotices(prisma, {
        env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
        now: new Date(at.getTime() + 60_000),
        limit: 50,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
    for (let pass = 0; pass < 3; pass += 1) {
      const existing = await prisma.externalWebhookNoticeChannelDecision.findUnique({
        where: { attemptId_channel: { attemptId: attempt.id, channel: "sms" } },
      });
      if (existing) break;
      await discover();
    }
    const decision = await prisma.externalWebhookNoticeChannelDecision.findUniqueOrThrow({
      where: { attemptId_channel: { attemptId: attempt.id, channel: "sms" } },
    });
    assert.equal(decision.reason, "not_opted_in");
    assert.ok(decision.revisitAfter);
    execFileSync(
      "sudo",
      [
        "-n",
        "-u",
        "postgres",
        "psql",
        "-d",
        databaseName,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `UPDATE "ClientDeliveryNotificationPreference"
         SET "smsEnabled" = true,
             "smsEnabledAt" = '2099-06-01T00:00:00Z',
             "smsConsentRecordedAt" = '2099-06-01T00:00:00Z'
         WHERE "clientAccountId" = '${clientAccountId}';`,
      ],
      { stdio: "pipe" }
    );
    let recovered = false;
    for (let pass = 0; pass < 40 && !recovered; pass += 1) {
      await discover();
      const sms = await prisma.externalWebhookNotificationReceipt.findMany({
        where: { attemptId: attempt.id, channel: "sms", status: "pending" },
      });
      recovered = sms.length === 1;
    }
    assert.equal(recovered, true);

    const laterClient = await client();
    await prisma.clientDeliveryNotificationPreference.create({
      data: {
        clientAccountId: laterClient,
        enabled: true,
        recipientEmail: "ops-after@example.com",
        recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
        enabledAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await recordNotificationPhone(prisma, { clientAccountId: laterClient, phoneE164: "+15555550803" });
    await recordSmsConsent(prisma, { clientAccountId: laterClient, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
    const later = await accept(laterClient, "opt_in_after");
    await sealOthers([attempt.id, later.id]);
    for (let pass = 0; pass < 5; pass += 1) {
      const existing = await prisma.externalWebhookNoticeChannelDecision.findUnique({
        where: { attemptId_channel: { attemptId: later.id, channel: "sms" } },
      });
      if (existing) break;
      await discoverExternalWebhookNotices(prisma, {
        env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
        now: new Date(Date.now() + 120_000),
        limit: 50,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
    }
    const enabled = await setSmsNotificationEnabled(prisma, { clientAccountId: laterClient, enabled: true });
    assert.equal(enabled.ok, true);
    for (let pass = 0; pass < 5; pass += 1) {
      await discoverExternalWebhookNotices(prisma, {
        env: { SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED: "true" },
        now: new Date(Date.now() + 120_000),
        limit: 50,
        emailConfigured: true,
        twilioConfig: twilioReady,
      });
    }
    const retroactive = await prisma.externalWebhookNotificationReceipt.findMany({
      where: { attemptId: later.id, channel: "sms", status: "pending" },
    });
    assert.equal(retroactive.length, 0);
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
