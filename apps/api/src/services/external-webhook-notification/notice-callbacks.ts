/**
 * Twilio status callbacks are not inbound STOP messages.
 * Status updates an existing receipt by MessageSid.
 * Inbound STOP is a separate gated path and never clears suppression on START.
 */

import type { PrismaClient } from "@prisma/client";

import { suppressSmsLocally } from "./sms-consent.js";
import {
  markExternalWebhookNoticeDeliveryConfirmed,
  markExternalWebhookNoticeFailed,
  markExternalWebhookNoticeProviderAccepted,
  markExternalWebhookNoticeProviderStop,
} from "./notice-receipt.js";
import { providerStatusConfirmsDelivery, providerStatusIsStorable } from "./notice-status.js";
import { isTwilioStartKeyword, isTwilioStopKeyword } from "./notice-dispatch.js";

export const SMS_INBOUND_OPT_OUT_ENABLED_ENV = "SA360_SMS_INBOUND_OPT_OUT_ENABLED";

export function isSmsInboundOptOutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SMS_INBOUND_OPT_OUT_ENABLED_ENV]?.trim() === "true";
}

export async function applyTwilioNoticeStatus(
  db: PrismaClient,
  params: { MessageSid?: string; MessageStatus?: string; ErrorCode?: string }
): Promise<{ ok: true; applied: "updated" | "duplicate" | "unknown_sid" | "ignored" }> {
  const sid = params.MessageSid?.trim() ?? "";
  const status = params.MessageStatus?.trim().toLowerCase() ?? "";
  if (!/^(?:SM|MM)[0-9a-fA-F]{32}$/.test(sid) || !providerStatusIsStorable(status)) {
    return { ok: true, applied: "ignored" };
  }
  const receipt = await db.externalWebhookNotificationReceipt.findFirst({
    where: { providerMessageId: sid, provider: "twilio" },
  });
  if (!receipt) return { ok: true, applied: "unknown_sid" };
  if (receipt.status === "sent" || receipt.status === "failed" || receipt.status === "suppressed") {
    return { ok: true, applied: "duplicate" };
  }
  const code = params.ErrorCode?.trim() ? Number(params.ErrorCode) : null;
  if (code === 21610) {
    await markExternalWebhookNoticeProviderStop(db, { idempotencyKey: receipt.idempotencyKey });
    return { ok: true, applied: "updated" };
  }
  if (providerStatusConfirmsDelivery(status)) {
    if (receipt.status === "sending" || receipt.status === "uncertain") {
      await markExternalWebhookNoticeProviderAccepted(db, {
        idempotencyKey: receipt.idempotencyKey,
        provider: "twilio",
        providerMessageId: sid,
        providerStatus: "accepted",
      });
    }
    const confirmed = await markExternalWebhookNoticeDeliveryConfirmed(db, {
      idempotencyKey: receipt.idempotencyKey,
      providerStatus: status,
    });
    return { ok: true, applied: confirmed.ok ? "updated" : "duplicate" };
  }
  if (status === "failed" || status === "undelivered" || status === "canceled") {
    await markExternalWebhookNoticeFailed(db, {
      idempotencyKey: receipt.idempotencyKey,
      providerCode: Number.isInteger(code) ? code : null,
    });
    return { ok: true, applied: "updated" };
  }
  if (receipt.status === "sending" || receipt.status === "uncertain") {
    await markExternalWebhookNoticeProviderAccepted(db, {
      idempotencyKey: receipt.idempotencyKey,
      provider: "twilio",
      providerMessageId: sid,
      providerStatus: status,
    });
    return { ok: true, applied: "updated" };
  }
  return { ok: true, applied: "duplicate" };
}

export async function applyTwilioInboundOptOut(
  db: PrismaClient,
  params: { From?: string; Body?: string },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; applied: "gated" | "ignored" | "suppressed" }> {
  if (!isSmsInboundOptOutEnabled(env)) return { ok: true, applied: "gated" };
  const body = params.Body ?? "";
  if (isTwilioStartKeyword(body) || !isTwilioStopKeyword(body)) return { ok: true, applied: "ignored" };
  const from = params.From?.trim() ?? "";
  if (!/^\+[1-9]\d{7,14}$/.test(from)) return { ok: true, applied: "ignored" };
  const preference = await db.clientDeliveryNotificationPreference.findFirst({
    where: { recipientPhoneE164: from },
    select: { clientAccountId: true },
  });
  if (!preference) return { ok: true, applied: "ignored" };
  await suppressSmsLocally(db, { clientAccountId: preference.clientAccountId });
  return { ok: true, applied: "suppressed" };
}
