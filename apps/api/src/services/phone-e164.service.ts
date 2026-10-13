/** ITU-T E.164: optional +, country code + subscriber, max 15 digits total. */
const E164_VERIFIED = /^\+[1-9]\d{1,14}$/;

export function isVerifiedE164(normalized: string): boolean {
  return E164_VERIFIED.test(normalized);
}

export type StrictUsNanpFailureReason =
  | "phone_blank"
  | "phone_truncated"
  | "phone_overlong"
  | "phone_structurally_invalid";

/**
 * Strict US NANP for commercial aged Trucker/Veteran fulfillment.
 *
 * Does not pad, truncate, guess, or invent digits. A complete 10-digit
 * national number may receive the US country code `+1` (normalization).
 * Incomplete or overlong digit runs are rejected as-is.
 *
 * {@link normalizeToE164} stays best-effort and phone-optional for inbound
 * / voice / index workflows — do not replace those callers with this helper.
 */
export function tryNormalizeStrictUsNanpE164(
  raw: string | null | undefined
): { ok: true; e164: string } | { ok: false; reason: StrictUsNanpFailureReason } {
  if (raw == null) {
    return { ok: false, reason: "phone_blank" };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { ok: false, reason: "phone_blank" };
  }
  if (/e[+-]?\d+/i.test(trimmed)) {
    return { ok: false, reason: "phone_structurally_invalid" };
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return { ok: false, reason: "phone_blank" };
  }
  if (digits.length < 10) {
    return { ok: false, reason: "phone_truncated" };
  }
  if (digits.length === 10) {
    return nanpFromNational(digits);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return nanpFromNational(digits.slice(1));
  }
  return { ok: false, reason: "phone_overlong" };
}

function nanpFromNational(
  nsn: string
): { ok: true; e164: string } | { ok: false; reason: StrictUsNanpFailureReason } {
  const npa = nsn.slice(0, 3);
  const nxx = nsn.slice(3, 6);
  const line = nsn.slice(6);
  if (!isValidNanpNxx(npa) || !isValidNanpNxx(nxx) || !/^\d{4}$/.test(line)) {
    return { ok: false, reason: "phone_structurally_invalid" };
  }
  return { ok: true, e164: `+1${nsn}` };
}

/** N = 2–9, X = 0–9; N11 (x11) is not a geographic NPA/NXX. */
function isValidNanpNxx(part: string): boolean {
  return /^[2-9]\d{2}$/.test(part) && !/^[2-9]11$/.test(part);
}

/**
 * RFC4180 quoted CSV field. Quoting reduces numeric coercion on import; it does
 * not guarantee Excel treats the cell as text (locale, Text-to-Columns, and
 * opening a .csv vs Import Wizard still control type). XLSX writers must set
 * an explicit text cell type via {@link buyerPhoneSpreadsheetCell}.
 */
export type SpreadsheetTextCell = {
  type: "text";
  value: string;
};

/**
 * Canonical display value for buyer CSV/XLSX phone cells.
 * Valid US numbers are E.164; invalid raw input is left unchanged
 * so callers can fail closed rather than invent digits.
 */
export function formatBuyerPhoneSpreadsheetText(raw: string | null | undefined): string {
  const result = tryNormalizeStrictUsNanpE164(raw);
  if (result.ok) return result.e164;
  return raw == null ? "" : String(raw).trim();
}

export function buyerPhoneSpreadsheetCell(raw: string | null | undefined): SpreadsheetTextCell {
  return { type: "text", value: formatBuyerPhoneSpreadsheetText(raw) };
}

/** RFC4180-quoted phone field. Not an Excel text-format guarantee. */
export function csvEscapePhoneAsText(raw: string | null | undefined): string {
  const value = formatBuyerPhoneSpreadsheetText(raw);
  return `"${value.replace(/"/g, '""')}"`;
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
