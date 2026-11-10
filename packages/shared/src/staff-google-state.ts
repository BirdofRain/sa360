import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { parseStaffGoogleRedirectUri } from "./staff-google-oidc.js";

/**
 * One-time browser state for the Google staff authorization-code flow.
 * Signed with the staff session secret and a distinct prefix, so a session
 * token cannot be presented as OAuth state. Server code only.
 */

export const STAFF_GOOGLE_STATE_PREFIX = "sg1";
export const STAFF_GOOGLE_STATE_COOKIE = "sa360_staff_google_state";
export const STAFF_GOOGLE_STATE_TTL_SECONDS = 10 * 60;
export const STAFF_GOOGLE_STATE_MAX_TOKEN_LENGTH = 2048;

const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CLAIM_KEYS = ["exp", "iat", "nonce", "redirectUri", "state", "typ", "v", "verifier"] as const;

export type StaffGoogleStateClaims = {
  v: 1;
  typ: "staff_google_state";
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  iat: number;
  exp: number;
};

export type StaffGoogleStateFailure =
  | "secret_unavailable"
  | "missing_state"
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "csrf"
  | "reused_state"
  | "redirect";

const consumed = new Map<string, number>();

export function resetStaffGoogleStateConsumptionForTests(): void {
  consumed.clear();
}

export function createStaffGoogleState(input: {
  redirectUri: string;
  nowSec?: number;
  secret: string;
}): { token: string; claims: StaffGoogleStateClaims } {
  const secret = acceptableSecret(input.secret);
  if (!secret) throw new Error("secret_unavailable");
  if (!acceptableRedirect(input.redirectUri)) throw new Error("malformed");
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const claims: StaffGoogleStateClaims = {
    v: 1,
    typ: "staff_google_state",
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    redirectUri: input.redirectUri,
    iat: nowSec,
    exp: nowSec + STAFF_GOOGLE_STATE_TTL_SECONDS,
  };
  const json = canonical(claims);
  const signed = `${STAFF_GOOGLE_STATE_PREFIX}.${Buffer.from(json, "utf8").toString("base64url")}`;
  return { token: `${signed}.${signBytes(signed, secret)}`, claims: { ...claims } };
}

export function consumeStaffGoogleState(input: {
  token: string | undefined;
  queryState: string | undefined;
  redirectUri: string;
  nowSec?: number;
  secret: string;
}): { ok: true; claims: StaffGoogleStateClaims } | { ok: false; code: StaffGoogleStateFailure } {
  const secret = acceptableSecret(input.secret);
  if (!secret) return { ok: false, code: "secret_unavailable" };
  if (!input.token) return { ok: false, code: "missing_state" };
  const claims = readToken(input.token, secret);
  if (!claims) return { ok: false, code: claims === null ? "malformed" : "invalid_signature" };
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSec) return { ok: false, code: "expired" };
  const key = createHash("sha256").update(claims.state, "utf8").digest("base64url");
  pruneConsumed(nowSec);
  const seenUntil = consumed.get(key);
  if (seenUntil !== undefined && seenUntil > nowSec) return { ok: false, code: "reused_state" };
  consumed.set(key, claims.exp);
  if (!input.queryState || !fixedEqual(input.queryState, claims.state)) return { ok: false, code: "csrf" };
  if (input.redirectUri !== claims.redirectUri) return { ok: false, code: "redirect" };
  return { ok: true, claims };
}

function readToken(token: string, secret: string): StaffGoogleStateClaims | null | false {
  if (token.length === 0 || token.length > STAFF_GOOGLE_STATE_MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== STAFF_GOOGLE_STATE_PREFIX || !parts[1] || !parts[2]) return null;
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
    if (record.v !== 1 || record.typ !== "staff_google_state") return null;
    if (
      typeof record.state !== "string" ||
      typeof record.nonce !== "string" ||
      typeof record.verifier !== "string" ||
      !OPAQUE_PATTERN.test(record.state) ||
      !OPAQUE_PATTERN.test(record.nonce) ||
      !OPAQUE_PATTERN.test(record.verifier)
    ) {
      return null;
    }
    if (typeof record.redirectUri !== "string" || !acceptableRedirect(record.redirectUri)) return null;
    if (!isTimestamp(record.iat) || !isTimestamp(record.exp) || record.exp !== record.iat + STAFF_GOOGLE_STATE_TTL_SECONDS) {
      return null;
    }
    return {
      v: 1,
      typ: "staff_google_state",
      state: record.state,
      nonce: record.nonce,
      verifier: record.verifier,
      redirectUri: record.redirectUri,
      iat: record.iat,
      exp: record.exp,
    };
  } catch {
    return null;
  }
}

function acceptableRedirect(value: string): boolean {
  return parseStaffGoogleRedirectUri(value) === value;
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

function pruneConsumed(nowSec: number): void {
  if (consumed.size < 500) return;
  for (const [key, exp] of consumed) {
    if (exp <= nowSec) consumed.delete(key);
  }
}
