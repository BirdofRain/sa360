import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../services/phone-e164.service.js";

export type ContactPhoneSource =
  | "phone_e164"
  | "phone"
  | "phone_digits"
  | "none";

/** Try contact.phone_e164, then contact.phone, then contact.phone_digits (normalized). */
export function pickRawContactPhoneFromContact(
  contact: LifecycleEventSchema["contact"]
): {
  raw: string;
  source: ContactPhoneSource;
} {
  const e164 = contact.phone_e164?.trim();
  if (e164) {
    return { raw: contact.phone_e164 ?? "", source: "phone_e164" };
  }
  const phone = contact.phone?.trim() ?? "";
  if (phone) {
    return { raw: phone, source: "phone" };
  }
  const digits = contact.phone_digits?.trim() ?? "";
  if (digits) {
    return { raw: contact.phone_digits ?? "", source: "phone_digits" };
  }
  return { raw: "", source: "none" };
}

export function resolveLifecycleContactPhoneDetails(
  payload: LifecycleEventSchema
): {
  normalized_e164: string | null;
  raw_source: ContactPhoneSource;
  raw_input: string;
  phone_skip_reason: string | null;
} {
  const pick = pickRawContactPhoneFromContact(payload.contact);
  if (pick.source === "none" || !pick.raw.trim()) {
    return {
      normalized_e164: null,
      raw_source: pick.source,
      raw_input: pick.raw,
      phone_skip_reason: "no_phone_in_contact",
    };
  }
  const result = tryNormalizeToVerifiedE164(pick.raw);
  if (!result.ok) {
    return {
      normalized_e164: null,
      raw_source: pick.source,
      raw_input: pick.raw,
      phone_skip_reason: result.reason,
    };
  }
  return {
    normalized_e164: result.e164,
    raw_source: pick.source,
    raw_input: pick.raw,
    phone_skip_reason: null,
  };
}

/** Non-null reason string when inbound index upsert cannot run (excluding thrown DB errors). */
export function contactIndexUpsertSkippedReasonStatic(
  payload: LifecycleEventSchema,
  phone: {
    normalized_e164: string | null;
    phone_skip_reason: string | null;
  }
): string | null {
  const ca = payload.client_account_id?.trim();
  if (!ca) {
    return "missing_client_account_id";
  }
  if (!phone.normalized_e164) {
    return phone.phone_skip_reason ?? "no_normalizable_phone_after_fallback_chain";
  }
  return null;
}
