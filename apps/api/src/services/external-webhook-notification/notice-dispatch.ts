/**
 * Claims one pending notice and calls the matching provider once.
 * provider_accepted and uncertain are not sent again.
 * A sending row older than the stale window becomes uncertain and is not resent.
 * Webhook attempt outcome is not updated here.
 */

import type { PrismaClient } from "@prisma/client";

import { sendTransactionalEmail, type SendTransactionalEmailResult } from "../../lib/transactional-email.js";
import { EXTERNAL_WEBHOOK_EMAIL_TEMPLATES, EXTERNAL_WEBHOOK_SMS_TEMPLATES } from "./notification-contract.js";
import {
  claimExternalWebhookNotice,
  markExternalWebhookNoticeFailed,
  markExternalWebhookNoticeProviderAccepted,
  markExternalWebhookNoticeProviderStop,
  markExternalWebhookNoticeUncertain,
} from "./notice-receipt.js";
import {
  createTwilioMessageClient,
  isSmsNotificationsEnabled,
  readTwilioMessagingConfig,
  type TwilioConfigResult,
  type TwilioPostResult,
} from "./twilio-programmable-messaging.js";

export const EXTERNAL_WEBHOOK_NOTICE_STALE_CLAIM_MS = 10 * 60 * 1000;

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

export type NoticeMailer = (
  input: { to: string; subject: string; text: string; idempotencyKey: string }
) => Promise<SendTransactionalEmailResult>;

export type NoticeSmsSender = (input: {
  to: string;
  body: string;
  messagingServiceSid: string;
  from: string | null;
}) => Promise<TwilioPostResult>;

/**
 * Sending rows older than the window become uncertain. They are not returned to pending.
 */
export async function promoteStaleExternalWebhookNotices(
  db: PrismaClient,
  now: Date = new Date(),
  staleMs: number = EXTERNAL_WEBHOOK_NOTICE_STALE_CLAIM_MS
): Promise<{ promoted: number }> {
  const cutoff = new Date(now.getTime() - staleMs);
  const promoted = await db.externalWebhookNotificationReceipt.updateMany({
    where: { status: "sending", claimedAt: { lt: cutoff } },
    data: { status: "uncertain", lastError: "transport_uncertain" },
  });
  return { promoted: promoted.count };
}

export async function dispatchExternalWebhookNotice(
  db: PrismaClient,
  receiptId: string,
  deps: {
    env?: NodeJS.ProcessEnv;
    emailConfigured?: boolean;
    twilioConfig?: TwilioConfigResult;
    mail?: NoticeMailer;
    sms?: NoticeSmsSender;
  } = {}
): Promise<{ ok: true; skipped?: string; status?: string }> {
  const env = deps.env ?? process.env;
  const current = await db.externalWebhookNotificationReceipt.findUnique({ where: { id: receiptId } });
  if (!current) return { ok: true, skipped: "not_found" };
  if (current.status === "provider_accepted" || current.status === "uncertain" || current.status === "sent") {
    return { ok: true, skipped: current.status };
  }
  if (current.status !== "pending") return { ok: true, skipped: current.status };
  const claimed = await claimExternalWebhookNotice(
    db,
    { idempotencyKey: current.idempotencyKey, dispatchEnabled: isSmsNotificationsEnabled(env) },
    { env, emailConfigured: deps.emailConfigured, twilioConfig: deps.twilioConfig }
  );
  if (!claimed.claimed || !claimed.receipt) {
    return { ok: true, skipped: claimed.claimed ? "not_pending" : claimed.reason };
  }
  try {
    if (claimed.receipt.channel === "email") {
      const mail = deps.mail ?? ((input) => sendTransactionalEmail(input));
      const template = EXTERNAL_WEBHOOK_EMAIL_TEMPLATES.delivery_accepted;
      const sent = await mail({
        to: claimed.receipt.recipient,
        subject: template.subject,
        text: template.text,
        idempotencyKey: claimed.receipt.idempotencyKey,
      });
      if (sent.ok && sent.id && /^[A-Za-z0-9_-]{1,64}$/.test(sent.id)) {
        await markExternalWebhookNoticeProviderAccepted(db, {
          idempotencyKey: claimed.receipt.idempotencyKey,
          provider: "resend",
          providerMessageId: sent.id,
          providerStatus: "accepted",
        });
        return { ok: true, status: "provider_accepted" };
      }
      await markExternalWebhookNoticeUncertain(db, { idempotencyKey: claimed.receipt.idempotencyKey });
      return { ok: true, status: "uncertain" };
    }
    const config = deps.twilioConfig ?? readTwilioMessagingConfig(env);
    if (!config.ok) {
      await markExternalWebhookNoticeFailed(db, { idempotencyKey: claimed.receipt.idempotencyKey, providerCode: null });
      return { ok: true, status: "failed" };
    }
    const send = deps.sms ?? ((input) =>
      createTwilioMessageClient(config.config, fetch).postMessage({
        ...input,
      }));
    const posted = await send({
      to: claimed.receipt.recipient,
      body: EXTERNAL_WEBHOOK_SMS_TEMPLATES.delivery_accepted,
      messagingServiceSid: config.config.messagingServiceSid,
      from: config.config.from,
    });
    if (!posted.ok && posted.errorClass === "stop_suppressed") {
      await markExternalWebhookNoticeProviderStop(db, { idempotencyKey: claimed.receipt.idempotencyKey });
      return { ok: true, status: "suppressed" };
    }
    if (!posted.ok) {
      await markExternalWebhookNoticeFailed(db, {
        idempotencyKey: claimed.receipt.idempotencyKey,
        providerCode: posted.providerCode,
      });
      return { ok: true, status: "failed" };
    }
    await markExternalWebhookNoticeProviderAccepted(db, {
      idempotencyKey: claimed.receipt.idempotencyKey,
      provider: "twilio",
      providerMessageId: posted.providerMessageId,
      providerStatus: posted.providerStatus === "unknown" ? "accepted" : posted.providerStatus,
    });
    return { ok: true, status: "provider_accepted" };
  } catch {
    await markExternalWebhookNoticeUncertain(db, { idempotencyKey: claimed.receipt.idempotencyKey });
    return { ok: true, status: "uncertain" };
  }
}

export function isTwilioStopKeyword(body: string): boolean {
  return STOP_WORDS.has(body.trim().toUpperCase());
}

/** START, YES, and UNSTOP are ignored. They do not clear a stored STOP. */
export function isTwilioStartKeyword(body: string): boolean {
  return ["START", "YES", "UNSTOP"].includes(body.trim().toUpperCase());
}
