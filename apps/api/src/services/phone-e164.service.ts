/** ITU-T E.164: optional +, country code + subscriber, max 15 digits total. */
const E164_VERIFIED = /^\+[1-9]\d{1,14}$/;

export function isVerifiedE164(normalized: string): boolean {
  return E164_VERIFIED.test(normalized);
}

/**
 * Applies {@link normalizeToE164} then accepts only strings that pass E.164 validation.
 * Used before InboundContactIndex writes so Prisma never sees pseudo-values like "(731)".
 */
export function tryNormalizeToVerifiedE164(
  raw: string
): { ok: true; e164: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_raw_phone" };
  }
  const candidate = normalizeToE164(trimmed);
  if (!candidate || !isVerifiedE164(candidate)) {
    return { ok: false, reason: "not_valid_e164_after_normalize" };
  }
  return { ok: true, e164: candidate };
}

/**
 * Best-effort E.164-style normalization without external lib.
 * Handles common US 10/11-digit inputs and preserves leading + digit runs.
 */
export function normalizeToE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return hadPlus ? "+" : trimmed;
  }

  if (hadPlus) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return trimmed;
}
