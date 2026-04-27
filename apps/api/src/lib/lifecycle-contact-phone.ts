import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { normalizeToE164 } from "../services/phone-e164.service.js";

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
  normalized_e164: string;
  raw_source: ContactPhoneSource;
  raw_input: string;
} {
  const pick = pickRawContactPhoneFromContact(payload.contact);
  const normalized_e164 = normalizeToE164(pick.raw);
  return {
    normalized_e164,
    raw_source: pick.source,
    raw_input: pick.raw,
  };
}

/** Non-null reason string when inbound index upsert cannot run (excluding thrown DB errors). */
export function contactIndexUpsertSkippedReasonStatic(
  payload: LifecycleEventSchema,
  normalizedE164: string
): string | null {
  const ca = payload.client_account_id?.trim();
  if (!ca) {
    return "missing_client_account_id";
  }
  if (!normalizedE164) {
    return "no_normalizable_phone_after_fallback_chain";
  }
  return null;
}
