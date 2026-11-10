import {
  exchangeStaffGoogleCode,
  readStaffApiOrigin,
  readStaffGoogleBrowserConfig,
  staffGoogleAuthorizeUrl,
  staffGoogleCodeChallenge,
} from "@sa360/shared/staff-google-oidc";
import {
  STAFF_SESSION_COOKIE,
  STAFF_SESSION_HEADER,
  STAFF_SESSION_TTL_SECONDS,
  readStaffSessionSecret,
  signStaffSession,
  staffSessionClearCookie,
  verifyStaffSession,
} from "@sa360/shared/staff-google-session";
import {
  STAFF_GOOGLE_STATE_COOKIE,
  STAFF_GOOGLE_STATE_TTL_SECONDS,
  createStaffGoogleState,
  staffGoogleStateReplayId,
  verifyStaffGoogleState,
} from "@sa360/shared/staff-google-state";
import { readStaffGoogleServiceSecret, STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";

const PRINCIPAL_ID_PATTERN = /^c[a-z0-9]{24}$/;
const GOOGLE_SUB_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;

export type StaffGoogleResolution =
  | { ok: true; staffPrincipalId: string; googleSub: string }
  | { ok: false };

export type StaffCallbackOutcome =
  | { kind: "unavailable" }
  | { kind: "denied"; reason: string }
  | { kind: "signed_in"; sessionToken: string; staffPrincipalId: string };

type FetchLike = typeof fetch;

function sessionSecret(env: NodeJS.ProcessEnv): string | null {
  try {
    return readStaffSessionSecret(env);
  } catch {
    return null;
  }
}

function secureCookie(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

export function startStaffGoogleSignIn(input: {
  env: NodeJS.ProcessEnv;
  nowSec?: number;
}):
  | { kind: "unavailable" }
  | {
      kind: "redirect";
      location: string;
      stateCookie: { name: string; value: string; httpOnly: true; sameSite: "lax"; secure: boolean; path: string; maxAge: number };
    } {
  const config = readStaffGoogleBrowserConfig(input.env);
  const secret = sessionSecret(input.env);
  if (!config || !secret || !readStaffGoogleServiceSecret(input.env)) return { kind: "unavailable" };
  const created = createStaffGoogleState({ redirectUri: config.redirectUri, nowSec: input.nowSec, secret });
  const location = staffGoogleAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state: created.claims.state,
    nonce: created.claims.nonce,
    codeChallenge: staffGoogleCodeChallenge(created.claims.verifier),
  });
  const google = new URL(location);
  if (google.origin !== "https://accounts.google.com") return { kind: "unavailable" };
  return {
    kind: "redirect",
    location,
    stateCookie: {
      name: STAFF_GOOGLE_STATE_COOKIE,
      value: created.token,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie(input.env),
      path: "/staff/google",
      maxAge: STAFF_GOOGLE_STATE_TTL_SECONDS,
    },
  };
}

export async function completeStaffGoogleCallback(input: {
  env: NodeJS.ProcessEnv;
  code: string | undefined;
  queryState: string | undefined;
  stateCookie: string | undefined;
  nowSec?: number;
  fetchImpl?: FetchLike;
  exchange?: typeof exchangeStaffGoogleCode;
  resolve?: (value: { idToken: string; nonce: string }) => Promise<StaffGoogleResolution>;
  claimState?: (replayId: string) => Promise<{ ok: true } | { ok: false; code: "reused_state" | "state_unavailable" }>;
}): Promise<StaffCallbackOutcome> {
  const config = readStaffGoogleBrowserConfig(input.env);
  const secret = sessionSecret(input.env);
  const service = readStaffGoogleServiceSecret(input.env);
  const origin = readStaffApiOrigin(input.env.SA360_API_INTERNAL_URL ?? input.env.NEXT_PUBLIC_SA360_API_BASE_URL);
  if (!config || !secret || !service || (!input.claimState && !origin) || (!input.resolve && !origin)) {
    return { kind: "unavailable" };
  }
  const verified = verifyStaffGoogleState({
    token: input.stateCookie,
    queryState: input.queryState,
    redirectUri: config.redirectUri,
    nowSec: input.nowSec,
    secret,
  });
  if (!verified.ok) return { kind: "denied", reason: verified.code };
  if (!input.code) return { kind: "denied", reason: "exchange_failed" };
  const claim = input.claimState ?? ((replayId) => claimStateWithApi(origin as string, replayId, input.env, input.fetchImpl));
  let claimed: { ok: true } | { ok: false; code: "reused_state" | "state_unavailable" };
  try {
    claimed = await claim(staffGoogleStateReplayId(verified.claims.state));
  } catch {
    return { kind: "denied", reason: "state_unavailable" };
  }
  if (!claimed.ok) return { kind: "denied", reason: claimed.code };
  const exchange = input.exchange ?? exchangeStaffGoogleCode;
  let exchanged: { ok: true; idToken: string } | { ok: false; code: "exchange_failed" };
  try {
    exchanged = await exchange({
      code: input.code,
      verifier: verified.claims.verifier,
      config,
      fetchImpl: input.fetchImpl,
    });
  } catch {
    return { kind: "denied", reason: "exchange_failed" };
  }
  if (!exchanged.ok) return { kind: "denied", reason: "exchange_failed" };
  const resolve = input.resolve ?? ((value) => resolveWithApi(origin as string, value, input.env, input.fetchImpl));
  let resolved: StaffGoogleResolution;
  try {
    resolved = await resolve({ idToken: exchanged.idToken, nonce: verified.claims.nonce });
  } catch {
    return { kind: "denied", reason: "resolve_failed" };
  }
  if (!resolved.ok) return { kind: "denied", reason: "denied" };
  if (!PRINCIPAL_ID_PATTERN.test(resolved.staffPrincipalId) || !GOOGLE_SUB_PATTERN.test(resolved.googleSub)) {
    return { kind: "denied", reason: "denied" };
  }
  const session = signStaffSession({
    staffPrincipalId: resolved.staffPrincipalId,
    googleSub: resolved.googleSub,
    nowSec: input.nowSec,
    secret,
  });
  return { kind: "signed_in", sessionToken: session.token, staffPrincipalId: resolved.staffPrincipalId };
}

async function claimStateWithApi(
  origin: string,
  replayId: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined
): Promise<{ ok: true } | { ok: false; code: "reused_state" | "state_unavailable" }> {
  const serviceHeaders = serviceCredentialHeaders(env);
  if (!serviceHeaders) return { ok: false, code: "state_unavailable" };
  const response = await (fetchImpl ?? fetch)(`${origin}/internal/staff/google/state/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...serviceHeaders },
    body: JSON.stringify({ replayId }),
    redirect: "error",
    signal: AbortSignal.timeout(1_500),
  });
  if (response.status === 200) return { ok: true };
  if (response.status === 503) return { ok: false, code: "state_unavailable" };
  return { ok: false, code: "reused_state" };
}

async function resolveWithApi(
  origin: string,
  value: { idToken: string; nonce: string },
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined
): Promise<StaffGoogleResolution> {
  const serviceHeaders = serviceCredentialHeaders(env);
  if (!serviceHeaders) return { ok: false };
  const response = await (fetchImpl ?? fetch)(`${origin}/internal/staff/google/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...serviceHeaders },
    body: JSON.stringify({ idToken: value.idToken, nonce: value.nonce }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { ok: false };
  const parsed = (await response.json()) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const record = parsed as Record<string, unknown>;
  if (record.ok !== true || typeof record.staffPrincipalId !== "string" || typeof record.googleSub !== "string") {
    return { ok: false };
  }
  return { ok: true, staffPrincipalId: record.staffPrincipalId, googleSub: record.googleSub };
}

export async function readLiveStaffSession(input: {
  env: NodeJS.ProcessEnv;
  sessionCookie: string | undefined;
  nowSec?: number;
  fetchImpl?: FetchLike;
  confirm?: (token: string) => Promise<boolean>;
}): Promise<{ kind: "signed_out" } | { kind: "signed_in"; staffPrincipalId: string } | { kind: "denied" }> {
  const secret = sessionSecret(input.env);
  if (!input.sessionCookie || !secret || input.env.SA360_STAFF_GOOGLE_SIGNIN_ENABLED !== "true") {
    return { kind: "signed_out" };
  }
  const session = verifyStaffSession(input.sessionCookie, { secret, nowSec: input.nowSec });
  if (!session.ok) return session.code === "expired" ? { kind: "denied" } : { kind: "signed_out" };
  const confirm = input.confirm ?? ((token) => confirmWithApi(input.env, token, input.fetchImpl));
  try {
    const live = await confirm(input.sessionCookie);
    if (!live) return { kind: "denied" };
  } catch {
    return { kind: "denied" };
  }
  return { kind: "signed_in", staffPrincipalId: session.claims.sub };
}

async function confirmWithApi(env: NodeJS.ProcessEnv, token: string, fetchImpl: FetchLike | undefined): Promise<boolean> {
  const origin = readStaffApiOrigin(env.SA360_API_INTERNAL_URL ?? env.NEXT_PUBLIC_SA360_API_BASE_URL);
  const serviceHeaders = serviceCredentialHeaders(env);
  if (!origin || !serviceHeaders) return false;
  const response = await (fetchImpl ?? fetch)(`${origin}/internal/staff/session`, {
    method: "POST",
    headers: { accept: "application/json", [STAFF_SESSION_HEADER]: token, ...serviceHeaders },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const parsed = (await response.json()) as unknown;
  return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { ok?: unknown }).ok === true);
}

export function staffSessionBrowserCookie(token: string, env: NodeJS.ProcessEnv) {
  return {
    name: STAFF_SESSION_COOKIE,
    value: token,
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: secureCookie(env),
    path: "/",
    maxAge: STAFF_SESSION_TTL_SECONDS,
  };
}

export function staffStateClearCookie(env: NodeJS.ProcessEnv) {
  return {
    name: STAFF_GOOGLE_STATE_COOKIE,
    value: "",
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: secureCookie(env),
    path: "/staff/google",
    maxAge: 0,
  };
}

export function staffLogoutClearCookie(env: NodeJS.ProcessEnv) {
  return staffSessionClearCookie(secureCookie(env));
}

export function staffGoogleConfigReady(env: NodeJS.ProcessEnv): boolean {
  return readStaffGoogleBrowserConfig(env) !== null && sessionSecret(env) !== null && readStaffGoogleServiceSecret(env) !== null;
}

function serviceCredentialHeaders(env: NodeJS.ProcessEnv): Record<string, string> | null {
  const secret = readStaffGoogleServiceSecret(env);
  if (!secret) return null;
  return { [STAFF_GOOGLE_SERVICE_HEADER]: secret };
}
