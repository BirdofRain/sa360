/**
 * SMS consent and STOP state for the notification preference.
 *
 * A verified E.164, email opt-in, and account creation do not opt the client
 * into SMS. `smsEnabled` is a separate switch and stays false until consent
 * is on file and suppression is clear. This module does not send.
 */

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

export const SMS_CONSENT_VERSION = "external-webhook-sms-v1";

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
  | "stop_unknown";

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
};

export type SmsConsentResult = { ok: true; preference: SmsConsentView } | { ok: false; code: SmsConsentCode };

type PreferenceDb = PrismaClient;

export function smsConsentTextIsCanonical(version: string, text: string): boolean {
  return version === SMS_CONSENT_VERSION && text === SMS_CONSENT_TEXT;
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
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsConsentVersion" = ${SMS_CONSENT_VERSION},
          "smsConsentText" = ${SMS_CONSENT_TEXT},
          "smsConsentRecordedAt" = transaction_timestamp(),
          "smsSuppressionState" = 'clear'::"ExternalWebhookSmsSuppression",
          "smsSuppressedAt" = NULL,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
        AND "recipientPhoneE164" IS NOT NULL
        AND "recipientPhoneVerifiedAt" IS NOT NULL
    `;
    return { ok: true, preference: await readView(tx, clientAccountId) };
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
    if (!existing.smsConsentRecordedAt || existing.smsConsentVersion !== SMS_CONSENT_VERSION) {
      return { ok: false, code: "not_opted_in" };
    }
    if (!existing.recipientPhoneE164 || !existing.recipientPhoneVerifiedAt) {
      return { ok: false, code: "phone_not_verified" };
    }
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
        AND "smsConsentText" = ${SMS_CONSENT_TEXT}
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
  };
}
