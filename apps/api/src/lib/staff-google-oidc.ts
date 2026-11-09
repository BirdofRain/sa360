import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import { GOOGLE_ISSUER, GOOGLE_JWKS_URI, isStaffGoogleClientId } from "@sa360/shared/staff-google-oidc";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const GOOGLE_SUB_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;

export type VerifiedGoogleIdToken = {
  sub: string;
  email: string;
  emailVerified: true;
  nonce: string;
};

export type GoogleIdTokenFailure =
  | "invalid_token"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "incorrect_nonce"
  | "missing_email"
  | "unverified_email";

let remoteJwks: JWTVerifyGetKey | null = null;

export async function verifyStaffGoogleIdToken(input: {
  idToken: string;
  audience: string;
  nonce: string;
  nowSec?: number;
  getKey?: JWTVerifyGetKey;
}): Promise<{ ok: true; identity: VerifiedGoogleIdToken } | { ok: false; code: GoogleIdTokenFailure }> {
  if (!isStaffGoogleClientId(input.audience) || typeof input.idToken !== "string" || input.idToken.length > 8000) {
    return { ok: false, code: "invalid_token" };
  }
  const getKey = input.getKey ?? googleJwks();
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(input.idToken, getKey, {
      issuer: GOOGLE_ISSUER,
      audience: input.audience,
      clockTolerance: 30,
      currentDate: input.nowSec === undefined ? undefined : new Date(input.nowSec * 1000),
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    return { ok: false, code: classifyJwtError(error) };
  }
  if (typeof payload.azp === "string" && !fixedEqual(payload.azp, input.audience)) {
    return { ok: false, code: "wrong_audience" };
  }
  if (typeof payload.nonce !== "string" || !fixedEqual(payload.nonce, input.nonce)) {
    return { ok: false, code: "incorrect_nonce" };
  }
  if (typeof payload.sub !== "string" || !GOOGLE_SUB_PATTERN.test(payload.sub)) {
    return { ok: false, code: "invalid_token" };
  }
  if (typeof payload.email !== "string" || !EMAIL_PATTERN.test(payload.email)) {
    return { ok: false, code: "missing_email" };
  }
  if (payload.email_verified !== true) return { ok: false, code: "unverified_email" };
  return {
    ok: true,
    identity: { sub: payload.sub, email: payload.email, emailVerified: true, nonce: input.nonce },
  };
}

function googleJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  return remoteJwks;
}

function classifyJwtError(error: unknown): GoogleIdTokenFailure {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" || code === "ERR_JWT_EXPIRED") {
    const claim = error && typeof error === "object" && "claim" in error ? String(error.claim) : "";
    if (claim === "iss") return "wrong_issuer";
    if (claim === "aud") return "wrong_audience";
    if (claim === "exp" || claim === "nbf" || code === "ERR_JWT_EXPIRED") return "expired";
  }
  return "invalid_token";
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}
