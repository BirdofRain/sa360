import { createVerify, verify as verifyAsymmetric } from "node:crypto";

/**
 * HighLevel marketplace webhook verification.
 *
 * Source: https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/
 * - Prefer `X-GHL-Signature` (Ed25519).
 * - Fallback to legacy `X-WH-Signature` (RSA-SHA256) during migration.
 */
const GHL_ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const GHL_LEGACY_RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSCFrm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfBcsedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpvuxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKUJ062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXpIocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzNh/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhCHULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJPQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAykT1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function normalizeSignature(headerValue?: string): string | null {
  const value = headerValue?.trim();
  if (!value || value === "N/A") return null;
  return value;
}

function verifyGhlEd25519(rawBody: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const payloadBuffer = Buffer.from(rawBody, "utf8");
    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    return verifyAsymmetric(null, payloadBuffer, publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

function verifyLegacyRsa(rawBody: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify("SHA256");
    verifier.update(rawBody, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, "base64");
  } catch {
    return false;
  }
}

export type GhlMarketplaceWebhookSignatureResult =
  | { ok: true; scheme: "ghl_ed25519" | "legacy_rsa" }
  | { ok: false; reason: "no_signature" | "invalid_signature" };

export function verifyGhlMarketplaceWebhookSignature(input: {
  rawBody: string;
  ghlSignatureHeader?: string;
  legacySignatureHeader?: string;
  ghlPublicKeyPem?: string;
  legacyPublicKeyPem?: string;
}): GhlMarketplaceWebhookSignatureResult {
  const ghlSignature = normalizeSignature(input.ghlSignatureHeader);
  const legacySignature = normalizeSignature(input.legacySignatureHeader);

  if (ghlSignature) {
    const ok = verifyGhlEd25519(
      input.rawBody,
      ghlSignature,
      input.ghlPublicKeyPem ?? GHL_ED25519_PUBLIC_KEY_PEM
    );
    return ok
      ? { ok: true, scheme: "ghl_ed25519" }
      : { ok: false, reason: "invalid_signature" };
  }

  if (legacySignature) {
    const ok = verifyLegacyRsa(
      input.rawBody,
      legacySignature,
      input.legacyPublicKeyPem ?? GHL_LEGACY_RSA_PUBLIC_KEY_PEM
    );
    return ok
      ? { ok: true, scheme: "legacy_rsa" }
      : { ok: false, reason: "invalid_signature" };
  }

  return { ok: false, reason: "no_signature" };
}
