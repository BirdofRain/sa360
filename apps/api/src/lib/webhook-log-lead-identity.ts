/** Derived lead identity for admin webhook reporting (from redacted JSON only). */

import {
  isLeadCaptureProviderPayload,
  materializeLeadCapturePayload,
} from "../services/source-intake/leadcapture-payload-resolver.js";
import { tryNormalizeToVerifiedE164 } from "../services/phone-e164.service.js";

export const UNKNOWN_LEAD = "Unknown lead";

export type WebhookLeadIdentity = {
  leadName: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function trimStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Reads lifecycle-shaped `contact` object from webhook body root. */
export function contactRecordFromPayloadRoot(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root.contact);
}

function pickPhone(contact: Record<string, unknown>): string | null {
  return (
    trimStr(contact.phone_e164) ??
    trimStr(contact.phone) ??
    trimStr(contact.phone_digits) ??
    null
  );
}

function identityFromContact(contact: Record<string, unknown> | null): WebhookLeadIdentity {
  if (!contact) {
    return emptyIdentity();
  }
  const first = trimStr(contact.first_name);
  const last = trimStr(contact.last_name);
  const email = trimStr(contact.email);
  const phone = pickPhone(contact);
  return finalizeIdentity(first, last, email, phone);
}

export function emptyIdentity(): WebhookLeadIdentity {
  return {
    leadName: UNKNOWN_LEAD,
    leadFirstName: null,
    leadLastName: null,
    leadPhone: null,
    leadEmail: null,
  };
}

export function finalizeIdentity(
  leadFirstName: string | null,
  leadLastName: string | null,
  leadEmail: string | null,
  leadPhone: string | null
): WebhookLeadIdentity {
  const full = [leadFirstName, leadLastName].filter(Boolean).join(" ").trim();
  const leadName =
    full ||
    (leadEmail ? leadEmail.trim() : "") ||
    (leadPhone ? leadPhone.trim() : "") ||
    UNKNOWN_LEAD;
  return {
    leadName,
    leadFirstName,
    leadLastName,
    leadPhone,
    leadEmail,
  };
}

/** Prefer primary (e.g. request body); fill gaps from secondary (response or LifecycleEvent). */
export function mergePreferPrimary(a: WebhookLeadIdentity, b: WebhookLeadIdentity): WebhookLeadIdentity {
  const first = a.leadFirstName ?? b.leadFirstName;
  const last = a.leadLastName ?? b.leadLastName;
  const phone = a.leadPhone ?? b.leadPhone;
  const email = a.leadEmail ?? b.leadEmail;
  return finalizeIdentity(first, last, email, phone);
}

/** Derive from request JSON, then fill from response JSON where missing. */
export function deriveLeadIdentityFromWebhookBodies(
  requestBodyRedacted: unknown,
  responseBodyRedacted: unknown
): WebhookLeadIdentity {
  const reqRoot = asRecord(requestBodyRedacted);
  if (reqRoot && isLeadCaptureProviderPayload(reqRoot)) {
    const effective = materializeLeadCapturePayload(reqRoot);
    const first = trimStr(effective.first_name);
    const last = trimStr(effective.last_name);
    const email = trimStr(effective.email);
    const phoneRaw = trimStr(effective.phone);
    const phoneE164 = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
    const phone = phoneE164?.ok ? phoneE164.e164 : phoneRaw;
    const fromLeadCapture = finalizeIdentity(first, last, email, phone);
    const resContact = contactRecordFromPayloadRoot(responseBodyRedacted);
    const fromRes = identityFromContact(resContact);
    return mergePreferPrimary(fromLeadCapture, fromRes);
  }

  const reqContact = contactRecordFromPayloadRoot(requestBodyRedacted);
  const resContact = contactRecordFromPayloadRoot(responseBodyRedacted);
  const fromReq = identityFromContact(reqContact);
  const fromRes = identityFromContact(resContact);
  return mergePreferPrimary(fromReq, fromRes);
}

/** Full lifecycle event payload (stored on LifecycleEvent.payloadJson). */
export function deriveLeadIdentityFromLifecyclePayloadJson(payloadJson: unknown): WebhookLeadIdentity {
  return identityFromContact(contactRecordFromPayloadRoot(payloadJson));
}
