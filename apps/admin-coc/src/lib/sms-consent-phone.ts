/**
 * Team Workspace SMS confirmation input.
 *
 * A US number may be typed without a country code. Any other number must
 * already include an explicit country code. This does not guess a non-US
 * code, and it does not replace the strict E.164 checks in persistence or
 * Twilio. Area and exchange rules match `tryNormalizeStrictUsNanpE164`.
 */

const API_E164 = /^\+[1-9]\d{7,14}$/;
const EXTENSION = /(?:ext\.?|extension|\bx\s*\d|#)/i;

export type SmsConsentPhoneFailure = "blank" | "malformed" | "ambiguous" | "invalid";

export type SmsConsentPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: SmsConsentPhoneFailure };

export function tryNormalizeSmsConsentPhone(raw: string): SmsConsentPhoneResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "blank" };
  if (EXTENSION.test(trimmed) || /[a-z]/i.test(trimmed)) return { ok: false, reason: "malformed" };
  if (/[^\d\s().+\-]/.test(trimmed)) return { ok: false, reason: "malformed" };
  const pluses = trimmed.match(/\+/g)?.length ?? 0;
  if (pluses > 1 || (pluses === 1 && !trimmed.startsWith("+"))) return { ok: false, reason: "malformed" };

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "blank" };

  if (trimmed.startsWith("+")) {
    const e164 = `+${digits}`;
    if (!API_E164.test(e164)) return { ok: false, reason: "invalid" };
    if (digits.startsWith("1")) {
      if (digits.length !== 11) return { ok: false, reason: "invalid" };
      return fromNanpNational(digits.slice(1));
    }
    return { ok: true, e164 };
  }

  if (digits.length === 10) return fromNanpNational(digits);
  if (digits.length === 11 && digits.startsWith("1")) return fromNanpNational(digits.slice(1));
  if (digits.length >= 11) return { ok: false, reason: "ambiguous" };
  return { ok: false, reason: "invalid" };
}

function fromNanpNational(nsn: string): SmsConsentPhoneResult {
  const npa = nsn.slice(0, 3);
  const nxx = nsn.slice(3, 6);
  const line = nsn.slice(6);
  if (!isValidNanpNxx(npa) || !isValidNanpNxx(nxx) || !/^\d{4}$/.test(line)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, e164: `+1${nsn}` };
}

/** N = 2–9, X = 0–9; N11 is not a geographic area or exchange. */
function isValidNanpNxx(part: string): boolean {
  return /^[2-9]\d{2}$/.test(part) && !/^[2-9]11$/.test(part);
}
