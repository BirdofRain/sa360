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
