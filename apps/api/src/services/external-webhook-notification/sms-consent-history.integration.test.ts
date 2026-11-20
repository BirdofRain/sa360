import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { SMS_CONSENT_VERSION_V2, composeSmsConsentText } from "./sms-disclosure.js";
import {
  confirmSmsOptInLink,
  confirmSupersedingGhlConsent,
  issueSupersedingGhlConsentLink,
} from "./sms-opt-in-link.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";
const V2_TEXT = composeSmsConsentText({ privacyPolicyUrl: PRIVACY, termsUrl: TERMS });
const RECORDED_AT = new Date("2026-11-01T15:00:00.000Z");
const ENV = {
  SA360_SMS_PRIVACY_POLICY_URL: PRIVACY,
  SA360_SMS_TERMS_URL: TERMS,
  SA360_SMS_OPT_IN_PUBLIC_ORIGIN: "https://portal.lifeagentlaunch.invalid",
};

let db: PrismaClient;
const clientIds: string[] = [];

before(() => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
});

after(async () => {
  if (clientIds.length > 0) {
    await db.clientDeliverySmsConsentHistory.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await db.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
  }
  await db.$disconnect();
});

test("the consent-history migration does not rewrite stored preferences", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../../../../../prisma/migrations/20261119154500_sms_consent_history/migration.sql", import.meta.url)),
    "utf8"
  );
  assert.equal(/^\s*(UPDATE|INSERT|DELETE)\b/m.test(sql), false);
  assert.match(sql, /CREATE TABLE "ClientDeliverySmsConsentHistory"/);
});

test("a webhook consent row is archived only after a separate GoHighLevel affirmation", async () => {
  const clientAccountId = await createClient("kept");
  const phone = "+15555501921";
  await db.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      recipientPhoneE164: phone,
      recipientPhoneVerifiedAt: RECORDED_AT,
      smsEnabled: false,
      smsConsentVersion: SMS_CONSENT_VERSION_V2,
      smsConsentText: V2_TEXT,
      smsConsentRecordedAt: RECORDED_AT,
      smsSuppressionState: "clear",
      smsConsentCollection: "recipient_link",
      smsVerbalAffirmation: "Yes, text this number.",
      smsVerbalDisclosureVersion: "ghl-lead-sms-v1",
      smsVerbalRecordedAt: RECORDED_AT,
      smsVerbalOperatorId: "operator_history_test",
      smsVerbalEvidence: "Call note kept with the earlier consent.",
    },
  });

  const issued = await issueSupersedingGhlConsentLink(db, {
    clientAccountId,
    phoneE164: phone,
    confirmationEmail: "",
    env: ENV,
    mail: async () => ({ ok: false, error: "not_configured" }),
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  assert.equal(issued.consentRecorded, true);
  assert.equal(issued.priorProgram, SMS_CONSENT_VERSION_V2);

  const ordinary = await confirmSmsOptInLink(db, { rawToken: issued.rawToken, affirmDisclosure: true, env: ENV });
  assert.equal(ordinary.ok, false);
  if (!ordinary.ok) assert.equal(ordinary.code, "prior_consent_retained");
  assert.equal(await db.clientDeliverySmsConsentHistory.count({ where: { clientAccountId } }), 0);
  const untouched = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(untouched.smsConsentVersion, SMS_CONSENT_VERSION_V2);
  assert.equal(untouched.smsConsentText, V2_TEXT);
  assert.equal(untouched.smsConsentRecordedAt?.toISOString(), RECORDED_AT.toISOString());
  assert.equal(untouched.smsSuppressionState, "clear");
  assert.equal(untouched.smsEnabled, false);

  const affirmed = await confirmSupersedingGhlConsent(db, { rawToken: issued.rawToken, affirmDisclosure: true, env: ENV });
  assert.equal(affirmed.ok, true);
  if (!affirmed.ok) return;
  const history = await db.clientDeliverySmsConsentHistory.findMany({ where: { clientAccountId } });
  assert.equal(history.length, 1);
  assert.equal(history[0]?.smsConsentVersion, SMS_CONSENT_VERSION_V2);
  assert.equal(history[0]?.smsConsentText, V2_TEXT);
  assert.equal(history[0]?.smsConsentRecordedAt.toISOString(), RECORDED_AT.toISOString());
  assert.equal(history[0]?.smsVerbalOperatorId, "operator_history_test");
  assert.equal(history[0]?.smsVerbalEvidence, "Call note kept with the earlier consent.");
  assert.equal(history[0]?.recipientPhoneE164, phone);
  assert.equal(history[0]?.supersedingVersion, "ghl-lead-sms-v1");
  const current = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(current.smsConsentVersion, "ghl-lead-sms-v1");
  assert.match(current.smsConsentText ?? "", /GoHighLevel account/);
  assert.notEqual(current.smsConsentRecordedAt?.toISOString(), RECORDED_AT.toISOString());
  assert.equal(current.smsSuppressionState, "clear");
  assert.equal(current.smsSuppressedAt, null);
  assert.equal(current.smsEnabled, true);
  assert.equal(current.smsVerbalOperatorId, "operator_history_test");

  const again = await confirmSupersedingGhlConsent(db, { rawToken: issued.rawToken, affirmDisclosure: true, env: ENV });
  assert.equal(again.ok, false);
  assert.equal(await db.clientDeliverySmsConsentHistory.count({ where: { clientAccountId } }), 1);
});

test("STOP blocks the new program and leaves the earlier consent in place", async () => {
  const clientAccountId = await createClient("stopped");
  const phone = "+15555501922";
  await db.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      recipientPhoneE164: phone,
      recipientPhoneVerifiedAt: RECORDED_AT,
      smsEnabled: false,
      smsConsentVersion: "external-webhook-sms-v1",
      smsConsentText: "SA360 may text this number when a delivery webhook is accepted. Reply STOP to opt out.",
      smsConsentRecordedAt: RECORDED_AT,
      smsSuppressionState: "suppressed",
      smsSuppressedAt: RECORDED_AT,
    },
  });
  const issued = await issueSupersedingGhlConsentLink(db, {
    clientAccountId,
    phoneE164: phone,
    env: ENV,
    mail: async () => ({ ok: false, error: "not_configured" }),
  });
  assert.equal(issued.ok, false);
  if (!issued.ok) assert.equal(issued.code, "stop_suppressed");
  assert.equal(await db.clientDeliverySmsConsentHistory.count({ where: { clientAccountId } }), 0);
  const stored = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(stored.smsConsentVersion, "external-webhook-sms-v1");
  assert.equal(stored.smsSuppressionState, "suppressed");
  assert.equal(stored.smsEnabled, false);
});

async function createClient(label: string): Promise<string> {
  const clientAccountId = `smsHist${label}${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  await db.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Consent history test", status: "onboarding" },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}
