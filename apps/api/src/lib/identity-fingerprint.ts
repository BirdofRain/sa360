import { createHash } from "node:crypto";

import { tryNormalizeToVerifiedE164 } from "../services/phone-e164.service.js";

/**
 * Deterministic one-way fingerprint for audit correlation without storing raw PII.
 * Uses unsalted SHA-256 of normalized identity values (same pattern as intake dedup helpers).
 *
 * Phone writes should go through {@link fingerprintPhoneIdentity} so 10-digit,
 * 11-digit, and +1 E.164 forms of the same US number share one hash. Lookups
 * should use {@link phoneFingerprintLookupSet} so historical raw-trim hashes
 * still match.
 */
export function fingerprintIdentityValue(kind: "phone" | "email", value: string): string {
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.trim();
  return createHash("sha256").update(`${kind}:${normalized}`).digest("hex");
}

/** Canonical E.164 when loose inbound normalize succeeds; otherwise trimmed raw. */
export function canonicalizePhoneForFingerprint(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const verified = tryNormalizeToVerifiedE164(trimmed);
  return verified.ok ? verified.e164 : trimmed;
}

/** Write-side phone fingerprint. Same number as 10 / 11 / +1 digits → one hash. */
export function fingerprintPhoneIdentity(raw: string | null | undefined): string | null {
  const canonical = canonicalizePhoneForFingerprint(raw);
  return canonical ? fingerprintIdentityValue("phone", canonical) : null;
}

/**
 * Read-side candidates so 10-digit, 11-digit, and +1 E.164 forms collide, and
 * so already-recorded BuyerDeliveredIdentity hashes (raw-trim of whatever
 * phoneE164 was stored) still compare.
 */
export function phoneFingerprintLookupSet(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  const fingerprints = new Set<string>();
  fingerprints.add(fingerprintIdentityValue("phone", trimmed));
  const verified = tryNormalizeToVerifiedE164(trimmed);
  if (verified.ok) {
    fingerprints.add(fingerprintIdentityValue("phone", verified.e164));
    const digits = verified.e164.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      fingerprints.add(fingerprintIdentityValue("phone", digits));
      fingerprints.add(fingerprintIdentityValue("phone", digits.slice(1)));
      fingerprints.add(fingerprintIdentityValue("phone", `+${digits}`));
    }
  }
  return [...fingerprints];
}

export function anyPhoneFingerprintHit(
  lookups: readonly string[],
  ...sets: Array<Iterable<string>>
): boolean {
  if (lookups.length === 0) return false;
  return lookups.some((fingerprint) =>
    sets.some((set) => (set instanceof Set ? set.has(fingerprint) : new Set(set).has(fingerprint)))
  );
}

export function phoneFingerprintMatchesSeen(
  raw: string | null | undefined,
  seen: Iterable<string>
): boolean {
  const seenSet = seen instanceof Set ? seen : new Set(seen);
  return phoneFingerprintLookupSet(raw).some((fingerprint) => seenSet.has(fingerprint));
}

export function fingerprintLeadUid(value: string): string {
  return createHash("sha256").update(`lead_uid:${value.trim()}`).digest("hex");
}

export function maskSourceLeadUidForAudit(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const uid = value.trim();
  if (uid.length <= 6) return `${uid.slice(0, 1)}***`;
  return `${uid.slice(0, 4)}***${uid.slice(-4)}`;
}
