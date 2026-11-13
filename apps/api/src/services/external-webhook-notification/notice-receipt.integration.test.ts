import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  claimExternalWebhookNotice,
  markExternalWebhookNoticeDeliveryConfirmed,
  markExternalWebhookNoticeFailed,
  markExternalWebhookNoticeProviderAccepted,
  markExternalWebhookNoticeProviderStop,
  markExternalWebhookNoticeUncertain,
  recordEligibleExternalWebhookNotice,
} from "./notice-receipt.js";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  recordNotificationPhone,
  recordSmsConsent,
  setSmsNotificationEnabled,
  suppressSmsLocally,
} from "./sms-consent.js";
import { readTwilioMessagingConfig } from "./twilio-programmable-messaging.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const LEAD_NAME = "LeadFirstNameZz";
const LEAD_EMAIL = "lead.person@example.com";
const LEAD_PHONE = "+19995550199";
const OPERATOR_PHONE = "+15555550100";
const OPERATOR_EMAIL = "ops@example.com";
const twilioReady = readTwilioMessagingConfig({
  SA360_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  SA360_TWILIO_AUTH_TOKEN: "c".repeat(32),
  SA360_TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
});

function newClient(): PrismaClient {
  const sep = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=2` } } });
}

let dbA: PrismaClient;
let dbB: PrismaClient;
const clientIds: string[] = [];

describe("external webhook notice receipts", { concurrency: false }, () => {
  before(async () => {
    dbA = newClient();
    dbB = newClient();
    await dbA.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (clientIds.length > 0) {
      await dbA.externalWebhookNotificationReceipt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await dbA.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await dbA.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await dbA.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await dbA.deliverySuccessNotification.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await dbA.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    await dbA.$disconnect().catch(() => undefined);
    await dbB.$disconnect().catch(() => undefined);
  });

  async function createClient(): Promise<string> {
    const clientAccountId = `b2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await dbA.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "Notice receipt test", status: "onboarding" },
    });
    clientIds.push(clientAccountId);
    return clientAccountId;
  }

  async function acceptLead(clientAccountId: string, leadId: string) {
    const destination = await dbA.clientExternalWebhookDestination.upsert({
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
    const payload = JSON.stringify({ firstName: LEAD_NAME, email: LEAD_EMAIL, phone: LEAD_PHONE });
    const attempt = await dbA.externalWebhookDeliveryAttempt.create({
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
    return dbA.externalWebhookDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        state: "attempted",
        outcome: "http_accepted",
        httpStatus: 200,
        requestLeftSa360: true,
        proves: ["http_2xx"],
      },
    });
  }

  test("consent is separate from a verified phone, and unknown suppression fails closed", async () => {
    const clientAccountId = await createClient();
    const bad = await recordNotificationPhone(dbA, { clientAccountId, phoneE164: "5555550100" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "invalid_e164");

    const phone = await recordNotificationPhone(dbA, { clientAccountId, phoneE164: OPERATOR_PHONE });
    assert.equal(phone.ok, true);
    if (phone.ok) {
      assert.equal(phone.preference.smsEnabled, false);
      assert.equal(phone.preference.smsSuppressionState, "unknown");
      assert.equal(phone.preference.smsConsentRecordedAt, null);
    }
    const attempt = await acceptLead(clientAccountId, "lead_unknown");
    const blocked = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: attempt.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, "stop_unknown");
    assert.equal(await dbA.externalWebhookNotificationReceipt.count({ where: { attemptId: attempt.id } }), 0);

    const wrong = await recordSmsConsent(dbA, {
      clientAccountId,
      version: SMS_CONSENT_VERSION,
      text: `${SMS_CONSENT_TEXT} ${LEAD_NAME}`,
    });
    assert.equal(wrong.ok, false);
    const consent = await recordSmsConsent(dbA, {
      clientAccountId,
      version: SMS_CONSENT_VERSION,
      text: SMS_CONSENT_TEXT,
    });
    assert.equal(consent.ok, true);
    if (consent.ok) assert.equal(consent.preference.smsEnabled, false);
    const enabled = await setSmsNotificationEnabled(dbA, { clientAccountId, enabled: true });
    assert.equal(enabled.ok, true);
    if (enabled.ok) {
      assert.equal(enabled.preference.smsEnabled, true);
      assert.equal(enabled.preference.smsConsentVersion, SMS_CONSENT_VERSION);
    }
  });

  test("one claim per acceptance, channel, and recipient, with no lead PII on the receipt", async () => {
    const clientAccountId = await createClient();
    await recordNotificationPhone(dbA, { clientAccountId, phoneE164: OPERATOR_PHONE });
    await recordSmsConsent(dbA, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
    await setSmsNotificationEnabled(dbA, { clientAccountId, enabled: true });
    await dbA.clientDeliveryNotificationPreference.update({
      where: { clientAccountId },
      data: {
        enabled: true,
        recipientEmail: OPERATOR_EMAIL,
        recipientEmailVerifiedAt: new Date(Date.now() - 60_000),
        enabledAt: new Date(Date.now() - 60_000),
      },
    });
    const attempt = await acceptLead(clientAccountId, "lead_once");
    const first = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: attempt.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    const replay = await recordEligibleExternalWebhookNotice(
      dbB,
      { attemptId: attempt.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(first.ok && replay.ok && first.receipt.id === replay.receipt.id, true);
    assert.equal(replay.ok && replay.inserted, false);
    assert.equal(await dbA.deliverySuccessNotification.count({ where: { clientAccountId } }), 0);
    if (!first.ok) return;
    const stored = JSON.stringify(first.receipt);
    assert.equal(stored.includes(LEAD_NAME), false);
    assert.equal(stored.includes(LEAD_EMAIL), false);
    assert.equal(stored.includes(LEAD_PHONE), false);
    assert.equal(first.receipt.status, "pending");

    const held = await claimExternalWebhookNotice(dbA, { idempotencyKey: first.receipt.idempotencyKey });
    assert.equal(held.claimed, false);
    if (!held.claimed) assert.equal(held.reason, "sms_disabled");

    const [left, right] = await Promise.all([
      claimExternalWebhookNotice(dbA, { idempotencyKey: first.receipt.idempotencyKey, dispatchEnabled: true }, { twilioConfig: twilioReady }),
      claimExternalWebhookNotice(dbB, { idempotencyKey: first.receipt.idempotencyKey, dispatchEnabled: true }, { twilioConfig: twilioReady }),
    ]);
    const winners = [left, right].filter((result) => result.claimed);
    assert.equal(winners.length, 1);

    const accepted = await markExternalWebhookNoticeProviderAccepted(dbA, {
      idempotencyKey: first.receipt.idempotencyKey,
      provider: "twilio",
      providerMessageId: `SM${"d".repeat(32)}`,
      providerStatus: "accepted",
    });
    assert.equal(accepted.ok, true);
    if (accepted.ok) {
      assert.equal(accepted.receipt.status, "provider_accepted");
      assert.equal(accepted.receipt.deliveryEvidence, false);
    }
    const early = await markExternalWebhookNoticeDeliveryConfirmed(dbA, {
      idempotencyKey: first.receipt.idempotencyKey,
      providerStatus: "accepted",
    });
    assert.equal(early.ok, false);
    const delivered = await markExternalWebhookNoticeDeliveryConfirmed(dbA, {
      idempotencyKey: first.receipt.idempotencyKey,
      providerStatus: "delivered",
    });
    assert.equal(delivered.ok, true);
    if (delivered.ok) assert.equal(delivered.receipt.status, "sent");

    const email = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: attempt.id, channel: "email" },
      { emailConfigured: true }
    );
    assert.equal(email.ok, true);
    if (email.ok) {
      assert.notEqual(email.receipt.idempotencyKey, first.receipt.idempotencyKey);
      assert.equal(email.receipt.recipient, OPERATOR_EMAIL);
    }
  });

  test("STOP, provider 21610, uncertainty, and an acceptance before enable do not send twice", async () => {
    const clientAccountId = await createClient();
    await recordNotificationPhone(dbA, { clientAccountId, phoneE164: OPERATOR_PHONE });
    await recordSmsConsent(dbA, { clientAccountId, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
    await setSmsNotificationEnabled(dbA, { clientAccountId, enabled: true });
    const early = await acceptLead(clientAccountId, "lead_early");
    await dbA.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsEnabledAt" = ${new Date("2099-01-01T00:00:00.000Z")},
          "smsConsentRecordedAt" = ${new Date("2099-01-01T00:00:00.000Z")}
      WHERE "clientAccountId" = ${clientAccountId}
    `;
    const tooSoon = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: early.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(tooSoon.ok, true);
    if (tooSoon.ok) assert.equal(tooSoon.receipt.status, "suppressed");
    if (tooSoon.ok) assert.equal(tooSoon.receipt.skipReason, "before_enabled_at");

    await dbA.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsEnabledAt" = ${new Date("2020-01-01T00:00:00.000Z")},
          "smsConsentRecordedAt" = ${new Date("2020-01-01T00:00:00.000Z")}
      WHERE "clientAccountId" = ${clientAccountId}
    `;
    const later = await acceptLead(clientAccountId, "lead_later");
    const pending = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: later.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    await suppressSmsLocally(dbA, { clientAccountId });
    const stopped = await dbA.externalWebhookNotificationReceipt.findUniqueOrThrow({
      where: { idempotencyKey: pending.receipt.idempotencyKey },
    });
    assert.equal(stopped.status, "suppressed");
    const again = await recordSmsConsent(dbA, {
      clientAccountId,
      version: SMS_CONSENT_VERSION,
      text: SMS_CONSENT_TEXT,
    });
    assert.equal(again.ok, false);
    const rotated = await recordNotificationPhone(dbA, { clientAccountId, phoneE164: "+15555550101" });
    assert.equal(rotated.ok, false);

    const freshClient = await createClient();
    await recordNotificationPhone(dbA, { clientAccountId: freshClient, phoneE164: OPERATOR_PHONE });
    await recordSmsConsent(dbA, { clientAccountId: freshClient, version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT });
    await setSmsNotificationEnabled(dbA, { clientAccountId: freshClient, enabled: true });
    const uncertainLead = await acceptLead(freshClient, "lead_uncertain");
    const uncertainNotice = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: uncertainLead.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(uncertainNotice.ok, true);
    if (!uncertainNotice.ok) return;
    const claimed = await claimExternalWebhookNotice(
      dbA,
      { idempotencyKey: uncertainNotice.receipt.idempotencyKey, dispatchEnabled: true },
      { twilioConfig: twilioReady }
    );
    assert.equal(claimed.claimed, true);
    const uncertain = await markExternalWebhookNoticeUncertain(dbA, {
      idempotencyKey: uncertainNotice.receipt.idempotencyKey,
    });
    assert.equal(uncertain.ok, true);
    const reclaim = await claimExternalWebhookNotice(
      dbA,
      { idempotencyKey: uncertainNotice.receipt.idempotencyKey, dispatchEnabled: true },
      { twilioConfig: twilioReady }
    );
    assert.equal(reclaim.claimed, false);

    const stopLead = await acceptLead(freshClient, "lead_stop");
    const stopNotice = await recordEligibleExternalWebhookNotice(
      dbA,
      { attemptId: stopLead.id, channel: "sms" },
      { twilioConfig: twilioReady }
    );
    assert.equal(stopNotice.ok, true);
    if (!stopNotice.ok) return;
    await claimExternalWebhookNotice(
      dbA,
      { idempotencyKey: stopNotice.receipt.idempotencyKey, dispatchEnabled: true },
      { twilioConfig: twilioReady }
    );
    const providerStop = await markExternalWebhookNoticeProviderStop(dbA, {
      idempotencyKey: stopNotice.receipt.idempotencyKey,
    });
    assert.equal(providerStop.ok, true);
    if (providerStop.ok) assert.equal(providerStop.receipt.skipReason, "provider_21610");
    const preference = await dbA.clientDeliveryNotificationPreference.findUniqueOrThrow({
      where: { clientAccountId: freshClient },
    });
    assert.equal(preference.smsSuppressionState, "suppressed");
    assert.equal(preference.smsEnabled, false);
    const failed = await markExternalWebhookNoticeFailed(dbA, {
      idempotencyKey: stopNotice.receipt.idempotencyKey,
      providerCode: 30007,
    });
    assert.equal(failed.ok, false);
  });
});
