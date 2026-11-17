/**
 * One-time recipient opt-in link and operator verbal notes.
 * Verbal notes stay pending_confirmation and do not enable SMS.
 * The link is the recipient's own unchecked confirmation. Portal login is not required.
 */

import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { sendTransactionalEmail, type SendTransactionalEmailResult } from "../../lib/transactional-email.js";
import {
  SMS_CONSENT_VERSION_V2,
  readSmsDisclosure,
  smsDisclosureTextIsComplete,
  smsOptInPublicOrigin,
  type SmsDisclosureView,
} from "./sms-disclosure.js";
import {
  recordNotificationPhone,
  recordSmsConsent,
  setSmsNotificationEnabled,
  smsDisclosureHash,
  type SmsConsentCode,
} from "./sms-consent.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPT_IN_TTL_MS = 48 * 60 * 60 * 1000;

export type SmsLinkCode =
  | SmsConsentCode
  | "legal_urls_missing"
  | "consent_not_affirmed"
  | "token_invalid"
  | "token_expired"
  | "operator_required"
  | "affirmation_required"
  | "confirmation_email_required";

export type SmsLinkOffer = "sent" | "email_not_configured" | "origin_unconfigured" | "invalid_recipient";

type LinkDb = PrismaClient;
type Mailer = (input: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<SendTransactionalEmailResult>;

export function maskE164(phone: string): string {
  if (phone.length < 6) return "••••";
  return `${phone.slice(0, 2)}••••${phone.slice(-4)}`;
}

export async function issueSmsOptInLink(
  db: LinkDb,
  input: {
    clientAccountId: string;
    phoneE164: string;
    confirmationEmail?: string | null;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    mail?: Mailer;
  }
): Promise<
  | {
      ok: true;
      rawToken: string;
      expiresAt: Date;
      path: string;
      url: string | null;
      email: SmsLinkOffer;
      smsEnabled: false;
      consentRecorded: false;
    }
  | { ok: false; code: SmsLinkCode }
> {
  const phone = await recordNotificationPhone(db, {
    clientAccountId: input.clientAccountId,
    phoneE164: input.phoneE164,
  });
  if (!phone.ok) return phone;
  if (phone.preference.smsSuppressionState === "suppressed") return { ok: false, code: "stop_suppressed" };
  const now = input.now ?? new Date();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashOptInToken(rawToken);
  const expiresAt = new Date(now.getTime() + OPT_IN_TTL_MS);
  const disclosure = readSmsDisclosure(input.env);
  const disclosureHash = disclosure.text ? smsDisclosureHash(disclosure.text) : null;
  await db.$executeRaw`
    UPDATE "ClientDeliveryNotificationPreference"
    SET "smsOptInTokenHash" = ${tokenHash},
        "smsOptInTokenExpiresAt" = ${expiresAt},
        "smsHandsetDisclosureHash" = ${disclosureHash},
        "smsEnabled" = false,
        "revision" = "revision" + 1,
        "updatedAt" = transaction_timestamp()
    WHERE "clientAccountId" = ${input.clientAccountId}
      AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
      AND "smsConsentRecordedAt" IS NULL
  `;
  const row = await db.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!row || row.smsOptInTokenHash !== tokenHash) return { ok: false, code: "stop_suppressed" };
  const path = `/portal/sms-opt-in/${rawToken}`;
  const origin = smsOptInPublicOrigin(input.env);
  const url = origin ? `${origin}${path}` : null;
  const email = await offerLinkByEmail({
    to: input.confirmationEmail ?? "",
    url,
    disclosure,
    env: input.env,
    mail: input.mail,
    idempotencyKey: `sms-opt-in:${tokenHash}`,
  });
  if (input.confirmationEmail && EMAIL.test(input.confirmationEmail.trim().toLowerCase())) {
    await db.clientDeliveryNotificationPreference.update({
      where: { clientAccountId: input.clientAccountId },
      data: { smsConfirmationEmail: input.confirmationEmail.trim().toLowerCase() },
    });
  }
  return { ok: true, rawToken, expiresAt, path, url, email, smsEnabled: false, consentRecorded: false };
}

export async function recordVerbalSmsConsent(
  db: LinkDb,
  input: {
    clientAccountId: string;
    phoneE164: string;
    affirmativeResponse: string;
    disclosureVersion: string;
    operatorId: string;
    evidence?: string | null;
    confirmationEmail: string;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    mail?: Mailer;
  }
): Promise<
  | {
      ok: true;
      status: "pending_confirmation";
      smsEnabled: false;
      consentRecorded: false;
      recordedAt: Date;
      url: string | null;
      email: SmsLinkOffer;
    }
  | { ok: false; code: SmsLinkCode }
> {
  const affirmation = input.affirmativeResponse.trim();
  if (affirmation.length < 2 || affirmation.length > 500) return { ok: false, code: "affirmation_required" };
  if (input.disclosureVersion !== SMS_CONSENT_VERSION_V2) return { ok: false, code: "invalid_consent" };
  if (!input.operatorId.trim()) return { ok: false, code: "operator_required" };
  const email = input.confirmationEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, code: "confirmation_email_required" };
  const evidence = input.evidence?.trim() || null;
  if (evidence && evidence.length > 500) return { ok: false, code: "invalid_consent" };
  const issued = await issueSmsOptInLink(db, {
    clientAccountId: input.clientAccountId,
    phoneE164: input.phoneE164,
    confirmationEmail: email,
    env: input.env,
    now: input.now,
    mail: input.mail,
  });
  if (!issued.ok) return issued;
  const now = input.now ?? new Date();
  await db.$executeRaw`
    UPDATE "ClientDeliveryNotificationPreference"
    SET "smsConsentCollection" = 'pending_confirmation',
        "smsVerbalAffirmation" = ${affirmation},
        "smsVerbalDisclosureVersion" = ${SMS_CONSENT_VERSION_V2},
        "smsVerbalRecordedAt" = ${now},
        "smsVerbalOperatorId" = ${input.operatorId.trim()},
        "smsVerbalEvidence" = ${evidence},
        "smsEnabled" = false,
        "smsConsentVersion" = NULL,
        "smsConsentText" = NULL,
        "smsConsentRecordedAt" = NULL,
        "revision" = "revision" + 1,
        "updatedAt" = transaction_timestamp()
    WHERE "clientAccountId" = ${input.clientAccountId}
      AND "smsSuppressionState" IS DISTINCT FROM 'suppressed'
      AND "smsConsentRecordedAt" IS NULL
  `;
  const row = await db.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!row || row.smsConsentCollection !== "pending_confirmation" || row.smsEnabled) {
    return { ok: false, code: "stop_suppressed" };
  }
  return {
    ok: true,
    status: "pending_confirmation",
    smsEnabled: false,
    consentRecorded: false,
    recordedAt: row.smsVerbalRecordedAt ?? now,
    url: issued.url,
    email: issued.email,
  };
}

export async function readSmsOptInLink(
  db: LinkDb,
  rawToken: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Promise<
  | {
      ok: true;
      disclosure: SmsDisclosureView;
      phoneMasked: string;
      consentRecorded: boolean;
      smsEnabled: false;
      pendingConfirmation: boolean;
    }
  | { ok: false; code: SmsLinkCode }
> {
  const row = await findToken(db, rawToken, now);
  if (!row.ok) return row;
  return {
    ok: true,
    disclosure: readSmsDisclosure(env),
    phoneMasked: maskE164(row.phone),
    consentRecorded: row.consentRecorded,
    smsEnabled: false,
    pendingConfirmation: row.collection === "pending_confirmation",
  };
}

export async function confirmSmsOptInLink(
  db: LinkDb,
  input: { rawToken: string; affirmDisclosure: boolean; env?: NodeJS.ProcessEnv; now?: Date }
): Promise<{ ok: true; consentRecorded: true; smsEnabled: boolean } | { ok: false; code: SmsLinkCode }> {
  if (input.affirmDisclosure !== true) return { ok: false, code: "consent_not_affirmed" };
  const now = input.now ?? new Date();
  const row = await findToken(db, input.rawToken, now);
  if (!row.ok) return row;
  const disclosure = readSmsDisclosure(input.env);
  if (!disclosure.recordable || !disclosure.text || !smsDisclosureTextIsComplete(disclosure.text)) {
    return { ok: false, code: "legal_urls_missing" };
  }
  if (row.disclosureHash && row.disclosureHash !== smsDisclosureHash(disclosure.text)) {
    return { ok: false, code: "disclosure_mismatch" };
  }
  if (!row.consentRecorded) {
    const recorded = await recordSmsConsent(db, {
      clientAccountId: row.clientAccountId,
      version: SMS_CONSENT_VERSION_V2,
      text: disclosure.text,
    });
    if (!recorded.ok) return recorded;
  }
  const enabled = await setSmsNotificationEnabled(db, { clientAccountId: row.clientAccountId, enabled: true });
  if (!enabled.ok) return enabled;
  await db.$executeRaw`
    UPDATE "ClientDeliveryNotificationPreference"
    SET "smsOptInTokenHash" = NULL,
        "smsOptInTokenExpiresAt" = NULL,
        "revision" = "revision" + 1,
        "updatedAt" = transaction_timestamp()
    WHERE "clientAccountId" = ${row.clientAccountId}
      AND "smsEnabled" = true
  `;
  return { ok: true, consentRecorded: true, smsEnabled: enabled.preference.smsEnabled };
}

async function findToken(
  db: LinkDb,
  rawToken: string,
  now: Date
): Promise<
  | {
      ok: true;
      clientAccountId: string;
      phone: string;
      collection: string | null;
      disclosureHash: string | null;
      consentRecorded: boolean;
    }
  | { ok: false; code: SmsLinkCode }
> {
  if (!TOKEN_RE.test(rawToken)) return { ok: false, code: "token_invalid" };
  const row = await db.clientDeliveryNotificationPreference.findUnique({ where: { smsOptInTokenHash: hashOptInToken(rawToken) } });
  if (!row?.recipientPhoneE164 || !row.smsOptInTokenExpiresAt) return { ok: false, code: "token_invalid" };
  if (row.smsSuppressionState === "suppressed") return { ok: false, code: "stop_suppressed" };
  if (row.smsOptInTokenExpiresAt.getTime() <= now.getTime()) return { ok: false, code: "token_expired" };
  if (row.smsConsentRecordedAt && row.smsEnabled) return { ok: false, code: "token_invalid" };
  return {
    ok: true,
    clientAccountId: row.clientAccountId,
    phone: row.recipientPhoneE164,
    collection: row.smsConsentCollection,
    disclosureHash: row.smsHandsetDisclosureHash,
    consentRecorded: Boolean(row.smsConsentRecordedAt),
  };
}

async function offerLinkByEmail(input: {
  to: string;
  url: string | null;
  disclosure: SmsDisclosureView;
  env?: NodeJS.ProcessEnv;
  mail?: Mailer;
  idempotencyKey: string;
}): Promise<SmsLinkOffer> {
  const to = input.to.trim().toLowerCase();
  if (!to) return "invalid_recipient";
  if (!EMAIL.test(to)) return "invalid_recipient";
  if (!input.url) return "origin_unconfigured";
  const mail = input.mail;
  if (!mail && !transactionalReady(input.env)) return "email_not_configured";
  const send = mail ?? ((message) => sendTransactionalEmail(message));
  const text = [
    `${input.disclosure.businessName} invited you to confirm operational text notifications.`,
    input.disclosure.purpose,
    input.disclosure.frequency,
    input.disclosure.rates,
    input.disclosure.stop,
    input.disclosure.help,
    "The confirmation page opens with the checkbox unchecked.",
    "Opening this message does not record consent and does not enable texts.",
    input.url,
  ].join(" ");
  const sent = await send({
    to,
    subject: "Confirm Life Agent Launch text notifications",
    text,
    idempotencyKey: input.idempotencyKey,
  });
  return sent.ok ? "sent" : "email_not_configured";
}

function transactionalReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.SA360_TRANSACTIONAL_EMAIL_FROM?.trim());
}

function hashOptInToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
