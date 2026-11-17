/**
 * Claims one pending ghl_lead_received notice and calls Twilio once.
 * The process SMS flag stays off unless it is the exact string true.
 * A provider-accepted or uncertain row is not sent again.
 */

import type { PrismaClient } from "@prisma/client";

import { readSmsCanaryIsolation } from "@sa360/shared";

import { smsConsentAllowsGhlLeadNotice, suppressSmsPhone } from "../external-webhook-notification/sms-consent.js";
import {
  createTwilioMessageClient,
  isSmsNotificationsEnabled,
  publicTwilioStatusCallbackUrl,
  readTwilioMessagingConfig,
  TWILIO_STATUS_CALLBACK_URL_ENV,
  type TwilioConfigResult,
  type TwilioPostResult,
} from "../external-webhook-notification/twilio-programmable-messaging.js";
import { GHL_LEAD_RECEIVED_SMS_BODY } from "./contract.js";
import {
  claimGhlLeadNotice,
  markGhlLeadNoticeFailed,
  markGhlLeadNoticeProviderAccepted,
  markGhlLeadNoticeSuppressed,
  markGhlLeadNoticeUncertain,
} from "./receipt.js";

export type GhlLeadSmsSender = (input: {
  to: string;
  body: string;
  messagingServiceSid: string;
  from: string | null;
  statusCallback: string | null;
}) => Promise<TwilioPostResult>;

export async function dispatchGhlLeadNotice(
  db: PrismaClient,
  receiptId: string,
  deps: {
    env?: NodeJS.ProcessEnv;
    twilioConfig?: TwilioConfigResult;
    sms?: GhlLeadSmsSender;
  } = {}
): Promise<{ ok: true; skipped?: string; status?: string }> {
  const env = deps.env ?? process.env;
  if (readSmsCanaryIsolation(env).mode !== "off") return { ok: true, skipped: "canary_isolation" };
  const current = await db.ghlLeadReceivedNotice.findUnique({ where: { id: receiptId } });
  if (!current) return { ok: true, skipped: "not_found" };
  if (current.event !== "ghl_lead_received" || current.templateId !== "ghl_lead_received") {
    return { ok: true, skipped: "not_ghl_lead" };
  }
  if (
    current.status === "provider_accepted" ||
    current.status === "uncertain" ||
    current.status === "sent" ||
    current.status === "failed" ||
    current.status === "suppressed"
  ) {
    return { ok: true, skipped: current.status };
  }
  if (!isSmsNotificationsEnabled(env)) return { ok: true, skipped: "sms_disabled" };
  const twilioConfig = deps.twilioConfig ?? readTwilioMessagingConfig(env);
  if (!twilioConfig.ok) return { ok: true, skipped: "invalid_twilio_config" };
  const preference = await db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId: current.clientAccountId },
  });
  if (!preference || preference.smsSuppressionState === "suppressed" || preference.recipientPhoneE164 !== current.recipient) {
    await markGhlLeadNoticeSuppressed(db, current.idempotencyKey);
    if (preference?.smsSuppressionState === "suppressed" && preference.recipientPhoneE164) {
      await suppressSmsPhone(db, preference.recipientPhoneE164);
    }
    return { ok: true, status: "suppressed" };
  }
  if (!smsConsentAllowsGhlLeadNotice(preference)) {
    await markGhlLeadNoticeSuppressed(db, current.idempotencyKey, "not_opted_in");
    return { ok: true, skipped: "not_opted_in" };
  }
  const claimed = await claimGhlLeadNotice(db, current.idempotencyKey);
  if (!claimed.claimed || !claimed.receipt) return { ok: true, skipped: claimed.reason ?? "not_pending" };
  const statusCallback = publicTwilioStatusCallbackUrl(env[TWILIO_STATUS_CALLBACK_URL_ENV]);
  const send =
    deps.sms ?? ((input) => createTwilioMessageClient(twilioConfig.config, fetch).postMessage(input));
  try {
    const posted = await send({
      to: claimed.receipt.recipient,
      body: GHL_LEAD_RECEIVED_SMS_BODY,
      messagingServiceSid: twilioConfig.config.messagingServiceSid,
      from: twilioConfig.config.from,
      statusCallback,
    });
    if (!posted.ok && posted.errorClass === "stop_suppressed") {
      await suppressSmsPhone(db, claimed.receipt.recipient);
      await markGhlLeadNoticeSuppressed(db, claimed.receipt.idempotencyKey);
      return { ok: true, status: "suppressed" };
    }
    if (!posted.ok) {
      await markGhlLeadNoticeFailed(db, {
        idempotencyKey: claimed.receipt.idempotencyKey,
        providerCode: posted.providerCode,
      });
      return { ok: true, status: "failed" };
    }
    await markGhlLeadNoticeProviderAccepted(db, {
      idempotencyKey: claimed.receipt.idempotencyKey,
      providerMessageId: posted.providerMessageId,
      providerStatus: posted.providerStatus === "unknown" ? "accepted" : posted.providerStatus,
    });
    return { ok: true, status: "provider_accepted" };
  } catch {
    await markGhlLeadNoticeUncertain(db, claimed.receipt.idempotencyKey);
    return { ok: true, status: "uncertain" };
  }
}
