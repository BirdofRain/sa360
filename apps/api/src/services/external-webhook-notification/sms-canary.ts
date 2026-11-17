/**
 * One sandbox acceptance, one SMS receipt, one recipient, at most one provider call.
 * Does not scan historical acceptances, move the discovery cursor, or call Resend.
 */

import type { PrismaClient } from "@prisma/client";

import { readSmsCanaryIsolation } from "@sa360/shared";

import { dispatchExternalWebhookNotice, type NoticeSmsSender } from "./notice-dispatch.js";
import { recordEligibleExternalWebhookNotice } from "./notice-receipt.js";
import { SMS_CONSENT_VERSION_V2 } from "./sms-disclosure.js";
import {
  createTwilioMessageClient,
  isSmsNotificationsEnabled,
  readTwilioMessagingConfig,
  type TwilioConfigResult,
} from "./twilio-programmable-messaging.js";

export type SmsCanaryResult = {
  ok: true;
  skipped?: string;
  scanned: 0;
  emailCalls: 0;
  smsCalls: number;
  receiptId: string | null;
};

export async function runIsolatedSmsCanary(
  db: PrismaClient,
  input: {
    attemptId: string;
    env?: NodeJS.ProcessEnv;
    twilioConfig?: TwilioConfigResult;
    sms?: NoticeSmsSender;
  }
): Promise<SmsCanaryResult> {
  const env = input.env ?? process.env;
  const isolation = readSmsCanaryIsolation(env);
  if (isolation.mode !== "ready") return { ok: true, skipped: "canary_isolation", scanned: 0, emailCalls: 0, smsCalls: 0, receiptId: null };
  if (input.attemptId.trim() !== isolation.attemptId) {
    return { ok: true, skipped: "attempt_mismatch", scanned: 0, emailCalls: 0, smsCalls: 0, receiptId: null };
  }
  if (!isSmsNotificationsEnabled(env)) {
    return { ok: true, skipped: "sms_disabled", scanned: 0, emailCalls: 0, smsCalls: 0, receiptId: null };
  }
  const attempt = await db.externalWebhookDeliveryAttempt.findUnique({ where: { id: isolation.attemptId } });
  if (
    !attempt ||
    attempt.clientAccountId !== isolation.clientAccountId ||
    attempt.state !== "attempted" ||
    attempt.outcome !== "http_accepted" ||
    attempt.requestLeftSa360 !== true ||
    attempt.httpStatus == null ||
    attempt.httpStatus < 200 ||
    attempt.httpStatus > 299
  ) {
    return { ok: true, skipped: "attempt_mismatch", scanned: 0, emailCalls: 0, smsCalls: 0, receiptId: null };
  }
  const preference = await db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId: isolation.clientAccountId },
  });
  if (
    !preference ||
    preference.recipientPhoneE164 !== isolation.recipientE164 ||
    preference.smsConsentVersion !== SMS_CONSENT_VERSION_V2 ||
    preference.smsEnabled !== true ||
    preference.smsSuppressionState !== "clear"
  ) {
    return { ok: true, skipped: "recipient_not_ready", scanned: 0, emailCalls: 0, smsCalls: 0, receiptId: null };
  }
  const recorded = await recordEligibleExternalWebhookNotice(
    db,
    { attemptId: attempt.id, channel: "sms" },
    { env, twilioConfig: input.twilioConfig }
  );
  if (!recorded.ok || recorded.receipt.channel !== "sms" || recorded.receipt.recipient !== isolation.recipientE164) {
    return {
      ok: true,
      skipped: recorded.ok ? "recipient_not_ready" : recorded.reason,
      scanned: 0,
      emailCalls: 0,
      smsCalls: 0,
      receiptId: recorded.ok ? recorded.receipt.id : null,
    };
  }
  const emailCount = await db.externalWebhookNotificationReceipt.count({
    where: { attemptId: attempt.id, channel: "email" },
  });
  if (emailCount > 0) {
    return { ok: true, skipped: "email_present", scanned: 0, emailCalls: 0, smsCalls: 0, receiptId: recorded.receipt.id };
  }
  let smsCalls = 0;
  const config = input.twilioConfig ?? readTwilioMessagingConfig(env);
  const sender: NoticeSmsSender = async (message) => {
    if (smsCalls >= 1) throw new Error("sms_budget");
    smsCalls += 1;
    if (input.sms) return input.sms(message);
    if (!config.ok) throw new Error("invalid_twilio_config");
    return createTwilioMessageClient(config.config, fetch).postMessage(message);
  };
  const dispatched = await dispatchExternalWebhookNotice(db, recorded.receipt.id, {
    env,
    twilioConfig: input.twilioConfig,
    sms: sender,
    mail: async () => {
      throw new Error("canary_email_forbidden");
    },
  });
  if (smsCalls > 1) {
    return { ok: true, skipped: "sms_budget", scanned: 0, emailCalls: 0, smsCalls, receiptId: recorded.receipt.id };
  }
  return {
    ok: true,
    skipped: dispatched.skipped,
    scanned: 0,
    emailCalls: 0,
    smsCalls,
    receiptId: recorded.receipt.id,
  };
}
