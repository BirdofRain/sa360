import {
  fetchPortalSessionAuthState,
  postPortalLogin,
  type PortalClientContextResponse,
} from "../client-portal-api/portal-context.ts";
import type { PortalSessionCreateInput, PortalSessionPayload } from "./portal-session.ts";
import {
  isPortalSessionEpochCurrent,
  parsePortalSessionToken,
} from "./portal-session.ts";
import {
  getClientPortalLoginEmail,
  isClientPortalLoginConfigured,
  normalizePortalLoginEmail,
  PORTAL_LOGIN_DISABLED,
  PORTAL_LOGIN_INVALID_CREDENTIALS,
  PORTAL_LOGIN_SETUP_ERROR,
  verifyClientPortalPassword,
} from "./portal-auth-config.ts";

export {
  getClientPortalLoginEmail,
  isClientPortalLoginConfigured,
  normalizePortalLoginEmail,
  PORTAL_LOGIN_DISABLED,
  PORTAL_LOGIN_INVALID_CREDENTIALS,
  PORTAL_LOGIN_SETUP_ERROR,
  verifyClientPortalCredentials,
  verifyClientPortalPassword,
} from "./portal-auth-config.ts";

export type PortalLoginAuthResult =
  | { ok: true; session: PortalSessionCreateInput }
  | { ok: false; error: string };

function contextToSession(
  ctx: PortalClientContextResponse,
  loginEmail: string,
  portalSessionEpoch: number
): PortalSessionCreateInput {
  return {
    clientAccountId: ctx.clientAccountId,
    clientDisplayName: ctx.clientDisplayName,
    portalDisplayName: ctx.portalDisplayName,
    portalLoginEmail: loginEmail,
    portalSessionEpoch,
  };
}

function envFallbackSession(loginEmail: string): PortalSessionCreateInput | null {
  const envAccountId = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID?.trim();
  const envEmail = getClientPortalLoginEmail();
  if (!envAccountId || !envEmail) return null;
  if (normalizePortalLoginEmail(loginEmail) !== normalizePortalLoginEmail(envEmail)) {
    return null;
  }
  const clientDisplayName =
    process.env.NEXT_PUBLIC_CLIENT_PORTAL_DISPLAY_NAME?.trim() ||
    process.env.CLIENT_PORTAL_DISPLAY_NAME?.trim() ||
    "Your business";
  return {
    clientAccountId: envAccountId,
    clientDisplayName,
    portalDisplayName: null,
    portalLoginEmail: loginEmail,
    portalSessionEpoch: 0,
  };
}

function loginErrorFromApiBody(body: string, status: number): string {
  if (status === 403) return PORTAL_LOGIN_DISABLED;
  try {
    const parsed = JSON.parse(body) as { code?: string; error?: string };
    if (parsed.code === "PORTAL_DISABLED") return PORTAL_LOGIN_DISABLED;
  } catch {
    // generic
  }
  if (status === 401) return PORTAL_LOGIN_INVALID_CREDENTIALS;
  return PORTAL_LOGIN_INVALID_CREDENTIALS;
}

/** Resolve tenant after password check: per-customer hash, then env fallback. */
export async function authenticatePortalLogin(
  email: string,
  password: string
): Promise<PortalLoginAuthResult> {
  if (!isClientPortalLoginConfigured()) {
    return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
  }

  const loginEmail = normalizePortalLoginEmail(email);
  if (!loginEmail || !password) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
  }

  const apiResult = await postPortalLogin(loginEmail, password);
  if (apiResult.ok) {
    const { passwordCheck, context, portalSessionEpoch } = apiResult.data;
    if (passwordCheck === "customer") {
      if (!context.portalEnabled) {
        return { ok: false, error: PORTAL_LOGIN_DISABLED };
      }
      return {
        ok: true,
        session: contextToSession(context, loginEmail, portalSessionEpoch),
      };
    }

    // env_fallback: never skip the shared env password after a hash exists
    // (API only returns this when portalPasswordHash is null).
    if (!verifyClientPortalPassword(password)) {
      return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
    }
    if (!context.portalEnabled) {
      return { ok: false, error: PORTAL_LOGIN_DISABLED };
    }
    return {
      ok: true,
      session: contextToSession(context, loginEmail, portalSessionEpoch),
    };
  }

  if (apiResult.status === 401 || apiResult.status === 403) {
    return { ok: false, error: loginErrorFromApiBody(apiResult.body, apiResult.status) };
  }

  if (apiResult.status === 404 || apiResult.status === 0) {
    if (!verifyClientPortalPassword(password)) {
      return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
    }
    const fallback = envFallbackSession(loginEmail);
    if (fallback) {
      return { ok: true, session: fallback };
    }
    if (apiResult.status === 404) {
      return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
    }
    return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
  }

  return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
}

function isUsablePortalSessionAuthState(
  data: { clientAccountId?: string; portalSessionEpoch?: unknown; portalEnabled?: unknown },
  sessionClientAccountId: string
): data is { clientAccountId: string; portalSessionEpoch: number; portalEnabled: boolean } {
  return (
    typeof data.clientAccountId === "string" &&
    data.clientAccountId.trim() === sessionClientAccountId &&
    typeof data.portalEnabled === "boolean" &&
    typeof data.portalSessionEpoch === "number" &&
    Number.isInteger(data.portalSessionEpoch)
  );
}

/**
 * Authoritative session check for Node (BFF, RSC, server actions).
 * HMAC+expiry is parsed locally; epoch and portalEnabled come from the API (DB).
 * Fail closed when that state cannot be loaded — missing API config is not a bypass.
 * Edge middleware must not be treated as revocation.
 */
export async function readTrustedPortalSession(
  cookieValue: string | undefined
): Promise<PortalSessionPayload | null> {
  const parsed = parsePortalSessionToken(cookieValue);
  if (!parsed) return null;

  const state = await fetchPortalSessionAuthState(parsed.clientAccountId);
  if (!state.ok) return null;
  if (!isUsablePortalSessionAuthState(state.data, parsed.clientAccountId)) return null;
  if (!state.data.portalEnabled) return null;
  if (!isPortalSessionEpochCurrent(parsed.portalSessionEpoch, state.data.portalSessionEpoch)) {
    return null;
  }
  return parsed;
}
