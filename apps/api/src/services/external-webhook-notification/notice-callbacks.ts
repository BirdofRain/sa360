/**
 * Twilio status callbacks are not inbound STOP messages.
 * Status updates an existing receipt by MessageSid.
 * Inbound STOP is a separate gated path and never clears suppression on START.
 */

import type { PrismaClient } from "@prisma/client";

import {
  markGhlLeadNoticeDeliveryConfirmed,
  markGhlLeadNoticeFailed,
  markGhlLeadNoticeProviderAccepted,
  markGhlLeadNoticeSuppressed,
} from "../ghl-lead-notice/receipt.js";
import { confirmSmsHandsetInbound, suppressSmsPhone } from "./sms-consent.js";
import {
  markExternalWebhookNoticeDeliveryConfirmed,
  markExternalWebhookNoticeFailed,
  markExternalWebhookNoticeProviderAccepted,
  markExternalWebhookNoticeProviderStop,
} from "./notice-receipt.js";
import { providerStatusConfirmsDelivery, providerStatusIsStorable } from "./notice-status.js";
import { isTwilioStartKeyword, isTwilioStopKeyword } from "./notice-dispatch.js";

export const SMS_INBOUND_OPT_OUT_ENABLED_ENV = "SA360_SMS_INBOUND_OPT_OUT_ENABLED";
export const SMS_HANDSET_PROOF_ENABLED_ENV = "SA360_SMS_HANDSET_PROOF_ENABLED";

export function isSmsInboundOptOutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SMS_INBOUND_OPT_OUT_ENABLED_ENV]?.trim() === "true";
}

export function isSmsHandsetProofEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SMS_HANDSET_PROOF_ENABLED_ENV]?.trim() === "true";
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
  if (!receipt) return applyGhlLeadNoticeStatus(db, { sid, status, errorCode: params.ErrorCode });
  const code = params.ErrorCode?.trim() ? Number(params.ErrorCode) : null;
  if (code === 21610) {
    return applyProviderStop(db, receipt.recipient, receipt.status, () =>
      markExternalWebhookNoticeProviderStop(db, { idempotencyKey: receipt.idempotencyKey })
    );
  }
  if (receipt.status === "sent" || receipt.status === "failed" || receipt.status === "suppressed") {
    return { ok: true, applied: "duplicate" };
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

const RECIPIENT_E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Twilio 21610 stops the phone, not only one receipt.
 * suppressSmsPhone writes the shared STOP row and pending notices for both programs.
 * A second callback for an already stopped phone and a closed receipt stays duplicate.
 */
async function applyProviderStop(
  db: PrismaClient,
  recipient: string,
  status: string,
  markNotice: () => Promise<unknown>
): Promise<{ ok: true; applied: "updated" | "duplicate" }> {
  const prior = RECIPIENT_E164.test(recipient)
    ? await db.clientDeliveryNotificationPreference.findFirst({
        where: { recipientPhoneE164: recipient },
        select: { smsSuppressionState: true },
      })
    : null;
  const phoneAlreadyStopped = prior?.smsSuppressionState === "suppressed";
  if (RECIPIENT_E164.test(recipient)) await suppressSmsPhone(db, recipient);
  const noticeClosed = status === "sent" || status === "failed" || status === "suppressed";
  if (!noticeClosed) await markNotice();
  if (phoneAlreadyStopped && noticeClosed) return { ok: true, applied: "duplicate" };
  return { ok: true, applied: "updated" };
}

/** Same status words as an external-webhook receipt. A missing GHL row stays unknown. */
async function applyGhlLeadNoticeStatus(
  db: PrismaClient,
  input: { sid: string; status: string; errorCode?: string }
): Promise<{ ok: true; applied: "updated" | "duplicate" | "unknown_sid" | "ignored" }> {
  const receipt = await db.ghlLeadReceivedNotice.findFirst({
    where: { providerMessageId: input.sid, provider: "twilio" },
  });
  if (!receipt) return { ok: true, applied: "unknown_sid" };
  const code = input.errorCode?.trim() ? Number(input.errorCode) : null;
  if (code === 21610) {
    return applyProviderStop(db, receipt.recipient, receipt.status, async () => {
      await markGhlLeadNoticeSuppressed(db, receipt.idempotencyKey, "provider_21610");
    });
  }
  if (receipt.status === "sent" || receipt.status === "failed" || receipt.status === "suppressed") {
    return { ok: true, applied: "duplicate" };
  }
  if (providerStatusConfirmsDelivery(input.status)) {
    if (receipt.status === "sending" || receipt.status === "uncertain") {
      await markGhlLeadNoticeProviderAccepted(db, {
        idempotencyKey: receipt.idempotencyKey,
        providerMessageId: input.sid,
        providerStatus: "accepted",
      });
    }
    const confirmed = await markGhlLeadNoticeDeliveryConfirmed(db, {
      idempotencyKey: receipt.idempotencyKey,
      providerStatus: input.status,
    });
    return { ok: true, applied: confirmed ? "updated" : "duplicate" };
  }
  if (input.status === "failed" || input.status === "undelivered" || input.status === "canceled") {
    await markGhlLeadNoticeFailed(db, {
      idempotencyKey: receipt.idempotencyKey,
      providerCode: Number.isInteger(code) ? code : null,
    });
    return { ok: true, applied: "updated" };
  }
  if (receipt.status === "sending" || receipt.status === "uncertain") {
    await markGhlLeadNoticeProviderAccepted(db, {
      idempotencyKey: receipt.idempotencyKey,
      providerMessageId: input.sid,
      providerStatus: input.status,
    });
    return { ok: true, applied: "updated" };
  }
  return { ok: true, applied: "duplicate" };
}

/**
 * STOP and handset proof are separate. START never clears suppression and never proves a handset.
 * OWN is ignored unless the handset-proof flag is the exact string true.
 */
export async function applyTwilioInboundMessage(
  db: PrismaClient,
  params: { From?: string; Body?: string },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; applied: "gated" | "ignored" | "suppressed" | "handset_proven" }> {
  const body = params.Body ?? "";
  if (isTwilioStopKeyword(body) || isTwilioStartKeyword(body)) {
    return applyTwilioInboundOptOut(db, params, env);
  }
  const own = /^OWN\s+(\d{6})$/i.exec(body.trim());
  if (!own) return { ok: true, applied: "ignored" };
  if (!isSmsHandsetProofEnabled(env)) return { ok: true, applied: "gated" };
  const from = params.From?.trim() ?? "";
  const confirmed = await confirmSmsHandsetInbound(db, { phoneE164: from, code: own[1] ?? "" });
  if (!confirmed.ok || !confirmed.preference.smsHandsetProvenAt) return { ok: true, applied: "ignored" };
  return { ok: true, applied: "handset_proven" };
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
  const suppressed = await suppressSmsPhone(db, from);
  if (suppressed.suppressed === 0) return { ok: true, applied: "ignored" };
  return { ok: true, applied: "suppressed" };
}
