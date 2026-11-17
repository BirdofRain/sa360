/**
 * Decision for one ghl_lead_received SMS.
 *
 * The body is fixed. It does not include a consumer name, phone, email, or
 * contact id. This module does not call Twilio.
 */

import { isSourceLeadEligibleForClientNotification } from "../delivery-success-notification/notification-claim.js";
import type { GhlContactReceivedVerdict } from "../delivery-success/canonical-delivery.js";
import { smsConsentAllowsGhlLeadNotice } from "../external-webhook-notification/sms-consent.js";

export const GHL_LEAD_RECEIVED_EVENT = "ghl_lead_received" as const;

export const GHL_LEAD_RECEIVED_SMS_BODY =
  "SA360: A new lead was received in your GoHighLevel account. Open GHL to view it. Reply STOP to opt out.";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export type GhlLeadSmsSkipReason =
  | "sms_disabled"
  | "sheets_only"
  | "external_webhook_only"
  | "contact_not_received"
  | "not_opted_in"
  | "stop_suppressed"
  | "stop_unknown"
  | "before_consent"
  | "invalid_e164"
  | "invalid_event"
  | "key_too_long"
  | "template_rejected";

export function ghlLeadReceivedSmsBody(): string | null {
  const body = GHL_LEAD_RECEIVED_SMS_BODY;
  if (body.length < 1 || body.length > 160) return null;
  if (body.includes("{") || body.includes("}") || body.includes("@")) return null;
  if (/\+\d{8,}/.test(body)) return null;
  if (!body.includes("Reply STOP to opt out.")) return null;
  if (!/^[\n\r\t\x20-\x7E]+$/.test(body)) return null;
  return body;
}

/**
 * One key per source lead and destination location. The recipient is not part
 * of the key, so a later phone change does not send a second message.
 */
export function ghlLeadReceivedIdempotencyKey(input: {
  clientAccountId: string;
  sourceLeadEventId: string;
  locationIdGhl: string;
}): { ok: true; idempotencyKey: string } | { ok: false; reason: "invalid_event" | "key_too_long" } {
  const parts = [input.clientAccountId, input.sourceLeadEventId, input.locationIdGhl];
  if (parts.some((part) => !IDENTITY.test(part.trim()))) return { ok: false, reason: "invalid_event" };
  const idempotencyKey = `ghl_lead_received:${parts.map((part) => part.trim()).join(":")}`;
  if (idempotencyKey.length > 256) return { ok: false, reason: "key_too_long" };
  return { ok: true, idempotencyKey };
}

export type GhlLeadSmsPlan =
  | {
      action: "record";
      idempotencyKey: string;
      body: string;
      recipient: string;
      clientAccountId: string;
      sourceLeadEventId: string;
      locationIdGhl: string;
      liveRunId: string;
      contactId: string;
      completedAt: Date;
      consentVersion: string;
      terminalSuppression: "stop_suppressed" | null;
    }
  | { action: "skip"; reason: GhlLeadSmsSkipReason };

/**
 * Sheets success and webhook acceptance are not this event. A contact verdict
 * that is not received does not become a send.
 */
export function planGhlLeadSms(
  input: {
    evidence: "ghl_contact" | "company_sheets" | "external_webhook";
    clientAccountId: string;
    contact: GhlContactReceivedVerdict | null;
    liveRunId: string | null;
    preference: {
      smsEnabled: boolean;
      smsSuppressionState: string;
      smsConsentVersion: string | null;
      smsConsentText: string | null;
      smsConsentRecordedAt: Date | null;
      smsEnabledAt: Date | null;
      recipientPhoneE164: string | null;
    } | null;
  },
): GhlLeadSmsPlan {
  if (input.evidence === "company_sheets") return { action: "skip", reason: "sheets_only" };
  if (input.evidence === "external_webhook") return { action: "skip", reason: "external_webhook_only" };
  const contact = input.contact;
  if (!contact?.received || !contact.contactId || !contact.sourceLeadEventId || !contact.locationIdGhl || !contact.completedAt) {
    return { action: "skip", reason: "contact_not_received" };
  }
  const completedAt = new Date(contact.completedAt);
  if (Number.isNaN(completedAt.getTime())) return { action: "skip", reason: "contact_not_received" };
  const liveRunId = input.liveRunId?.trim() ?? "";
  if (!IDENTITY.test(liveRunId)) return { action: "skip", reason: "invalid_event" };
  const preference = input.preference;
  if (!preference) return { action: "skip", reason: "not_opted_in" };
  const clientAccountId = input.clientAccountId.trim();
  if (!IDENTITY.test(clientAccountId)) return { action: "skip", reason: "invalid_event" };
  if (preference.smsSuppressionState === "suppressed") return { action: "skip", reason: "stop_suppressed" };
  if (preference.smsSuppressionState !== "clear") return { action: "skip", reason: "stop_unknown" };
  if (!smsConsentAllowsGhlLeadNotice(preference)) return { action: "skip", reason: "not_opted_in" };
  const recipient = preference.recipientPhoneE164?.trim() ?? "";
  if (!E164.test(recipient)) return { action: "skip", reason: "invalid_e164" };
  const consentAt = preference.smsConsentRecordedAt;
  const enabledAt = preference.smsEnabledAt;
  if (!consentAt || !enabledAt) return { action: "skip", reason: "before_consent" };
  const gate = consentAt.getTime() > enabledAt.getTime() ? consentAt : enabledAt;
  if (
    !isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: gate,
      completedAt,
    })
  ) {
    return { action: "skip", reason: "before_consent" };
  }
  const body = ghlLeadReceivedSmsBody();
  if (!body) return { action: "skip", reason: "template_rejected" };
  const key = ghlLeadReceivedIdempotencyKey({
    clientAccountId,
    sourceLeadEventId: contact.sourceLeadEventId,
    locationIdGhl: contact.locationIdGhl,
  });
  if (!key.ok) return { action: "skip", reason: key.reason };
  return {
    action: "record",
    idempotencyKey: key.idempotencyKey,
    body,
    recipient,
    clientAccountId,
    sourceLeadEventId: contact.sourceLeadEventId,
    locationIdGhl: contact.locationIdGhl,
    liveRunId,
    contactId: contact.contactId,
    completedAt,
    consentVersion: preference.smsConsentVersion ?? "",
    terminalSuppression: null,
  };
}
