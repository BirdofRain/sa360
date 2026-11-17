/**
 * Authenticated recipient opt-in.
 * Recording a phone number is not consent. The inbound OWN code is not an SMS
 * this process sends. Enabling SMS is a separate call and stays off here.
 */

import type { PrismaClient } from "@prisma/client";

import {
  readSmsDisclosure,
  smsDisclosureTextIsComplete,
  smsOptInClientAccountId,
  type SmsDisclosureView,
} from "./sms-disclosure.js";
import {
  SMS_CONSENT_VERSION_V2,
  issueSmsHandsetChallenge,
  recordNotificationPhone,
  recordSmsConsent,
  setSmsNotificationEnabled,
  smsDisclosureHash,
  type SmsConsentCode,
  type SmsConsentView,
} from "./sms-consent.js";

export type SmsOptInCode = SmsConsentCode | "legal_urls_missing" | "consent_not_affirmed" | "opt_in_disabled";

export type SmsOptInState = {
  disclosure: SmsDisclosureView;
  preference: SmsConsentView | null;
  consentRecorded: boolean;
  handsetProven: boolean;
  smsEnabled: boolean;
};

type OptInDb = PrismaClient;

export async function readRecipientSmsOptIn(
  db: OptInDb,
  input: { clientAccountId: string; env?: NodeJS.ProcessEnv }
): Promise<{ ok: true; state: SmsOptInState } | { ok: false; code: SmsOptInCode }> {
  const allowed = smsOptInClientAccountId(input.env);
  if (!allowed || allowed !== input.clientAccountId) return { ok: false, code: "opt_in_disabled" };
  const disclosure = readSmsDisclosure(input.env);
  const row = await db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId: input.clientAccountId },
  });
  return {
    ok: true,
    state: {
      disclosure,
      preference: row
        ? {
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
          }
        : null,
      consentRecorded: Boolean(row?.smsConsentRecordedAt),
      handsetProven: Boolean(row?.smsHandsetProvenAt),
      smsEnabled: row?.smsEnabled === true,
    },
  };
}

/**
 * Save the number and issue an unsent handset code. Does not record consent.
 * affirmDisclosure must be the caller's explicit true. A missing value is not consent.
 */
export async function beginRecipientSmsOptIn(
  db: OptInDb,
  input: {
    clientAccountId: string;
    phoneE164: string;
    affirmDisclosure: boolean;
    version: string;
    env?: NodeJS.ProcessEnv;
    now?: Date;
  }
): Promise<
  | { ok: true; state: SmsOptInState; challengeCode: string; expiresAt: Date }
  | { ok: false; code: SmsOptInCode }
> {
  if (input.affirmDisclosure !== true) return { ok: false, code: "consent_not_affirmed" };
  if (input.version !== SMS_CONSENT_VERSION_V2) return { ok: false, code: "invalid_consent" };
  const opened = await readRecipientSmsOptIn(db, input);
  if (!opened.ok) return opened;
  if (!opened.state.disclosure.recordable || !opened.state.disclosure.text) {
    return { ok: false, code: "legal_urls_missing" };
  }
  const phone = await recordNotificationPhone(db, {
    clientAccountId: input.clientAccountId,
    phoneE164: input.phoneE164,
  });
  if (!phone.ok) return phone;
  const challenge = await issueSmsHandsetChallenge(db, {
    clientAccountId: input.clientAccountId,
    phoneE164: input.phoneE164,
    disclosureText: opened.state.disclosure.text,
    now: input.now,
  });
  if (!challenge.ok) return challenge;
  const state = await readRecipientSmsOptIn(db, input);
  if (!state.ok) return state;
  return { ok: true, state: state.state, challengeCode: challenge.challengeCode, expiresAt: challenge.expiresAt };
}

/** Record v2 consent after handset proof. Leaves smsEnabled false. */
export async function recordRecipientSmsConsent(
  db: OptInDb,
  input: { clientAccountId: string; affirmDisclosure: boolean; version: string; env?: NodeJS.ProcessEnv }
): Promise<{ ok: true; state: SmsOptInState } | { ok: false; code: SmsOptInCode }> {
  if (input.affirmDisclosure !== true) return { ok: false, code: "consent_not_affirmed" };
  if (input.version !== SMS_CONSENT_VERSION_V2) return { ok: false, code: "invalid_consent" };
  const opened = await readRecipientSmsOptIn(db, input);
  if (!opened.ok) return opened;
  const text = opened.state.disclosure.text;
  if (!opened.state.disclosure.recordable || !text || !smsDisclosureTextIsComplete(text)) {
    return { ok: false, code: "legal_urls_missing" };
  }
  const row = await db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId: input.clientAccountId },
  });
  if (!row?.smsHandsetProvenAt) return { ok: false, code: "handset_not_proven" };
  if (row.smsHandsetDisclosureHash !== smsDisclosureHash(text)) return { ok: false, code: "disclosure_mismatch" };
  const recorded = await recordSmsConsent(db, {
    clientAccountId: input.clientAccountId,
    version: SMS_CONSENT_VERSION_V2,
    text,
  });
  if (!recorded.ok) return recorded;
  const state = await readRecipientSmsOptIn(db, input);
  if (!state.ok) return state;
  return { ok: true, state: state.state };
}

export async function setRecipientSmsEnabled(
  db: OptInDb,
  input: { clientAccountId: string; enabled: boolean; env?: NodeJS.ProcessEnv }
): Promise<{ ok: true; state: SmsOptInState } | { ok: false; code: SmsOptInCode }> {
  const opened = await readRecipientSmsOptIn(db, input);
  if (!opened.ok) return opened;
  const saved = await setSmsNotificationEnabled(db, {
    clientAccountId: input.clientAccountId,
    enabled: input.enabled,
  });
  if (!saved.ok) return saved;
  const state = await readRecipientSmsOptIn(db, input);
  if (!state.ok) return state;
  return { ok: true, state: state.state };
}
