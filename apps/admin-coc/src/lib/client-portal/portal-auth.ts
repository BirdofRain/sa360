import {
  fetchPortalClientContext,
  type PortalClientContextResponse,
} from "../client-portal-api/portal-context.ts";
import type { PortalSessionCreateInput } from "./portal-session.ts";
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
  loginEmail: string
): PortalSessionCreateInput {
  return {
    clientAccountId: ctx.clientAccountId,
    clientDisplayName: ctx.clientDisplayName,
    portalDisplayName: ctx.portalDisplayName,
    portalLoginEmail: loginEmail,
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
  };
}

/** Resolve tenant after password check: DB portalLoginEmail, then env fallback. */
export async function authenticatePortalLogin(
  email: string,
  password: string
): Promise<PortalLoginAuthResult> {
  if (!isClientPortalLoginConfigured()) {
    return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
  }
  if (!verifyClientPortalPassword(password)) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
  }

  const loginEmail = normalizePortalLoginEmail(email);
  if (!loginEmail) {
    return { ok: false, error: PORTAL_LOGIN_INVALID_CREDENTIALS };
  }

  const ctxResult = await fetchPortalClientContext(loginEmail);
  if (ctxResult.ok) {
    const ctx = ctxResult.data;
    if (!ctx.portalEnabled) {
      return { ok: false, error: PORTAL_LOGIN_DISABLED };
    }
    return { ok: true, session: contextToSession(ctx, loginEmail) };
  }

  if (ctxResult.status === 404) {
    const fallback = envFallbackSession(loginEmail);
    if (fallback) {
      return { ok: true, session: fallback };
    }
    return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
  }

  const fallback = envFallbackSession(loginEmail);
  if (fallback) {
    return { ok: true, session: fallback };
  }

  return { ok: false, error: PORTAL_LOGIN_SETUP_ERROR };
}
