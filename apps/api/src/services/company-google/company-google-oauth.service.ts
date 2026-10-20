import type { PrismaClient } from "@prisma/client";

import {
  buildCompanyAdminRedirect,
  buildCompanyGoogleAuthorizeUrl,
  getCompanyGoogleOAuthConfig,
  isCompanyGoogleOAuthEnabled,
  parseSafeCompanyAdminReturnTo,
  type CompanyGoogleOAuthConfig,
} from "../../lib/company-google-sheets-env.js";
import { createPkceS256Challenge, generateGoogleOAuthState, generatePkceVerifier, hashGoogleOAuthState, isValidPkceVerifier } from "../../lib/google-oauth-state.js";
import { decryptGoogleToken, encryptGoogleToken } from "../../lib/google-token-encryption.js";
import {
  consumeCompanyGooglePendingAuthOnce,
  createCompanyGooglePendingAuth,
  findCompanyGoogleConnection,
  findCompanyGoogleSecrets,
  wipeCompanyGooglePendingVerifier,
} from "../../repositories/company-google-connection.repository.js";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleIdentity,
  revokeGoogleToken,
} from "../google-oauth/google-oauth-http-client.js";
import {
  disconnectCompanyGoogleConnection,
  getCompanyGoogleConnection,
  upsertCompanyGoogleConnection,
  type CompanyGoogleConnectionView,
} from "./company-google-connection.service.js";

const PENDING_TTL_MS = 15 * 60 * 1000;

export type CompanyGoogleOAuthDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  db?: PrismaClient;
  now?: () => Date;
  generateVerifier?: () => string;
};

export type CompanyGoogleCallbackOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; statusCode: number; code: string };

function enabledConfig(env: NodeJS.ProcessEnv): CompanyGoogleOAuthConfig | null {
  if (!isCompanyGoogleOAuthEnabled(env) || !env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) return null;
  return getCompanyGoogleOAuthConfig(env);
}

export async function startCompanyGoogleOAuth(
  input: { returnTo?: string | null; initiatedBy?: string | null },
  deps: CompanyGoogleOAuthDeps = {}
): Promise<
  | { ok: true; authorizeUrl: string }
  | { ok: false; statusCode: number; code: "oauth_disabled" | "oauth_not_configured" | "invalid_return_to" }
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleOAuthEnabled(env)) {
    return { ok: false, statusCode: 404, code: "oauth_disabled" };
  }
  const config = enabledConfig(env);
  if (!config) return { ok: false, statusCode: 503, code: "oauth_not_configured" };
  const returnTo = parseSafeCompanyAdminReturnTo(input.returnTo);
  if (!returnTo) return { ok: false, statusCode: 400, code: "invalid_return_to" };
  const verifier = (deps.generateVerifier ?? generatePkceVerifier)();
  if (!isValidPkceVerifier(verifier)) {
    return { ok: false, statusCode: 503, code: "oauth_not_configured" };
  }
  const { rawState, stateHash } = generateGoogleOAuthState();
  await createCompanyGooglePendingAuth(
    {
      stateHash,
      pkceVerifierEncrypted: encryptGoogleToken(verifier),
      returnTo,
      initiatedBy: sanitizeActor(input.initiatedBy),
      expiresAt: new Date((deps.now?.() ?? new Date()).getTime() + PENDING_TTL_MS),
    },
    deps.db
  );
  return {
    ok: true,
    authorizeUrl: buildCompanyGoogleAuthorizeUrl({
      config,
      state: rawState,
      codeChallenge: createPkceS256Challenge(verifier),
    }),
  };
}

function redirect(
  config: CompanyGoogleOAuthConfig,
  returnTo: string,
  status: "connected" | "cancelled" | "error" | "account_in_use"
): CompanyGoogleCallbackOutcome {
  try {
    return { kind: "redirect", url: buildCompanyAdminRedirect(config.adminPublicBaseUrl, returnTo, status) };
  } catch {
    return { kind: "error", statusCode: 503, code: "oauth_not_configured" };
  }
}

export async function handleCompanyGoogleOAuthCallback(
  query: { state?: string; code?: string; error?: string },
  deps: CompanyGoogleOAuthDeps = {}
): Promise<CompanyGoogleCallbackOutcome> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleOAuthEnabled(env)) {
    return { kind: "error", statusCode: 404, code: "oauth_disabled" };
  }
  const config = enabledConfig(env);
  if (!config) return { kind: "error", statusCode: 503, code: "oauth_not_configured" };
  const state = query.state?.trim() ?? "";
  if (!state) return redirect(config, "/clients", "error");
  const consumed = await consumeCompanyGooglePendingAuthOnce(
    { stateHash: hashGoogleOAuthState(state), now: deps.now?.() },
    deps.db
  );
  if (!consumed.ok) return redirect(config, "/clients", "error");
  let verifier = "";
  try {
    verifier = decryptGoogleToken(consumed.row.pkceVerifierEncrypted);
  } catch {
    verifier = "";
  }
  try {
    await wipeCompanyGooglePendingVerifier(consumed.row.id, deps.db);
  } catch {
    // The state is already consumed. A wipe failure must not leave a retryable code exchange.
  }
  if (query.error?.trim()) {
    return redirect(config, consumed.row.returnTo, query.error.trim() === "access_denied" ? "cancelled" : "error");
  }
  if (!verifier || !query.code?.trim()) {
    return redirect(config, consumed.row.returnTo, "error");
  }
  const token = await exchangeGoogleAuthorizationCode(
    { code: query.code.trim(), codeVerifier: verifier, config },
    deps.fetchImpl
  );
  if (!token.ok || !token.token.refreshToken) {
    return redirect(config, consumed.row.returnTo, "error");
  }
  const identity = await fetchGoogleIdentity(token.token.accessToken, deps.fetchImpl);
  if (!identity.ok) return redirect(config, consumed.row.returnTo, "error");
  let saved: Awaited<ReturnType<typeof upsertCompanyGoogleConnection>>;
  try {
    saved = await upsertCompanyGoogleConnection(
      {
        googleUserId: identity.identity.googleUserId,
        googleEmail: identity.identity.email,
        googleDisplayName: identity.identity.displayName,
        accessToken: token.token.accessToken,
        refreshToken: token.token.refreshToken,
        tokenExpiresAt: token.token.expiresAt,
        scopes: token.token.scopes,
        tokenType: token.token.tokenType,
      },
      deps.db
    );
  } catch {
    return redirect(config, consumed.row.returnTo, "error");
  }
  if (!saved.ok) {
    const status =
      saved.reason === "google_identity_owned_by_client" ||
      saved.reason === "company_account_already_connected"
        ? "account_in_use"
        : "error";
    return redirect(config, consumed.row.returnTo, status);
  }
  return redirect(config, consumed.row.returnTo, "connected");
}

export async function getCompanyGoogleOAuthStatus(
  deps: CompanyGoogleOAuthDeps = {}
): Promise<CompanyGoogleConnectionView & { oauthAvailable: boolean; sheetsSetupAvailable: boolean }> {
  const env = deps.env ?? process.env;
  const connection = await getCompanyGoogleConnection(deps.db);
  return {
    ...connection,
    oauthAvailable: isCompanyGoogleOAuthEnabled(env),
    sheetsSetupAvailable: env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED?.trim().toLowerCase() === "true",
  };
}

export async function disconnectCompanyGoogleOAuth(
  deps: CompanyGoogleOAuthDeps = {}
): Promise<
  | { ok: true; connection: CompanyGoogleConnectionView; revokeResult: "revoked" | "already_invalid" | "local_only" }
  | { ok: false; statusCode: number; code: "revoke_retryable" | "revoke_failed" | "oauth_not_configured" }
> {
  const env = deps.env ?? process.env;
  const connection = await findCompanyGoogleConnection(deps.db);
  if (!connection || connection.status === "disconnected") {
    return {
      ok: true,
      connection: await getCompanyGoogleConnection(deps.db),
      revokeResult: "local_only",
    };
  }
  if (!env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) {
    return { ok: false, statusCode: 503, code: "oauth_not_configured" };
  }
  const secrets = await findCompanyGoogleSecrets(deps.db);
  const ciphertext = secrets?.refreshTokenEncrypted || secrets?.accessTokenEncrypted;
  if (!ciphertext) {
    await disconnectCompanyGoogleConnection(connection.id, deps.db);
    return {
      ok: true,
      connection: await getCompanyGoogleConnection(deps.db),
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
  await disconnectCompanyGoogleConnection(connection.id, deps.db);
  return {
    ok: true,
    connection: await getCompanyGoogleConnection(deps.db),
    revokeResult: revoked.result,
  };
}

function sanitizeActor(raw: string | null | undefined): string {
  const value = raw?.trim() || "admin_api";
  if (value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) return "admin_api";
  return value;
}
