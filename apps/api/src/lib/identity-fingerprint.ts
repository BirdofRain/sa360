import { createHash } from "node:crypto";

/**
 * Deterministic one-way fingerprint for audit correlation without storing raw PII.
 * Uses unsalted SHA-256 of normalized identity values (same pattern as intake dedup helpers).
 */
export function fingerprintIdentityValue(kind: "phone" | "email", value: string): string {
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.trim();
  return createHash("sha256").update(`${kind}:${normalized}`).digest("hex");
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
