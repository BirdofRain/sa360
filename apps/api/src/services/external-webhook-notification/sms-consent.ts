/**
 * SMS consent and STOP state for the notification preference.
 *
 * A verified E.164, email opt-in, and account creation do not opt the client
 * into SMS. `smsEnabled` is a separate switch and stays false until consent
 * is on file and suppression is clear. This module does not send.
 */

import { createHash, randomInt, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  SMS_CONSENT_VERSION_V2,
  smsDisclosureTextIsComplete,
} from "./sms-disclosure.js";

export const SMS_CONSENT_VERSION = "external-webhook-sms-v1";
export { SMS_CONSENT_VERSION_V2 };

/** Canonical consent copy. Stored only when the caller presents this exact text. */
export const SMS_CONSENT_TEXT =
  "SA360 may text this number when a delivery webhook is accepted. Reply STOP to opt out.";

const E164 = /^\+[1-9]\d{7,14}$/;

export type SmsConsentCode =
  | "client_not_found"
  | "preference_missing"
  | "invalid_e164"
  | "phone_not_verified"
  | "invalid_consent"
  | "not_opted_in"
  | "stop_suppressed"
  | "stop_unknown"
  | "handset_not_proven"
  | "challenge_expired"
  | "challenge_mismatch"
  | "disclosure_mismatch";

export type SmsConsentView = {
  clientAccountId: string;
  recipientPhoneE164: string | null;
  recipientPhoneVerifiedAt: Date | null;
  smsEnabled: boolean;
  smsConsentVersion: string | null;
  smsConsentRecordedAt: Date | null;
  smsEnabledAt: Date | null;
  smsDisabledAt: Date | null;
  smsSuppressionState: "unknown" | "clear" | "suppressed";
  smsSuppressedAt: Date | null;
  smsHandsetProvenAt: Date | null;
};

export type SmsConsentResult = { ok: true; preference: SmsConsentView } | { ok: false; code: SmsConsentCode };

type PreferenceDb = PrismaClient;

export function smsConsentTextIsCanonical(version: string, text: string): boolean {
  if (version === SMS_CONSENT_VERSION && text === SMS_CONSENT_TEXT) return true;
  return version === SMS_CONSENT_VERSION_V2 && smsDisclosureTextIsComplete(text);
}

export function smsConsentAllowsNotice(preference: {
  smsEnabled: boolean;
  smsSuppressionState: string;
  smsConsentVersion: string | null;
  smsConsentText: string | null;
  smsConsentRecordedAt: Date | null;
  smsHandsetProvenAt: Date | null;
}): boolean {
  if (!preference.smsEnabled || preference.smsSuppressionState !== "clear" || !preference.smsConsentRecordedAt) {
    return false;
  }
  if (!preference.smsConsentVersion || !preference.smsConsentText) return false;
  if (!smsConsentTextIsCanonical(preference.smsConsentVersion, preference.smsConsentText)) return false;
  return true;
}

/**
 * Store one verified operator number. The same number refreshes verification
 * and does not create consent. A different number clears consent and returns
 * suppression to unknown. A suppressed number cannot be replaced here.
 */
export async function recordNotificationPhone(
  db: PreferenceDb,
  input: { clientAccountId: string; phoneE164: string }
): Promise<SmsConsentResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };
  const phone = input.phoneE164.trim();
  if (!E164.test(phone)) return { ok: false, code: "invalid_e164" };

  return db.$transaction(async (tx) => {
    const client = await tx.clientAccount.findUnique({
      where: { clientAccountId },
      select: { clientAccountId: true },
    });
    if (!client) return { ok: false, code: "client_not_found" };
    const existing = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
    if (existing?.smsSuppressionState === "suppressed" && existing.recipientPhoneE164 !== phone) {
      return { ok: false, code: "stop_suppressed" };
    }
    if (!existing) {
      await tx.$executeRaw`
        INSERT INTO "ClientDeliveryNotificationPreference" (
          "id", "clientAccountId", "enabled", "channel",
          "recipientPhoneE164", "recipientPhoneVerifiedAt",
          "smsEnabled", "smsSuppressionState", "revision", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${clientAccountId}, false, 'email'::"ClientDeliveryNotificationChannel",
          ${phone}, transaction_timestamp(),
          false, 'unknown'::"ExternalWebhookSmsSuppression", 1,
          transaction_timestamp(), transaction_timestamp()
        )
      `;
    } else if (existing.recipientPhoneE164 === phone) {
      await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET "recipientPhoneVerifiedAt" = transaction_timestamp(),
            "revision" = "revision" + 1,
            "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
      `;
    } else {
      await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET "recipientPhoneE164" = ${phone},
            "recipientPhoneVerifiedAt" = transaction_timestamp(),
            "smsEnabled" = false,
            "smsDisabledAt" = CASE WHEN "smsEnabled" THEN transaction_timestamp() ELSE "smsDisabledAt" END,
            "smsConsentVersion" = NULL,
            "smsConsentText" = NULL,
            "smsConsentRecordedAt" = NULL,
            "smsSuppressionState" = 'unknown'::"ExternalWebhookSmsSuppression",
            "smsSuppressedAt" = NULL,
            "smsHandsetChallengeHash" = NULL,
            "smsHandsetDisclosureHash" = NULL,
            "smsHandsetChallengeExpiresAt" = NULL,
            "smsHandsetProvenAt" = NULL,
            "smsConsentCollection" = NULL,
            "smsVerbalAffirmation" = NULL,
            "smsVerbalDisclosureVersion" = NULL,
            "smsVerbalRecordedAt" = NULL,
            "smsVerbalOperatorId" = NULL,
            "smsVerbalEvidence" = NULL,
            "smsOptInTokenHash" = NULL,
            "smsOptInTokenExpiresAt" = NULL,
            "revision" = "revision" + 1,
            "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
          AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
      `;
    }
    return { ok: true, preference: await readView(tx, clientAccountId) };
  });
}

/** Record the canonical consent. Does not enable SMS and does not clear STOP. */
export async function recordSmsConsent(
  db: PreferenceDb,
  input: { clientAccountId: string; version: string; text: string }
): Promise<SmsConsentResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };
  if (!smsConsentTextIsCanonical(input.version, input.text)) return { ok: false, code: "invalid_consent" };

  return db.$transaction(async (tx) => {
    const existing = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
    if (!existing) return { ok: false, code: "preference_missing" };
    if (!existing.recipientPhoneE164 || !existing.recipientPhoneVerifiedAt) {
      return { ok: false, code: "phone_not_verified" };
    }
    if (existing.smsSuppressionState === "suppressed") return { ok: false, code: "stop_suppressed" };
    const version = input.version === SMS_CONSENT_VERSION_V2 ? SMS_CONSENT_VERSION_V2 : SMS_CONSENT_VERSION;
    const text = version === SMS_CONSENT_VERSION_V2 ? input.text : SMS_CONSENT_TEXT;
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsConsentVersion" = ${version},
          "smsConsentText" = ${text},
          "smsConsentRecordedAt" = transaction_timestamp(),
          "smsSuppressionState" = 'clear'::"ExternalWebhookSmsSuppression",
          "smsSuppressedAt" = NULL,
          "smsConsentCollection" = CASE
            WHEN ${version} = ${SMS_CONSENT_VERSION_V2} THEN 'recipient_link'
            ELSE "smsConsentCollection"
          END,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
        AND "recipientPhoneE164" IS NOT NULL
        AND "recipientPhoneVerifiedAt" IS NOT NULL
    `;
    const preference = await readView(tx, clientAccountId);
    if (preference.smsConsentVersion !== version) return { ok: false, code: "invalid_consent" };
    return { ok: true, preference };
  });
}

export async function setSmsNotificationEnabled(
  db: PreferenceDb,
  input: { clientAccountId: string; enabled: boolean }
): Promise<SmsConsentResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };

  return db.$transaction(async (tx) => {
    const existing = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
    if (!existing) return { ok: false, code: "preference_missing" };
    if (!input.enabled) {
      await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET "smsEnabled" = false,
            "smsDisabledAt" = transaction_timestamp(),
            "revision" = "revision" + 1,
            "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
          AND "smsEnabled" = true
      `;
      return { ok: true, preference: await readView(tx, clientAccountId) };
    }
    if (existing.smsSuppressionState === "suppressed") return { ok: false, code: "stop_suppressed" };
    if (existing.smsSuppressionState !== "clear") return { ok: false, code: "stop_unknown" };
    if (
      !existing.smsConsentRecordedAt ||
      !existing.smsConsentVersion ||
      !existing.smsConsentText ||
      !smsConsentTextIsCanonical(existing.smsConsentVersion, existing.smsConsentText)
    ) {
      return { ok: false, code: "not_opted_in" };
    }
    if (!existing.recipientPhoneE164 || !existing.recipientPhoneVerifiedAt) {
      return { ok: false, code: "phone_not_verified" };
    }
    const version = existing.smsConsentVersion;
    const text = existing.smsConsentText;
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsEnabled" = true,
          "smsEnabledAt" = transaction_timestamp(),
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "smsEnabled" = false
        AND "smsSuppressionState" = 'clear'
        AND "smsConsentVersion" = ${version}
        AND "smsConsentText" = ${text}
        AND "smsConsentRecordedAt" IS NOT NULL
        AND "recipientPhoneE164" IS NOT NULL
        AND "recipientPhoneVerifiedAt" IS NOT NULL
        AND ("smsEnabledAt" IS NULL OR "smsEnabledAt" < transaction_timestamp())
    `;
    const preference = await readView(tx, clientAccountId);
    if (!preference.smsEnabled) return { ok: false, code: "not_opted_in" };
    return { ok: true, preference };
  });
}

/**
 * Suppress every client that verified this E.164.
 * One inbound STOP or provider 21610 must not leave another account texting it.
 * START is not a function here and does not clear these rows.
 */
export async function suppressSmsPhone(
  db: PreferenceDb,
  phoneE164: string
): Promise<{ suppressed: number }> {
  const phone = phoneE164.trim();
  if (!E164.test(phone)) return { suppressed: 0 };
  const rows = await db.clientDeliveryNotificationPreference.findMany({
    where: { recipientPhoneE164: phone },
    select: { clientAccountId: true },
  });
  for (const row of rows) {
    await suppressSmsLocally(db, { clientAccountId: row.clientAccountId });
  }
  return { suppressed: rows.length };
}

/** Local STOP. Persists suppression, disables SMS, and suppresses pending SMS notices. */
export async function suppressSmsLocally(
  db: PreferenceDb,
  input: { clientAccountId: string }
): Promise<SmsConsentResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };
  return db.$transaction(async (tx) => {
    const existing = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
    if (!existing) return { ok: false, code: "preference_missing" };
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsSuppressionState" = 'suppressed'::"ExternalWebhookSmsSuppression",
          "smsSuppressedAt" = COALESCE("smsSuppressedAt", transaction_timestamp()),
          "smsEnabled" = false,
          "smsDisabledAt" = CASE WHEN "smsEnabled" THEN transaction_timestamp() ELSE "smsDisabledAt" END,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
    `;
    await tx.$executeRaw`
      UPDATE "ExternalWebhookNotificationReceipt"
      SET "status" = 'suppressed'::"ExternalWebhookNoticeStatus",
          "skipReason" = 'stop_suppressed',
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "channel" = 'sms'::"ExternalWebhookNoticeChannel"
        AND "status" = 'pending'::"ExternalWebhookNoticeStatus"
    `;
    return { ok: true, preference: await readView(tx, clientAccountId) };
  });
}

const HANDSET_CHALLENGE_MS = 15 * 60 * 1000;

export type SmsHandsetChallengeResult =
  | { ok: true; preference: SmsConsentView; challengeCode: string; expiresAt: Date }
  | { ok: false; code: SmsConsentCode };

/**
 * Store a one-time inbound code for this already-recorded number.
 * The code is returned to the authenticated caller and is not sent by SA360.
 * recipientPhoneVerifiedAt is left unchanged and is not treated as ownership.
 */
export async function issueSmsHandsetChallenge(
  db: PreferenceDb,
  input: { clientAccountId: string; phoneE164: string; disclosureText: string; now?: Date }
): Promise<SmsHandsetChallengeResult> {
  const clientAccountId = input.clientAccountId.trim();
  const phone = input.phoneE164.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };
  if (!E164.test(phone)) return { ok: false, code: "invalid_e164" };
  if (!smsDisclosureTextIsComplete(input.disclosureText)) return { ok: false, code: "invalid_consent" };
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + HANDSET_CHALLENGE_MS);
  const challengeCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challengeHash = hashHandsetChallenge(clientAccountId, phone, challengeCode);
  const disclosureHash = hashDisclosure(input.disclosureText);

  return db.$transaction(async (tx) => {
    const existing = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
    if (!existing) return { ok: false, code: "preference_missing" };
    if (existing.recipientPhoneE164 !== phone || !existing.recipientPhoneVerifiedAt) {
      return { ok: false, code: "phone_not_verified" };
    }
    if (existing.smsSuppressionState === "suppressed") return { ok: false, code: "stop_suppressed" };
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsHandsetChallengeHash" = ${challengeHash},
          "smsHandsetDisclosureHash" = ${disclosureHash},
          "smsHandsetChallengeExpiresAt" = ${expiresAt},
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "recipientPhoneE164" = ${phone}
        AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
    `;
    return { ok: true, preference: await readView(tx, clientAccountId), challengeCode, expiresAt };
  });
}

/**
 * Prove handset ownership when the inbound body is the unsent code.
 * Does not record consent, does not enable SMS, and does not clear STOP.
 */
export async function confirmSmsHandsetInbound(
  db: PreferenceDb,
  input: { phoneE164: string; code: string; now?: Date }
): Promise<SmsConsentResult> {
  const phone = input.phoneE164.trim();
  const code = input.code.trim();
  if (!E164.test(phone) || !/^\d{6}$/.test(code)) return { ok: false, code: "challenge_mismatch" };
  const now = input.now ?? new Date();
  const rows = await db.clientDeliveryNotificationPreference.findMany({
    where: { recipientPhoneE164: phone },
    select: {
      clientAccountId: true,
      smsSuppressionState: true,
      smsHandsetChallengeHash: true,
      smsHandsetChallengeExpiresAt: true,
    },
  });
  if (rows.length === 0) return { ok: false, code: "preference_missing" };
  let matched = false;
  let expired = false;
  let suppressed = false;
  for (const row of rows) {
    if (row.smsSuppressionState === "suppressed") {
      suppressed = true;
      continue;
    }
    if (!row.smsHandsetChallengeHash || !row.smsHandsetChallengeExpiresAt) continue;
    if (row.smsHandsetChallengeExpiresAt.getTime() <= now.getTime()) {
      expired = true;
      continue;
    }
    const expected = hashHandsetChallenge(row.clientAccountId, phone, code);
    if (!hashesMatch(row.smsHandsetChallengeHash, expected)) continue;
    matched = true;
    await db.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsHandsetProvenAt" = COALESCE("smsHandsetProvenAt", transaction_timestamp()),
          "smsHandsetChallengeHash" = NULL,
          "smsHandsetChallengeExpiresAt" = NULL,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${row.clientAccountId}
        AND "recipientPhoneE164" = ${phone}
        AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
        AND "smsHandsetChallengeHash" = ${expected}
    `;
  }
  if (!matched) {
    if (suppressed) return { ok: false, code: "stop_suppressed" };
    if (expired) return { ok: false, code: "challenge_expired" };
    return { ok: false, code: "challenge_mismatch" };
  }
  const preference = await db.clientDeliveryNotificationPreference.findFirst({
    where: { recipientPhoneE164: phone, smsHandsetProvenAt: { not: null } },
  });
  if (!preference) return { ok: false, code: "challenge_mismatch" };
  return { ok: true, preference: await readView(db, preference.clientAccountId) };
}

export function smsDisclosureHash(text: string): string {
  return hashDisclosure(text);
}

function hashHandsetChallenge(clientAccountId: string, phone: string, code: string): string {
  return createHash("sha256").update(`${clientAccountId}|${phone}|${code}`).digest("hex");
}

function hashDisclosure(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function hashesMatch(stored: string, expected: string): boolean {
  if (stored.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i += 1) diff |= stored.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function readView(
  tx: Pick<PrismaClient, "clientDeliveryNotificationPreference">,
  clientAccountId: string
): Promise<SmsConsentView> {
  const row = await tx.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId },
  });
  return {
    clientAccountId: row.clientAccountId,
    recipientPhoneE164: row.recipientPhoneE164,
    recipientPhoneVerifiedAt: row.recipientPhoneVerifiedAt,
    smsEnabled: row.smsEnabled,
    smsConsentVersion: row.smsConsentVersion,
    smsConsentRecordedAt: row.smsConsentRecordedAt,
    smsEnabledAt: row.smsEnabledAt,
    smsDisabledAt: row.smsDisabledAt,
    smsSuppressionState: row.smsSuppressionState,
    smsSuppressedAt: row.smsSuppressedAt,
    smsHandsetProvenAt: row.smsHandsetProvenAt,
  };
}
