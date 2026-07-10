export type NormalizedLeadIdentity = {
  phoneE164: string | null;
  email: string | null;
  state: string | null;
};

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFirst(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Read phone, email, and state from normalized intake payloads without mutating input.
 * Prefers top-level normalized fields when both flat and nested `contact` shapes exist.
 */
export function readNormalizedLeadIdentity(
  normalizedPayloadJson: unknown
): NormalizedLeadIdentity | null {
  const payload = asRecord(normalizedPayloadJson);
  if (!payload) return null;

  const contactRecord = asRecord(payload.contact);
  const contactPhone = contactRecord
    ? readFirst(contactRecord.phone_e164, contactRecord.phoneE164, contactRecord.phone)
    : null;
  const phoneE164 =
    readFirst(payload.phone_e164, payload.phoneE164, payload.phone) ?? contactPhone;

  const email = readFirst(payload.email) ?? (contactRecord ? readFirst(contactRecord.email) : null);

  const state =
    readFirst(payload.state, payload.stateCode) ??
    (contactRecord ? readFirst(contactRecord.state, contactRecord.stateCode) : null);

  return { phoneE164, email, state };
}
