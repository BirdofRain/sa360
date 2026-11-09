import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Browser session for a StaffPrincipal. This is not the shared-password ac1
 * cookie and it is not a staff assertion. Server code only.
 */

export const STAFF_SESSION_VERSION = 1 as const;
export const STAFF_SESSION_TOKEN_PREFIX = "sf1";
export const STAFF_SESSION_TYP = "staff";
export const STAFF_SESSION_COOKIE = "sa360_staff_session";
export const STAFF_SESSION_HEADER = "x-sa360-staff-session";
export const STAFF_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const STAFF_SESSION_SECRET_ENV = "SA360_STAFF_SESSION_SECRET";
export const STAFF_SESSION_SECRET_MIN_LENGTH = 32;
export const STAFF_SESSION_MAX_TOKEN_LENGTH = 2048;

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;
const GOOGLE_SUB_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const CLAIM_KEYS = ["exp", "googleSub", "iat", "jti", "sub", "typ", "v"] as const;

export type StaffSessionClaims = {
  v: typeof STAFF_SESSION_VERSION;
  typ: typeof STAFF_SESSION_TYP;
  sub: string;
  googleSub: string;
  iat: number;
  exp: number;
  jti: string;
};

export type StaffSessionFailure =
  | "secret_unavailable"
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "unsupported";

export type StaffSessionVerification =
  | { ok: true; claims: StaffSessionClaims }
  | { ok: false; code: StaffSessionFailure };

export class StaffSessionError extends Error {
  constructor(readonly code: "secret_unavailable" | "malformed") {
    super(code);
    this.name = "StaffSessionError";
  }
}

export function readStaffSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = acceptableSecret(env[STAFF_SESSION_SECRET_ENV]);
  if (!secret) throw new StaffSessionError("secret_unavailable");
  return secret;
}

export function signStaffSession(input: {
  staffPrincipalId: string;
  googleSub: string;
  nowSec?: number;
  sessionId?: string;
  secret?: string;
  env?: NodeJS.ProcessEnv;
}): { token: string; claims: StaffSessionClaims } {
  const secret = resolveSecret(input.secret, input.env);
  if (!secret) throw new StaffSessionError("secret_unavailable");
  if (!PRINCIPAL_ID_PATTERN.test(input.staffPrincipalId) || !GOOGLE_SUB_PATTERN.test(input.googleSub)) {
    throw new StaffSessionError("malformed");
  }
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (!isTimestamp(nowSec)) throw new StaffSessionError("malformed");
  const sessionId = input.sessionId ?? randomBytes(18).toString("base64url");
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new StaffSessionError("malformed");
  const claims: StaffSessionClaims = {
    v: STAFF_SESSION_VERSION,
    typ: STAFF_SESSION_TYP,
    sub: input.staffPrincipalId,
    googleSub: input.googleSub,
    iat: nowSec,
    exp: nowSec + STAFF_SESSION_TTL_SECONDS,
    jti: sessionId,
  };
  const json = canonical(claims);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const signed = `${STAFF_SESSION_TOKEN_PREFIX}.${body}`;
  return { token: `${signed}.${signBytes(signed, secret)}`, claims: { ...claims } };
}

export function verifyStaffSession(
  token: string,
  input: { secret?: string; env?: NodeJS.ProcessEnv; nowSec?: number } = {}
): StaffSessionVerification {
  const secret = resolveSecret(input.secret, input.env);
  if (!secret) return { ok: false, code: "secret_unavailable" };
  if (typeof token !== "string" || token.length === 0 || token.length > STAFF_SESSION_MAX_TOKEN_LENGTH) {
    return { ok: false, code: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== STAFF_SESSION_TOKEN_PREFIX || !parts[1] || !parts[2]) {
    return { ok: false, code: "malformed" };
  }
  const signed = `${parts[0]}.${parts[1]}`;
  if (!fixedEqual(parts[2], signBytes(signed, secret))) return { ok: false, code: "invalid_signature" };
  let record: Record<string, unknown>;
  let json: string;
  try {
    const body = Buffer.from(parts[1], "base64url");
    if (body.toString("base64url") !== parts[1]) return { ok: false, code: "malformed" };
    json = body.toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, code: "malformed" };
    record = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, code: "malformed" };
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== CLAIM_KEYS.length || keys.some((key, index) => key !== CLAIM_KEYS[index])) {
    return { ok: false, code: "unsupported" };
  }
  if (canonical(record) !== json) return { ok: false, code: "malformed" };
  if (record.v !== STAFF_SESSION_VERSION || record.typ !== STAFF_SESSION_TYP) {
    return { ok: false, code: "unsupported" };
  }
  if (typeof record.sub !== "string" || !PRINCIPAL_ID_PATTERN.test(record.sub)) {
    return { ok: false, code: "malformed" };
  }
  if (typeof record.googleSub !== "string" || !GOOGLE_SUB_PATTERN.test(record.googleSub)) {
    return { ok: false, code: "malformed" };
  }
  if (typeof record.jti !== "string" || !SESSION_ID_PATTERN.test(record.jti)) {
    return { ok: false, code: "malformed" };
  }
  if (!isTimestamp(record.iat) || !isTimestamp(record.exp)) return { ok: false, code: "malformed" };
  if (record.exp !== record.iat + STAFF_SESSION_TTL_SECONDS) return { ok: false, code: "malformed" };
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (!isTimestamp(nowSec)) return { ok: false, code: "malformed" };
  if (record.iat > nowSec + 60) return { ok: false, code: "malformed" };
  if (record.exp <= nowSec) return { ok: false, code: "expired" };
  return {
    ok: true,
    claims: {
      v: STAFF_SESSION_VERSION,
      typ: STAFF_SESSION_TYP,
      sub: record.sub,
      googleSub: record.googleSub,
      iat: record.iat,
      exp: record.exp,
      jti: record.jti,
    },
  };
}

export function staffSessionCookie(token: string, secure: boolean): {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    name: STAFF_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: STAFF_SESSION_TTL_SECONDS,
  };
}

export function staffSessionClearCookie(secure: boolean): {
  name: string;
  value: "";
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: 0;
} {
  return {
    name: STAFF_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  };
}

function canonical(value: object): string {
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return JSON.stringify(sorted);
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
  return acceptableSecret((env ?? process.env)[STAFF_SESSION_SECRET_ENV]);
}

function acceptableSecret(value: unknown): string | null {
  if (typeof value !== "string" || value.length < STAFF_SESSION_SECRET_MIN_LENGTH || /\s/u.test(value)) {
    return null;
  }
  return value;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4_000_000_000;
}
