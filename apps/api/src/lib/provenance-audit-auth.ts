import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ADMIN_KEY_HEADER, getAdminApiKey } from "./admin-auth.js";

export const PROVENANCE_AUDIT_KEY_HEADER = "x-sa360-provenance-audit-key";
export const PROVENANCE_AUDIT_MIN_KEY_LENGTH = 16;

const UNSET_DIGEST_INPUT = "sa360-provenance-audit-credential-unset";

/** Exact `true` only. Every other value, including unset, keeps the route off. */
export function isProvenanceImpactAuditEnabled(): boolean {
  return process.env.SA360_PROVENANCE_AUDIT_ENABLED === "true";
}

export function getProvenanceAuditReadonlyKey(): string | undefined {
  const value = process.env.SA360_AUDIT_READONLY_KEY?.trim();
  return value || undefined;
}

/**
 * SHA-256 both sides so the comparison is fixed-length. `timingSafeEqual`
 * throws when buffer lengths differ, which would leak the secret's length.
 */
export function timingSafeTokenEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

export function credentialsMatch(provided: string, expected: string | undefined): boolean {
  const equal = timingSafeTokenEqual(provided, expected && expected.length > 0 ? expected : UNSET_DIGEST_INPUT);
  return Boolean(expected && expected.length > 0) && equal;
}

function configuredAdminKeys(): string[] {
  const keys = [process.env.ADMIN_API_KEY, process.env.SA360_ADMIN_KEY, getAdminApiKey()];
  const seen = new Set<string>();
  for (const key of keys) {
    const trimmed = key?.trim() ?? "";
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** The audit credential must not be a copy of an admin key. */
export function auditKeyIsDistinctFromAdminKeys(auditKey: string | undefined): boolean {
  if (!auditKey) {
    timingSafeTokenEqual(UNSET_DIGEST_INPUT, UNSET_DIGEST_INPUT);
    return false;
  }
  const adminKeys = configuredAdminKeys();
  if (adminKeys.length === 0) {
    timingSafeTokenEqual(auditKey, UNSET_DIGEST_INPUT);
    return true;
  }
  let distinct = true;
  for (const adminKey of adminKeys) {
    if (timingSafeTokenEqual(auditKey, adminKey)) distinct = false;
  }
  return distinct;
}

export function auditKeyIsUsable(auditKey: string | undefined): boolean {
  const longEnough = Boolean(auditKey && auditKey.length >= PROVENANCE_AUDIT_MIN_KEY_LENGTH);
  return longEnough && auditKeyIsDistinctFromAdminKeys(auditKey);
}

function headerValue(request: FastifyRequest, name: string): string {
  const raw = request.headers[name];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  return typeof provided === "string" ? provided.trim() : "";
}

/**
 * Admin C.O.C. key via `x-sa360-admin-key`, or the audit-only key via
 * `x-sa360-provenance-audit-key`. The audit key is not consulted by
 * `verifyAdminApiKey`, so it cannot authorize any other admin route.
 */
export async function authorizeProvenanceImpactAudit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const adminExpected = getAdminApiKey();
  const auditExpected = getProvenanceAuditReadonlyKey();
  const auditUsable = auditKeyIsUsable(auditExpected);
  const adminOk = credentialsMatch(headerValue(request, ADMIN_KEY_HEADER), adminExpected);
  const auditOk =
    auditUsable && credentialsMatch(headerValue(request, PROVENANCE_AUDIT_KEY_HEADER), auditExpected);

  if (adminOk || auditOk) return true;

  if (!adminExpected && !auditUsable) {
    await reply.status(503).send({
      ok: false,
      error: "Provenance audit credentials are not configured",
    });
    return false;
  }

  await reply.status(401).send({ ok: false, error: "Unauthorized" });
  return false;
}
