import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pure staff assertion. Server-only.
 * Import this module from a server runtime. Do not import it from a browser
 * component, and do not pass the signing secret through a client prop.
 * The secret is read only with bracket access so a client bundle cannot
 * inline it. This module does not read any other credential.
 */

export const STAFF_ASSERTION_VERSION = 1 as const;
export const STAFF_ASSERTION_TOKEN_PREFIX = "sa1";
export const STAFF_ASSERTION_ISSUER = "SA360 Admin C.O.C.";
export const STAFF_ASSERTION_AUDIENCE = "SA360 API staff authorization";
export const STAFF_ASSERTION_PURPOSE = "staff_authentication";
export const STAFF_ASSERTION_TTL_SECONDS = 60;
export const STAFF_ASSERTION_MAX_FUTURE_SKEW_SECONDS = 30;
export const STAFF_ASSERTION_SECRET_ENV = "SA360_STAFF_ASSERTION_SECRET";
export const STAFF_ASSERTION_SECRET_MIN_LENGTH = 32;
export const STAFF_ASSERTION_HEADER = "x-sa360-staff-assertion";
export const STAFF_ASSERTION_MAX_TOKEN_LENGTH = 1024;

const SUBJECT_PATTERN = /^c[a-z0-9]{24}$/;
const ASSERTION_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const CLAIM_KEYS = ["aud", "exp", "iat", "iss", "jti", "purpose", "sub", "v"] as const;
const MAX_TIMESTAMP = 4_000_000_000;

export const STAFF_ASSERTION_FAILURES = [
  "secret_unavailable",
  "malformed",
  "not_canonical",
  "invalid_signature",
  "unexpected_field",
  "missing_field",
  "unsupported_version",
  "wrong_issuer",
  "wrong_audience",
  "wrong_purpose",
  "missing_subject",
  "invalid_subject",
  "missing_assertion_id",
  "invalid_assertion_id",
  "expired",
  "issued_in_future",
  "principal_mismatch",
] as const;

export type StaffAssertionFailure = (typeof STAFF_ASSERTION_FAILURES)[number];

export type StaffAssertionClaims = {
  v: typeof STAFF_ASSERTION_VERSION;
  iss: typeof STAFF_ASSERTION_ISSUER;
  aud: typeof STAFF_ASSERTION_AUDIENCE;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  purpose: typeof STAFF_ASSERTION_PURPOSE;
};

export type StaffAssertionVerification =
  | { ok: true; claims: StaffAssertionClaims }
  | { ok: false; code: StaffAssertionFailure };

export class StaffAssertionError extends Error {
  constructor(readonly code: "secret_unavailable" | "malformed") {
    super(code);
    this.name = "StaffAssertionError";
  }
}

export function canonicalStaffAssertionJson(value: object): string {
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = record[key];
  }
  return JSON.stringify(sorted);
}

export function readStaffAssertionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = acceptableSecret(env[STAFF_ASSERTION_SECRET_ENV]);
  if (!secret) throw new StaffAssertionError("secret_unavailable");
  return secret;
}

export function signStaffAssertion(input: {
  staffPrincipalId: string;
  assertionId?: string;
  nowSec?: number;
  secret?: string;
  env?: NodeJS.ProcessEnv;
}): { token: string; claims: StaffAssertionClaims } {
  const secret = resolveSecret(input.secret, input.env);
  if (!secret) throw new StaffAssertionError("secret_unavailable");
  if (!isStaffPrincipalId(input.staffPrincipalId)) throw new StaffAssertionError("malformed");
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (!isTimestamp(nowSec)) throw new StaffAssertionError("malformed");
  const assertionId = input.assertionId ?? randomBytes(18).toString("base64url");
  if (!isAssertionId(assertionId)) throw new StaffAssertionError("malformed");

  const claims: StaffAssertionClaims = {
    v: STAFF_ASSERTION_VERSION,
    iss: STAFF_ASSERTION_ISSUER,
    aud: STAFF_ASSERTION_AUDIENCE,
    sub: input.staffPrincipalId,
    iat: nowSec,
    exp: nowSec + STAFF_ASSERTION_TTL_SECONDS,
    jti: assertionId,
    purpose: STAFF_ASSERTION_PURPOSE,
  };
  return { token: seal(claims, secret), claims: { ...claims } };
}

export function verifyStaffAssertion(
  token: string,
  input: {
    secret?: string;
    env?: NodeJS.ProcessEnv;
    nowSec?: number;
    staffPrincipalId?: string;
  } = {}
): StaffAssertionVerification {
  const secret = resolveSecret(input.secret, input.env);
  if (!secret) return { ok: false, code: "secret_unavailable" };
  if (typeof token !== "string" || token.length === 0 || token.length > STAFF_ASSERTION_MAX_TOKEN_LENGTH) {
    return { ok: false, code: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== STAFF_ASSERTION_TOKEN_PREFIX || !parts[1] || !parts[2]) {
    return { ok: false, code: "malformed" };
  }
  const signed = `${parts[0]}.${parts[1]}`;
  if (!fixedEqual(parts[2], signBytes(signed, secret))) return { ok: false, code: "invalid_signature" };

  let parsed: unknown;
  let json: string;
  try {
    const body = Buffer.from(parts[1], "base64url");
    if (body.toString("base64url") !== parts[1]) return { ok: false, code: "malformed" };
    json = body.toString("utf8");
    parsed = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, code: "malformed" };
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
  const extra = keys.filter((key) => !CLAIM_KEYS.includes(key as (typeof CLAIM_KEYS)[number]));
  if (extra.length > 0) return { ok: false, code: "unexpected_field" };
  if (!keys.includes("sub")) return { ok: false, code: "missing_subject" };
  if (!keys.includes("jti")) return { ok: false, code: "missing_assertion_id" };
  if (keys.length !== CLAIM_KEYS.length) return { ok: false, code: "missing_field" };
  if (canonicalStaffAssertionJson(record) !== json) return { ok: false, code: "not_canonical" };

  if (record.v !== STAFF_ASSERTION_VERSION) return { ok: false, code: "unsupported_version" };
  if (record.iss !== STAFF_ASSERTION_ISSUER) return { ok: false, code: "wrong_issuer" };
  if (record.aud !== STAFF_ASSERTION_AUDIENCE) return { ok: false, code: "wrong_audience" };
  if (record.purpose !== STAFF_ASSERTION_PURPOSE) return { ok: false, code: "wrong_purpose" };
  if (typeof record.sub !== "string") return { ok: false, code: "invalid_subject" };
  if (!isStaffPrincipalId(record.sub)) return { ok: false, code: "invalid_subject" };
  if (typeof record.jti !== "string") return { ok: false, code: "invalid_assertion_id" };
  if (!isAssertionId(record.jti)) return { ok: false, code: "invalid_assertion_id" };
  if (!isTimestamp(record.iat) || !isTimestamp(record.exp)) return { ok: false, code: "malformed" };
  if (record.exp !== record.iat + STAFF_ASSERTION_TTL_SECONDS) return { ok: false, code: "malformed" };

  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (!isTimestamp(nowSec)) return { ok: false, code: "malformed" };
  if (record.iat > nowSec + STAFF_ASSERTION_MAX_FUTURE_SKEW_SECONDS) {
    return { ok: false, code: "issued_in_future" };
  }
  if (record.exp <= nowSec) return { ok: false, code: "expired" };
  if (input.staffPrincipalId !== undefined && input.staffPrincipalId !== record.sub) {
    return { ok: false, code: "principal_mismatch" };
  }

  return {
    ok: true,
    claims: {
      v: STAFF_ASSERTION_VERSION,
      iss: STAFF_ASSERTION_ISSUER,
      aud: STAFF_ASSERTION_AUDIENCE,
      sub: record.sub,
      iat: record.iat,
      exp: record.exp,
      jti: record.jti,
      purpose: STAFF_ASSERTION_PURPOSE,
    },
  };
}

function seal(claims: StaffAssertionClaims, secret: string): string {
  const json = canonicalStaffAssertionJson(claims);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const signed = `${STAFF_ASSERTION_TOKEN_PREFIX}.${body}`;
  return `${signed}.${signBytes(signed, secret)}`;
}

function signBytes(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

function resolveSecret(secret: string | undefined, env: NodeJS.ProcessEnv | undefined): string | null {
  if (secret !== undefined) return acceptableSecret(secret);
  return acceptableSecret((env ?? process.env)[STAFF_ASSERTION_SECRET_ENV]);
}

function acceptableSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < STAFF_ASSERTION_SECRET_MIN_LENGTH || /\s/u.test(value)) return null;
  return value;
}

function isStaffPrincipalId(value: string): boolean {
  return SUBJECT_PATTERN.test(value);
}

function isAssertionId(value: string): boolean {
  return ASSERTION_ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;
}
