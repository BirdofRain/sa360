import {
  exchangeStaffGoogleCode,
  readStaffApiOrigin,
  readStaffGoogleEnrollmentBrowserConfig,
  staffGoogleAuthorizeUrl,
  staffGoogleCodeChallenge,
} from "@sa360/shared/staff-google-oidc";
import {
  createStaffEnrollmentState,
  STAFF_ENROLLMENT_STATE_COOKIE,
  STAFF_ENROLLMENT_STATE_PATH,
  STAFF_ENROLLMENT_STATE_TTL_SECONDS,
  verifyStaffEnrollmentState,
} from "@sa360/shared/staff-google-enrollment-state";
import { STAFF_ENROLLMENT_SECRET_PATTERN } from "@sa360/shared/staff-enrollment";
import { readStaffSessionSecret } from "@sa360/shared/staff-google-session";
import { readStaffGoogleServiceSecret, STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";
import { staffGoogleStateReplayId } from "@sa360/shared/staff-google-state";

type FetchLike = typeof fetch;

export type StaffEnrollmentStart =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "rejected" }
  | {
      kind: "redirect";
      location: string;
      stateCookie: {
        name: string;
        value: string;
        httpOnly: true;
        sameSite: "lax";
        secure: boolean;
        path: string;
        maxAge: number;
      };
    };

export async function startStaffGoogleEnrollment(input: {
  env: NodeJS.ProcessEnv;
  enrollmentSecret: string | undefined;
  nowSec?: number;
  fetchImpl?: FetchLike;
  preview?: (secret: string) => Promise<{ ok: true } | { ok: false; code: "rejected" | "unavailable" }>;
}): Promise<StaffEnrollmentStart> {
  const config = readStaffGoogleEnrollmentBrowserConfig(input.env);
  const secret = sessionSecret(input.env);
  const service = readStaffGoogleServiceSecret(input.env);
  const origin = readStaffApiOrigin(input.env.SA360_API_INTERNAL_URL ?? input.env.NEXT_PUBLIC_SA360_API_BASE_URL);
  if (!config || !secret || !service || (!input.preview && !origin)) return { kind: "unconfigured" };
  if (!input.enrollmentSecret || !STAFF_ENROLLMENT_SECRET_PATTERN.test(input.enrollmentSecret)) return { kind: "rejected" };
  const preview = input.preview ?? ((enrollmentSecret) => previewWithApi(origin as string, enrollmentSecret, input.env, input.fetchImpl));
  let opened: { ok: true } | { ok: false; code: "rejected" | "unavailable" };
  try {
    opened = await preview(input.enrollmentSecret);
  } catch {
    return { kind: "unavailable" };
  }
  if (!opened.ok) return opened.code === "unavailable" ? { kind: "unavailable" } : { kind: "rejected" };
  const created = createStaffEnrollmentState({
    redirectUri: config.redirectUri,
    grant: input.enrollmentSecret,
    nowSec: input.nowSec,
    secret,
  });
  const location = staffGoogleAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state: created.claims.state,
    nonce: created.claims.nonce,
    codeChallenge: staffGoogleCodeChallenge(created.claims.verifier),
  });
  if (new URL(location).origin !== "https://accounts.google.com") return { kind: "unavailable" };
  if (location.includes(input.enrollmentSecret)) return { kind: "unavailable" };
  return {
    kind: "redirect",
    location,
    stateCookie: {
      name: STAFF_ENROLLMENT_STATE_COOKIE,
      value: created.token,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie(input.env),
      path: STAFF_ENROLLMENT_STATE_PATH,
      maxAge: STAFF_ENROLLMENT_STATE_TTL_SECONDS,
    },
  };
}

export async function completeStaffGoogleEnrollment(input: {
  env: NodeJS.ProcessEnv;
  code: string | undefined;
  queryState: string | undefined;
  stateCookie: string | undefined;
  nowSec?: number;
  fetchImpl?: FetchLike;
  exchange?: typeof exchangeStaffGoogleCode;
  claimState?: (replayId: string) => Promise<{ ok: true } | { ok: false; code: "reused_state" | "state_unavailable" }>;
  bind?: (value: { enrollmentSecret: string; idToken: string; nonce: string }) => Promise<{ ok: true } | { ok: false; code: "rejected" | "unavailable" }>;
}): Promise<{ kind: "unconfigured" } | { kind: "unavailable" } | { kind: "denied" } | { kind: "enrolled" }> {
  const config = readStaffGoogleEnrollmentBrowserConfig(input.env);
  const secret = sessionSecret(input.env);
  const service = readStaffGoogleServiceSecret(input.env);
  const origin = readStaffApiOrigin(input.env.SA360_API_INTERNAL_URL ?? input.env.NEXT_PUBLIC_SA360_API_BASE_URL);
  if (!config || !secret || !service || (!input.claimState && !origin) || (!input.bind && !origin)) {
    return { kind: "unconfigured" };
  }
  const verified = verifyStaffEnrollmentState({
    token: input.stateCookie,
    queryState: input.queryState,
    redirectUri: config.redirectUri,
    nowSec: input.nowSec,
    secret,
  });
  if (!verified.ok) return verified.code === "secret_unavailable" ? { kind: "unconfigured" } : { kind: "denied" };
  const claim = input.claimState ?? ((replayId) => claimWithApi(origin as string, replayId, input.env, input.fetchImpl));
  let claimed: { ok: true } | { ok: false; code: "reused_state" | "state_unavailable" };
  try {
    claimed = await claim(staffGoogleStateReplayId(verified.claims.state));
  } catch {
    return { kind: "unavailable" };
  }
  if (!claimed.ok) return claimed.code === "state_unavailable" ? { kind: "unavailable" } : { kind: "denied" };
  const exchange = input.exchange ?? exchangeStaffGoogleCode;
  const exchanged = await exchange({
    code: input.code ?? "",
    verifier: verified.claims.verifier,
    config,
    fetchImpl: input.fetchImpl,
  });
  if (!exchanged.ok) return { kind: "denied" };
  const bind = input.bind ?? ((value) => bindWithApi(origin as string, value, input.env, input.fetchImpl));
  let bound: { ok: true } | { ok: false; code: "rejected" | "unavailable" };
  try {
    bound = await bind({
      enrollmentSecret: verified.claims.grant,
      idToken: exchanged.idToken,
      nonce: verified.claims.nonce,
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (!bound.ok) return bound.code === "unavailable" ? { kind: "unavailable" } : { kind: "denied" };
  return { kind: "enrolled" };
}

export function staffEnrollmentStateClearCookie(env: NodeJS.ProcessEnv) {
  return {
    name: STAFF_ENROLLMENT_STATE_COOKIE,
    value: "",
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: secureCookie(env),
    path: STAFF_ENROLLMENT_STATE_PATH,
    maxAge: 0,
  };
}

export function staffEnrollmentConfigured(env: NodeJS.ProcessEnv): boolean {
  return readStaffGoogleEnrollmentBrowserConfig(env) !== null && sessionSecret(env) !== null && readStaffGoogleServiceSecret(env) !== null;
}

async function previewWithApi(
  origin: string,
  enrollmentSecret: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined
): Promise<{ ok: true } | { ok: false; code: "rejected" | "unavailable" }> {
  const headers = serviceHeaders(env);
  if (!headers) return { ok: false, code: "unavailable" };
  const response = await (fetchImpl ?? fetch)(`${origin}/internal/staff/enrollment/preview`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify({ enrollmentSecret }),
    redirect: "error",
    signal: AbortSignal.timeout(1_500),
  });
  if (response.status === 200) return { ok: true };
  if (response.status === 503) return { ok: false, code: "unavailable" };
  return { ok: false, code: "rejected" };
}

async function claimWithApi(
  origin: string,
  replayId: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined
): Promise<{ ok: true } | { ok: false; code: "reused_state" | "state_unavailable" }> {
  const headers = serviceHeaders(env);
  if (!headers) return { ok: false, code: "state_unavailable" };
  const response = await (fetchImpl ?? fetch)(`${origin}/internal/staff/enrollment/state/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify({ replayId }),
    redirect: "error",
    signal: AbortSignal.timeout(1_500),
  });
  if (response.status === 200) return { ok: true };
  if (response.status === 503) return { ok: false, code: "state_unavailable" };
  return { ok: false, code: "reused_state" };
}

async function bindWithApi(
  origin: string,
  value: { enrollmentSecret: string; idToken: string; nonce: string },
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined
): Promise<{ ok: true } | { ok: false; code: "rejected" | "unavailable" }> {
  const headers = serviceHeaders(env);
  if (!headers) return { ok: false, code: "unavailable" };
  const response = await (fetchImpl ?? fetch)(`${origin}/internal/staff/enrollment/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(value),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 200) return { ok: true };
  if (response.status === 503) return { ok: false, code: "unavailable" };
  return { ok: false, code: "rejected" };
}

function serviceHeaders(env: NodeJS.ProcessEnv): Record<string, string> | null {
  const secret = readStaffGoogleServiceSecret(env);
  if (!secret) return null;
  return { [STAFF_GOOGLE_SERVICE_HEADER]: secret };
}

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
