import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV,
  sealExternalWebhookEndpoint,
} from "../../lib/external-webhook-credentials.js";
import type { PinnedHttpsResult } from "../../lib/external-webhook-http.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { ExternalWebhookResolver } from "../../lib/external-webhook-url-policy.js";
import { externalWebhookAcceptanceEvent } from "../external-webhook/external-webhook-acceptance.js";
import { recordExternalWebhookAttempt } from "../external-webhook/external-webhook-schedule.js";
import {
  EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS,
  deliverExternalWebhookAttempt,
} from "../external-webhook/external-webhook-send.js";
import {
  claimExternalWebhookNotice,
  recordEligibleExternalWebhookNotice,
} from "./notice-receipt.js";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  recordNotificationPhone,
  recordSmsConsent,
  setSmsNotificationEnabled,
} from "./sms-consent.js";
import { readTwilioMessagingConfig } from "./twilio-programmable-messaging.js";

const KEY = "test-external-webhook-credential-key-not-real";
const PUBLIC: ExternalWebhookResolver = async () => [{ address: "8.8.8.8", family: 4 }];
const REFUSED: PinnedHttpsResult = { httpStatus: null, timedOut: false, requestLeftSa360: false, refusedRedirect: false };
const ACCEPTED: PinnedHttpsResult = { httpStatus: 204, timedOut: false, requestLeftSa360: true, refusedRedirect: false };
const TIMEOUT: PinnedHttpsResult = { httpStatus: null, timedOut: true, requestLeftSa360: true, refusedRedirect: false };
const LEAD_NAME = "NoticeLeadZz";
const twilioReady = readTwilioMessagingConfig({
  SA360_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  SA360_TWILIO_AUTH_TOKEN: "c".repeat(32),
  SA360_TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
});

function noticeDb(): PrismaClient {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const sep = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=2` } } });
}

const clientIds: string[] = [];

after(async () => {
  if (clientIds.length === 0) return;
  await prisma.externalWebhookNotificationReceipt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
});

function scheduleInput(clientAccountId: string, sourceLeadEventId: string) {
  return {
    sourceLeadEventId,
    status: "routing_matched",
    clientAccountId,
    sourceLeadId: "provider-lead",
    receivedAt: "2026-11-16T15:00:00.000Z",
    normalizedPayload: {
      contact: { first_name: LEAD_NAME, last_name: "Hidden", email: "notice.lead@example.test", state: "NY" },
      phone: "5550100199",
    },
    sourceFunnelId: null,
    resolvedAt: new Date("2026-11-16T15:00:00.000Z"),
  };
}

test("a retried refusal then one 2xx stamps httpAcceptedAt once and notifies only eligible channels", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const savedKey = process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
  const savedFlag = process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED;
  process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = KEY;
  process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED = "true";
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const clientAccountId = `ext_notice_${stamp}`;
  clientIds.push(clientAccountId);
  const sealed = await sealExternalWebhookEndpoint("https://hooks.example.com/hook/path-token", PUBLIC);
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  const sendEnv = {
    [EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV]: KEY,
    SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "true",
  };

  try {
    await prisma.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "Acceptance notice" },
    });
    await prisma.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: `loc_${stamp}`,
        deliveryMode: "shadow",
        deliveryEnabled: false,
      },
    });
    const destination = await prisma.clientExternalWebhookDestination.create({
      data: {
        clientAccountId,
        kind: "ghl_inbound",
        endpointUrlCiphertext: sealed.endpoint.ciphertext,
        endpointUrlFingerprint: sealed.endpoint.fingerprint,
        endpointHost: sealed.endpoint.hostname,
        enabled: true,
      },
    });
    await prisma.companySheetsDispatchIntent.create({
      data: {
        idempotencyKey: `campaign:${clientAccountId}:lead_retry_${stamp}`,
        kind: "campaign_lead",
        status: "pending",
        clientAccountId,
        sourceLeadEventId: `lead_retry_${stamp}`,
      },
    });
    await prisma.clientDeliveryNotificationPreference.create({
      data: {
        clientAccountId,
        enabled: true,
        recipientEmail: "ops@example.com",
        recipientEmailVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
        enabledAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });

    const scheduled = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, `lead_retry_${stamp}`), prisma, sendEnv);
    assert.ok(scheduled);
    const refused = await deliverExternalWebhookAttempt(scheduled.attemptId, {
      env: sendEnv,
      resolve: PUBLIC,
      post: async () => REFUSED,
    });
    assert.equal(refused.outcome, "retryable");
    const beforeAccept = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: scheduled.attemptId } });
    assert.equal(beforeAccept.httpAcceptedAt, null);
    assert.equal(externalWebhookAcceptanceEvent(beforeAccept), null);
    const earlyNotice = await recordEligibleExternalWebhookNotice(
      prisma,
      { attemptId: scheduled.attemptId, channel: "email" },
      { emailConfigured: true }
    );
    assert.equal(earlyNotice.ok, false);

    const accepted = await deliverExternalWebhookAttempt(scheduled.attemptId, {
      env: sendEnv,
      resolve: PUBLIC,
      now: new Date(beforeAccept.updatedAt.getTime() + EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS + 1000),
      post: async () => ACCEPTED,
    });
    assert.equal(accepted.outcome, "http_accepted");
    const row = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: scheduled.attemptId } });
    const event = externalWebhookAcceptanceEvent(row);
    assert.equal(event?.acceptanceId, row.id);
    assert.equal(event?.acceptedAt, row.httpAcceptedAt?.toISOString());
    const stamped = row.httpAcceptedAt;
    assert.ok(stamped);
    await prisma.$executeRaw`
      UPDATE "ExternalWebhookDeliveryAttempt"
      SET "sendCount" = "sendCount",
          "updatedAt" = '2001-02-02T00:00:00.000Z',
          "httpAcceptedAt" = '1999-03-03T00:00:00.000Z'
      WHERE "id" = ${row.id}
    `;
    const held = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(held.httpAcceptedAt?.toISOString(), stamped.toISOString());
    assert.equal(externalWebhookAcceptanceEvent(held)?.acceptedAt, stamped.toISOString());

    const email = await recordEligibleExternalWebhookNotice(
      prisma,
      { attemptId: row.id, channel: "email" },
      { emailConfigured: true }
    );
    assert.equal(email.ok, true);
    if (!email.ok) return;
    assert.equal(email.receipt.status, "pending");
    assert.equal(JSON.stringify(email.receipt).includes(LEAD_NAME), false);
    const replay = await recordEligibleExternalWebhookNotice(
      prisma,
      { attemptId: row.id, channel: "email" },
      { emailConfigured: true }
    );
    assert.equal(replay.ok && replay.inserted, false);
    const other = noticeDb();
    try {
      const [left, right] = await Promise.all([
        claimExternalWebhookNotice(prisma, { idempotencyKey: email.receipt.idempotencyKey }, { emailConfigured: true }),
        claimExternalWebhookNotice(other, { idempotencyKey: email.receipt.idempotencyKey }, { emailConfigured: true }),
      ]);
      assert.equal([left, right].filter((result) => result.claimed).length, 1);
    } finally {
      await other.$disconnect();
    }

    const smsTooLate = await recordNotificationPhone(prisma, { clientAccountId, phoneE164: "+15555550123" });
    assert.equal(smsTooLate.ok, true);
    const consented = await recordSmsConsent(prisma, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
    assert.equal(consented.ok, true);
    const enabled = await setSmsNotificationEnabled(prisma, { clientAccountId, enabled: true });
    assert.equal(enabled.ok, true);
    const retroactive = await recordEligibleExternalWebhookNotice(
      prisma,
      { attemptId: row.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(retroactive.ok, true);
    if (retroactive.ok) {
      assert.equal(retroactive.receipt.status, "suppressed");
      assert.equal(retroactive.receipt.skipReason, "before_enabled_at");
    }
    const smsClaim = await claimExternalWebhookNotice(
      prisma,
      { idempotencyKey: retroactive.ok ? retroactive.receipt.idempotencyKey : "missing", dispatchEnabled: true },
      { twilioConfig: twilioReady }
    );
    assert.equal(smsClaim.claimed, false);

    const uncertainId = `lead_uncertain_${stamp}`;
    const uncertainScheduled = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, uncertainId), prisma, sendEnv);
    assert.ok(uncertainScheduled);
    const timed = await deliverExternalWebhookAttempt(uncertainScheduled.attemptId, {
      env: sendEnv,
      resolve: PUBLIC,
      post: async () => TIMEOUT,
    });
    assert.equal(timed.outcome, "uncertain");
    const uncertainNotice = await recordEligibleExternalWebhookNotice(
      prisma,
      { attemptId: uncertainScheduled.attemptId, channel: "email" },
      { emailConfigured: true }
    );
    assert.equal(uncertainNotice.ok, false);
    if (!uncertainNotice.ok) assert.equal(uncertainNotice.reason, "not_accepted");

    assert.equal(
      (await prisma.companySheetsDispatchIntent.findUniqueOrThrow({
        where: { idempotencyKey: `campaign:${clientAccountId}:lead_retry_${stamp}` },
      })).status,
      "pending"
    );
    assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }), 0);
    assert.equal(destination.enabled, true);
  } finally {
    if (savedKey === undefined) delete process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
    else process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = savedKey;
    if (savedFlag === undefined) delete process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED;
    else process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED = savedFlag;
  }
});
