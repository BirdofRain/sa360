import type { PrismaClient } from "@prisma/client";

import {
  getGoogleOAuthClientCredentials,
} from "../../lib/google-oauth-env.js";
import { GOOGLE_ACCESS_TOKEN_EXPIRY_BUFFER_MS } from "../../lib/google-sheets-env.js";
import {
  decryptGoogleToken,
  isGoogleTokenEncryptionConfigured,
} from "../../lib/google-token-encryption.js";
import { prisma } from "../../lib/db.js";
import {
  findGoogleAccountConnectionByClientAccountId,
  findGoogleAccountConnectionSecretsForTenant,
  type GoogleConnectionSecretRow,
} from "../../repositories/google-account-connection.repository.js";
import {
  compareAndSetGoogleConnectionTokenRefresh,
  markGoogleConnectionReconnectRequired,
} from "./google-connection.service.js";
import { refreshGoogleAccessToken } from "./google-oauth-http-client.js";

export type GoogleAccessTokenFailure =
  | "google_not_connected"
  | "google_reconnect_required"
  | "refresh_retryable"
  | "oauth_not_configured"
  | "provider_error";

export type GoogleAccessTokenResult =
  | { ok: true; accessToken: string; connectionId: string; tokenVersion: number }
  | { ok: false; code: GoogleAccessTokenFailure };

export type GoogleAccessTokenDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  db?: PrismaClient;
  /** Skip a still-valid access token and refresh once. Used after a Sheets 401. */
  forceRefresh?: boolean;
  loadConnection?: typeof findGoogleAccountConnectionByClientAccountId;
  loadSecrets?: (
    input: { id: string; clientAccountId: string },
    db?: PrismaClient
  ) => Promise<GoogleConnectionSecretRow | null>;
  casRefresh?: typeof compareAndSetGoogleConnectionTokenRefresh;
  markReconnect?: typeof markGoogleConnectionReconnectRequired;
  refreshToken?: typeof refreshGoogleAccessToken;
};

function isUsablyFresh(expiresAt: Date | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - GOOGLE_ACCESS_TOKEN_EXPIRY_BUFFER_MS > now.getTime();
}

function decryptAccess(row: GoogleConnectionSecretRow): string | null {
  if (!row.accessTokenEncrypted) return null;
  try {
    const token = decryptGoogleToken(row.accessTokenEncrypted);
    return token.trim() ? token : null;
  } catch {
    return null;
  }
}

export async function getValidGoogleAccessToken(
  clientAccountId: string,
  deps: GoogleAccessTokenDeps = {}
): Promise<GoogleAccessTokenResult> {
  const env = deps.env ?? process.env;
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const tenantId = clientAccountId.trim();
  if (!tenantId) return { ok: false, code: "google_not_connected" };
  if (!isGoogleTokenEncryptionConfigured() && !env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) {
    return { ok: false, code: "oauth_not_configured" };
  }

  const connection = await (deps.loadConnection ?? findGoogleAccountConnectionByClientAccountId)(
    tenantId,
    db
  );
  if (!connection || connection.status === "disconnected") {
    return { ok: false, code: "google_not_connected" };
  }
  if (connection.status === "reconnect_required" || connection.status === "error") {
    return { ok: false, code: "google_reconnect_required" };
  }
  if (connection.status !== "connected") {
    return { ok: false, code: "google_not_connected" };
  }

  const loadSecrets = deps.loadSecrets ?? findGoogleAccountConnectionSecretsForTenant;
  const secrets = await loadSecrets({ id: connection.id, clientAccountId: tenantId }, db);
  if (!secrets || secrets.status === "disconnected") {
    return { ok: false, code: "google_not_connected" };
  }
  if (secrets.status !== "connected") {
    return { ok: false, code: "google_reconnect_required" };
  }

  if (!deps.forceRefresh && isUsablyFresh(secrets.tokenExpiresAt, now)) {
    const accessToken = decryptAccess(secrets);
    if (accessToken) {
      return {
        ok: true,
        accessToken,
        connectionId: secrets.id,
        tokenVersion: secrets.tokenVersion,
      };
    }
  }

  return refreshAndPersist(secrets, tenantId, env, now, deps, db);
}

async function refreshAndPersist(
  secrets: GoogleConnectionSecretRow,
  clientAccountId: string,
  env: NodeJS.ProcessEnv,
  now: Date,
  deps: GoogleAccessTokenDeps,
  db: PrismaClient
): Promise<GoogleAccessTokenResult> {
  if (!secrets.refreshTokenEncrypted) {
    await (deps.markReconnect ?? markGoogleConnectionReconnectRequired)(
      { id: secrets.id, clientAccountId, lastError: "Google refresh token missing." },
      db
    );
    return { ok: false, code: "google_reconnect_required" };
  }

  const credentials = getGoogleOAuthClientCredentials(env);
  if (!credentials) return { ok: false, code: "oauth_not_configured" };

  let refreshToken: string;
  try {
    refreshToken = decryptGoogleToken(secrets.refreshTokenEncrypted);
  } catch {
    return { ok: false, code: "oauth_not_configured" };
  }
  if (!refreshToken.trim()) {
    await (deps.markReconnect ?? markGoogleConnectionReconnectRequired)(
      { id: secrets.id, clientAccountId, lastError: "Google refresh token missing." },
      db
    );
    return { ok: false, code: "google_reconnect_required" };
  }

  const refreshed = await (deps.refreshToken ?? refreshGoogleAccessToken)(
    { refreshToken, config: credentials },
    deps.fetchImpl
  );
  if (!refreshed.ok) {
    if (refreshed.reason === "invalid_grant" || refreshed.reason === "terminal_credential") {
      await (deps.markReconnect ?? markGoogleConnectionReconnectRequired)(
        { id: secrets.id, clientAccountId, lastError: "Google reconnect required." },
        db
      );
      return { ok: false, code: "google_reconnect_required" };
    }
    if (
      refreshed.reason === "rate_limited" ||
      refreshed.reason === "server_error" ||
      refreshed.reason === "network_error"
    ) {
      return { ok: false, code: "refresh_retryable" };
    }
    return { ok: false, code: "provider_error" };
  }

  const cas = await (deps.casRefresh ?? compareAndSetGoogleConnectionTokenRefresh)(
    {
      id: secrets.id,
      clientAccountId,
      expectedTokenVersion: secrets.tokenVersion,
      accessToken: refreshed.token.accessToken,
      ...(refreshed.token.refreshToken ? { refreshToken: refreshed.token.refreshToken } : {}),
      tokenExpiresAt: refreshed.token.expiresAt,
      tokenType: refreshed.token.tokenType,
      scopes: refreshed.token.scopes,
    },
    db
  );

  if (cas.ok) {
    return {
      ok: true,
      accessToken: refreshed.token.accessToken,
      connectionId: secrets.id,
      tokenVersion: cas.tokenVersion,
    };
  }
  if (cas.reason === "disconnected") {
    return { ok: false, code: "google_not_connected" };
  }

  const loadSecrets = deps.loadSecrets ?? findGoogleAccountConnectionSecretsForTenant;
  const latest = await loadSecrets({ id: secrets.id, clientAccountId }, db);
  if (!latest || latest.status === "disconnected") {
    return { ok: false, code: "google_not_connected" };
  }
  if (latest.status !== "connected") {
    return { ok: false, code: "google_reconnect_required" };
  }
  if (isUsablyFresh(latest.tokenExpiresAt, now)) {
    const accessToken = decryptAccess(latest);
    if (accessToken) {
      return {
        ok: true,
        accessToken,
        connectionId: latest.id,
        tokenVersion: latest.tokenVersion,
      };
    }
  }
  return { ok: false, code: "refresh_retryable" };
}
