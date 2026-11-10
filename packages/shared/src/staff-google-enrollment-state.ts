import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { STAFF_ENROLLMENT_SECRET_PATTERN } from "./staff-enrollment.js";
import { parseStaffGoogleEnrollRedirectUri } from "./staff-google-oidc.js";

/**
 * Signed browser state for staff enrollment. The invitation secret is sealed
 * inside the signed payload. A login state cookie uses a different prefix
 * and cannot satisfy this verifier.
 */

export const STAFF_ENROLLMENT_STATE_PREFIX = "se1";
export const STAFF_ENROLLMENT_STATE_COOKIE = "sa360_staff_google_enroll";
export const STAFF_ENROLLMENT_STATE_PATH = "/staff/google/enroll";
export const STAFF_ENROLLMENT_STATE_TTL_SECONDS = 10 * 60;
export const STAFF_ENROLLMENT_STATE_MAX_TOKEN_LENGTH = 3072;

const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const SEALED_GRANT_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,}$/;
const GRANT_AAD = Buffer.from("staff_google_enrollment", "utf8");
const CLAIM_KEYS = ["exp", "grant", "iat", "nonce", "redirectUri", "state", "typ", "v", "verifier"] as const;

export type StaffEnrollmentStateClaims = {
  v: 1;
  typ: "staff_google_enrollment";
  state: string;
  nonce: string;
  verifier: string;
  grant: string;
  redirectUri: string;
  iat: number;
  exp: number;
};

export type StaffEnrollmentStateFailure =
  | "secret_unavailable"
  | "missing_state"
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "csrf"
  | "redirect";

export function createStaffEnrollmentState(input: {
  redirectUri: string;
  grant: string;
  nowSec?: number;
  secret: string;
}): { token: string; claims: StaffEnrollmentStateClaims } {
  const secret = acceptableSecret(input.secret);
  if (!secret) throw new Error("secret_unavailable");
  if (!acceptableRedirect(input.redirectUri) || !STAFF_ENROLLMENT_SECRET_PATTERN.test(input.grant)) {
    throw new Error("malformed");
  }
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const claims: StaffEnrollmentStateClaims = {
    v: 1,
    typ: "staff_google_enrollment",
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    grant: sealGrant(input.grant, secret),
    redirectUri: input.redirectUri,
    iat: nowSec,
    exp: nowSec + STAFF_ENROLLMENT_STATE_TTL_SECONDS,
  };
  const json = canonical(claims);
  const signed = `${STAFF_ENROLLMENT_STATE_PREFIX}.${Buffer.from(json, "utf8").toString("base64url")}`;
  return {
    token: `${signed}.${signBytes(signed, secret)}`,
    claims: { ...claims, grant: input.grant },
  };
}

export function verifyStaffEnrollmentState(input: {
  token: string | undefined;
  queryState: string | undefined;
  redirectUri: string;
  nowSec?: number;
  secret: string;
}): { ok: true; claims: StaffEnrollmentStateClaims } | { ok: false; code: StaffEnrollmentStateFailure } {
  const secret = acceptableSecret(input.secret);
  if (!secret) return { ok: false, code: "secret_unavailable" };
  if (!input.token) return { ok: false, code: "missing_state" };
  const claims = readToken(input.token, secret);
  if (!claims) return { ok: false, code: claims === null ? "malformed" : "invalid_signature" };
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSec) return { ok: false, code: "expired" };
  if (!input.queryState || !fixedEqual(input.queryState, claims.state)) return { ok: false, code: "csrf" };
  if (input.redirectUri !== claims.redirectUri) return { ok: false, code: "redirect" };
  return { ok: true, claims };
}

function readToken(token: string, secret: string): StaffEnrollmentStateClaims | null | false {
  if (token.length === 0 || token.length > STAFF_ENROLLMENT_STATE_MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== STAFF_ENROLLMENT_STATE_PREFIX || !parts[1] || !parts[2]) return null;
  const signed = `${parts[0]}.${parts[1]}`;
  if (!fixedEqual(parts[2], signBytes(signed, secret))) return false;
  try {
    const body = Buffer.from(parts[1], "base64url");
    if (body.toString("base64url") !== parts[1]) return null;
    const json = body.toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== CLAIM_KEYS.length || keys.some((key, index) => key !== CLAIM_KEYS[index])) return null;
    if (canonical(record) !== json) return null;
    if (record.v !== 1 || record.typ !== "staff_google_enrollment") return null;
    if (
      typeof record.state !== "string" ||
      typeof record.nonce !== "string" ||
      typeof record.verifier !== "string" ||
      typeof record.grant !== "string" ||
      !OPAQUE_PATTERN.test(record.state) ||
      !OPAQUE_PATTERN.test(record.nonce) ||
      !OPAQUE_PATTERN.test(record.verifier) ||
      !SEALED_GRANT_PATTERN.test(record.grant)
    ) {
      return null;
    }
    const grant = openGrant(record.grant, secret);
    if (!grant) return null;
    if (typeof record.redirectUri !== "string" || !acceptableRedirect(record.redirectUri)) return null;
    if (!isTimestamp(record.iat) || !isTimestamp(record.exp) || record.exp !== record.iat + STAFF_ENROLLMENT_STATE_TTL_SECONDS) {
      return null;
    }
    return {
      v: 1,
      typ: "staff_google_enrollment",
      state: record.state,
      nonce: record.nonce,
      verifier: record.verifier,
      grant,
      redirectUri: record.redirectUri,
      iat: record.iat,
      exp: record.exp,
    };
  } catch {
    return null;
  }
}

function acceptableRedirect(value: string): boolean {
  return parseStaffGoogleEnrollRedirectUri(value) === value;
}

function acceptableSecret(value: string): string | null {
  if (value.length < 32 || /\s/u.test(value)) return null;
  return value;
}

function canonical(value: object): string {
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return JSON.stringify(sorted);
}

function sealGrant(grant: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", grantKey(secret), iv);
  cipher.setAAD(GRANT_AAD);
  const encrypted = Buffer.concat([cipher.update(grant, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function openGrant(sealed: string, secret: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const packed = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || packed.length <= 16 || parts[1] !== iv.toString("base64url") || parts[2] !== packed.toString("base64url")) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", grantKey(secret), iv);
    decipher.setAAD(GRANT_AAD);
    decipher.setAuthTag(packed.subarray(packed.length - 16));
    const grant = Buffer.concat([decipher.update(packed.subarray(0, packed.length - 16)), decipher.final()]).toString("utf8");
    return STAFF_ENROLLMENT_SECRET_PATTERN.test(grant) ? grant : null;
  } catch {
    return null;
  }
}

function grantKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("sa360-staff-enrollment-grant", "utf8"),
      Buffer.from("sa360-staff-enrollment-state-grant-v1", "utf8"),
      32
    )
  );
}

function signBytes(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4_000_000_000;
}
