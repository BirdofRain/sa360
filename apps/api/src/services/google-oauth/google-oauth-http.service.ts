import { createPkceS256Challenge, generatePkceVerifier } from "../../lib/google-oauth-state.js";
import {
  buildGoogleOAuthAuthorizeUrl,
  buildGooglePortalRedirect,
  getGoogleOAuthConfig,
  isGoogleOAuthEnabled,
  type GoogleOAuthConfig,
} from "../../lib/google-oauth-env.js";
import { decryptGoogleToken } from "../../lib/google-token-encryption.js";
import {
  createGoogleOAuthPendingAuthForClient,
  consumeGoogleOAuthPendingAuthFromState,
} from "./google-oauth-pending-auth.service.js";
import {
  disconnectGoogleConnection,
  getGoogleAccountConnectionByClientAccountId,
  getGoogleConnectionSecretsForTenant,
  upsertGoogleAccountConnectionForClient,
} from "./google-connection.service.js";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleIdentity,
  revokeGoogleToken,
} from "./google-oauth-http-client.js";

export type GoogleOAuthRuntimeDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  generateVerifier?: () => string;
  createPending?: typeof createGoogleOAuthPendingAuthForClient;
  consumePending?: typeof consumeGoogleOAuthPendingAuthFromState;
  upsertConnection?: typeof upsertGoogleAccountConnectionForClient;
  getConnection?: typeof getGoogleAccountConnectionByClientAccountId;
  getSecrets?: typeof getGoogleConnectionSecretsForTenant;
  disconnectConnection?: typeof disconnectGoogleConnection;
};

export type GoogleCallbackOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; statusCode: number; code: string };

function configForEnabledOperation(env: NodeJS.ProcessEnv): GoogleOAuthConfig | null {
  if (!isGoogleOAuthEnabled(env) || !env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) return null;
  return getGoogleOAuthConfig(env);
}

export async function startGoogleOAuth(
  clientAccountId: string,
  returnTo: string | null | undefined,
  deps: GoogleOAuthRuntimeDeps = {}
): Promise<
  | { ok: true; authorizeUrl: string }
  | { ok: false; statusCode: number; code: "oauth_disabled" | "oauth_not_configured" | "invalid_return_to" }
> {
  const env = deps.env ?? process.env;
  if (!isGoogleOAuthEnabled(env)) {
    return { ok: false, statusCode: 404, code: "oauth_disabled" };
  }
  const config = configForEnabledOperation(env);
  if (!config) return { ok: false, statusCode: 503, code: "oauth_not_configured" };

  const verifier = (deps.generateVerifier ?? generatePkceVerifier)();
  const pending = await (deps.createPending ?? createGoogleOAuthPendingAuthForClient)({
    clientAccountId,
    returnTo,
    pkceVerifier: verifier,
  });
  if (!pending.ok) {
    return {
      ok: false,
      statusCode: 400,
      code: "invalid_return_to",
    };
  }
  return {
    ok: true,
    authorizeUrl: buildGoogleOAuthAuthorizeUrl({
      config,
      state: pending.state,
      codeChallenge: createPkceS256Challenge(verifier),
    }),
  };
}

function defaultRedirect(config: GoogleOAuthConfig, status: "cancelled" | "error"): string {
  return buildGooglePortalRedirect(config.portalPublicBaseUrl, "/portal/account", status);
}

export async function handleGoogleOAuthCallback(
  query: { state?: string; code?: string; error?: string },
  deps: GoogleOAuthRuntimeDeps = {}
): Promise<GoogleCallbackOutcome> {
  const env = deps.env ?? process.env;
  if (!isGoogleOAuthEnabled(env)) {
    return { kind: "error", statusCode: 404, code: "oauth_disabled" };
  }
  const config = configForEnabledOperation(env);
  if (!config) return { kind: "error", statusCode: 503, code: "oauth_not_configured" };

  const state = query.state?.trim() ?? "";
  if (!state) {
    return { kind: "redirect", url: defaultRedirect(config, "error") };
  }

  const consumed = await (deps.consumePending ?? consumeGoogleOAuthPendingAuthFromState)(state);
  if (!consumed.ok) {
    return { kind: "redirect", url: defaultRedirect(config, "error") };
  }
  if (query.error?.trim()) {
    const status = query.error.trim() === "access_denied" ? "cancelled" : "error";
    return {
      kind: "redirect",
      url: buildGooglePortalRedirect(config.portalPublicBaseUrl, consumed.returnTo, status),
    };
  }
  const code = query.code?.trim() ?? "";
  if (!code) {
    return {
      kind: "redirect",
      url: buildGooglePortalRedirect(config.portalPublicBaseUrl, consumed.returnTo, "error"),
    };
  }

  const token = await exchangeGoogleAuthorizationCode(
    { code, codeVerifier: consumed.pkceVerifier, config },
    deps.fetchImpl
  );
  if (!token.ok) {
    return {
      kind: "redirect",
      url: buildGooglePortalRedirect(config.portalPublicBaseUrl, consumed.returnTo, "error"),
    };
  }
  const identity = await fetchGoogleIdentity(token.token.accessToken, deps.fetchImpl);
  if (!identity.ok) {
    return {
      kind: "redirect",
      url: buildGooglePortalRedirect(config.portalPublicBaseUrl, consumed.returnTo, "error"),
    };
  }

  const saved = await (deps.upsertConnection ?? upsertGoogleAccountConnectionForClient)({
    clientAccountId: consumed.pending.clientAccountId,
    googleUserId: identity.identity.googleUserId,
    googleEmail: identity.identity.email,
    googleDisplayName: identity.identity.displayName,
    accessToken: token.token.accessToken,
    refreshToken: token.token.refreshToken,
    tokenExpiresAt: token.token.expiresAt,
    scopes: token.token.scopes,
    tokenType: token.token.tokenType,
  });
  const status =
    !saved.ok && saved.reason === "google_identity_owned_by_other_tenant"
      ? "account_in_use"
      : saved.ok
        ? "connected"
        : "error";
  return {
    kind: "redirect",
    url: buildGooglePortalRedirect(config.portalPublicBaseUrl, consumed.returnTo, status),
  };
}

export type GoogleStatusResponse = {
  connected: boolean;
  status: "connected" | "reconnect_required" | "disconnected" | "error";
  googleEmail: string | null;
  googleDisplayName: string | null;
  connectedAt: string | null;
  reconnectRequiredAt: string | null;
  oauthAvailable: boolean;
};

export async function getGoogleOAuthStatus(
  clientAccountId: string,
  deps: GoogleOAuthRuntimeDeps = {}
): Promise<GoogleStatusResponse> {
  const row = await (deps.getConnection ?? getGoogleAccountConnectionByClientAccountId)(
    clientAccountId
  );
  return {
    connected: row?.status === "connected",
    status: row?.status ?? "disconnected",
    googleEmail: row?.googleEmail ?? null,
    googleDisplayName: row?.googleDisplayName ?? null,
    connectedAt: row?.connectedAt ?? null,
    reconnectRequiredAt: row?.reconnectRequiredAt ?? null,
    oauthAvailable: isGoogleOAuthEnabled(deps.env ?? process.env),
  };
}

export async function disconnectGoogleOAuth(
  clientAccountId: string,
  deps: GoogleOAuthRuntimeDeps = {}
): Promise<
  | { ok: true; status: GoogleStatusResponse; revokeResult: "revoked" | "already_invalid" | "local_only" }
  | { ok: false; statusCode: number; code: "revoke_retryable" | "revoke_failed" | "oauth_not_configured" }
> {
  const getConnection = deps.getConnection ?? getGoogleAccountConnectionByClientAccountId;
  const connection = await getConnection(clientAccountId);
  if (!connection || connection.status === "disconnected") {
    return {
      ok: true,
      status: await getGoogleOAuthStatus(clientAccountId, deps),
      revokeResult: "local_only",
    };
  }
  if (!(deps.env ?? process.env).GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) {
    return { ok: false, statusCode: 503, code: "oauth_not_configured" };
  }
  const secrets = await (deps.getSecrets ?? getGoogleConnectionSecretsForTenant)({
    id: connection.id,
    clientAccountId,
  });
  if (!secrets) {
    return { ok: false, statusCode: 409, code: "revoke_failed" };
  }
  const ciphertext = secrets.refreshTokenEncrypted || secrets.accessTokenEncrypted;
  if (!ciphertext) {
    await (deps.disconnectConnection ?? disconnectGoogleConnection)({
      id: connection.id,
      clientAccountId,
    });
    return {
      ok: true,
      status: await getGoogleOAuthStatus(clientAccountId, deps),
      revokeResult: "local_only",
    };
  }

  let token: string;
  try {
    token = decryptGoogleToken(ciphertext);
  } catch {
    return { ok: false, statusCode: 503, code: "oauth_not_configured" };
  }
  const revoked = await revokeGoogleToken(token, deps.fetchImpl);
  if (!revoked.ok) {
    return {
      ok: false,
      statusCode: revoked.reason === "transient" ? 503 : 502,
      code: revoked.reason === "transient" ? "revoke_retryable" : "revoke_failed",
    };
  }
  await (deps.disconnectConnection ?? disconnectGoogleConnection)({
    id: connection.id,
    clientAccountId,
  });
  return {
    ok: true,
    status: await getGoogleOAuthStatus(clientAccountId, deps),
    revokeResult: revoked.result,
  };
}
