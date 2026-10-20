import type { PrismaClient } from "@prisma/client";

import { getGoogleOAuthClientCredentials } from "../../lib/google-oauth-env.js";
import { GOOGLE_ACCESS_TOKEN_EXPIRY_BUFFER_MS } from "../../lib/google-sheets-env.js";
import {
  decryptGoogleToken,
  isGoogleTokenEncryptionConfigured,
} from "../../lib/google-token-encryption.js";
import { prisma } from "../../lib/db.js";
import {
  findCompanyGoogleConnection,
  findCompanyGoogleSecrets,
  type CompanyGoogleSecretRow,
} from "../../repositories/company-google-connection.repository.js";
import { refreshGoogleAccessToken } from "../google-oauth/google-oauth-http-client.js";
import {
  compareAndSetCompanyGoogleTokenRefresh,
  markCompanyGoogleReconnectRequired,
} from "./company-google-connection.service.js";

export type CompanyGoogleAccessTokenResult =
  | { ok: true; accessToken: string; connectionId: string; tokenVersion: number; googleEmail: string | null }
  | {
      ok: false;
      code:
        | "google_not_connected"
        | "google_reconnect_required"
        | "refresh_retryable"
        | "oauth_not_configured"
        | "provider_error";
    };

export type CompanyGoogleAccessTokenDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  db?: PrismaClient;
  forceRefresh?: boolean;
  loadConnection?: typeof findCompanyGoogleConnection;
  loadSecrets?: typeof findCompanyGoogleSecrets;
  casRefresh?: typeof compareAndSetCompanyGoogleTokenRefresh;
  markReconnect?: typeof markCompanyGoogleReconnectRequired;
  refreshToken?: typeof refreshGoogleAccessToken;
};

function isUsablyFresh(expiresAt: Date | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - GOOGLE_ACCESS_TOKEN_EXPIRY_BUFFER_MS > now.getTime();
}

function decryptAccess(row: CompanyGoogleSecretRow): string | null {
  if (!row.accessTokenEncrypted) return null;
  try {
    const token = decryptGoogleToken(row.accessTokenEncrypted);
    return token.trim() ? token : null;
  } catch {
    return null;
  }
}

export async function getValidCompanyGoogleAccessToken(
  deps: CompanyGoogleAccessTokenDeps = {}
): Promise<CompanyGoogleAccessTokenResult> {
  const env = deps.env ?? process.env;
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  if (!isGoogleTokenEncryptionConfigured() && !env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) {
    return { ok: false, code: "oauth_not_configured" };
  }
  const connection = await (deps.loadConnection ?? findCompanyGoogleConnection)(db);
  if (!connection || connection.status === "disconnected") {
    return { ok: false, code: "google_not_connected" };
  }
  if (connection.status === "reconnect_required" || connection.status === "error") {
    return { ok: false, code: "google_reconnect_required" };
  }
  if (connection.status !== "connected") {
    return { ok: false, code: "google_not_connected" };
  }

  const secrets = await (deps.loadSecrets ?? findCompanyGoogleSecrets)(db);
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
        googleEmail: secrets.googleEmail,
      };
    }
  }
  return refreshAndPersist(secrets, env, now, deps, db);
}

async function refreshAndPersist(
  secrets: CompanyGoogleSecretRow,
  env: NodeJS.ProcessEnv,
  now: Date,
  deps: CompanyGoogleAccessTokenDeps,
  db: PrismaClient
): Promise<CompanyGoogleAccessTokenResult> {
  if (!secrets.refreshTokenEncrypted) {
    await (deps.markReconnect ?? markCompanyGoogleReconnectRequired)(
      {
        id: secrets.id,
        expectedTokenVersion: secrets.tokenVersion,
        lastError: "Google refresh token missing.",
      },
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
    await (deps.markReconnect ?? markCompanyGoogleReconnectRequired)(
      {
        id: secrets.id,
        expectedTokenVersion: secrets.tokenVersion,
        lastError: "Google refresh token missing.",
      },
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
      const marked = await (deps.markReconnect ?? markCompanyGoogleReconnectRequired)(
        {
          id: secrets.id,
          expectedTokenVersion: secrets.tokenVersion,
          lastError: "Google reconnect required.",
        },
        db
      );
      if (marked.ok) return { ok: false, code: "google_reconnect_required" };
      const latestAfterRace = await (deps.loadSecrets ?? findCompanyGoogleSecrets)(db);
      if (!latestAfterRace || latestAfterRace.status === "disconnected") {
        return { ok: false, code: "google_not_connected" };
      }
      if (latestAfterRace.status === "connected" && isUsablyFresh(latestAfterRace.tokenExpiresAt, now)) {
        const accessToken = decryptAccess(latestAfterRace);
        if (accessToken) {
          return {
            ok: true,
            accessToken,
            connectionId: latestAfterRace.id,
            tokenVersion: latestAfterRace.tokenVersion,
            googleEmail: latestAfterRace.googleEmail,
          };
        }
      }
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
  const cas = await (deps.casRefresh ?? compareAndSetCompanyGoogleTokenRefresh)(
    {
      id: secrets.id,
      expectedTokenVersion: secrets.tokenVersion,
      accessToken: refreshed.token.accessToken,
      ...(refreshed.token.refreshToken ? { refreshToken: refreshed.token.refreshToken } : {}),
      tokenExpiresAt: refreshed.token.expiresAt,
      tokenType: refreshed.token.tokenType,
      scopes: refreshed.token.scopes.length > 0 ? refreshed.token.scopes : granted(secrets.scopes),
    },
    db
  );
  if (cas.ok) {
    return {
      ok: true,
      accessToken: refreshed.token.accessToken,
      connectionId: secrets.id,
      tokenVersion: cas.tokenVersion,
      googleEmail: secrets.googleEmail,
    };
  }
  if (cas.reason === "disconnected") return { ok: false, code: "google_not_connected" };
  const latest = await (deps.loadSecrets ?? findCompanyGoogleSecrets)(db);
  if (!latest || latest.status === "disconnected") return { ok: false, code: "google_not_connected" };
  if (latest.status !== "connected") return { ok: false, code: "google_reconnect_required" };
  if (isUsablyFresh(latest.tokenExpiresAt, now)) {
    const accessToken = decryptAccess(latest);
    if (accessToken) {
      return {
        ok: true,
        accessToken,
        connectionId: latest.id,
        tokenVersion: latest.tokenVersion,
        googleEmail: latest.googleEmail,
      };
    }
  }
  return { ok: false, code: "refresh_retryable" };
}

function granted(scopes: unknown): string[] {
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
}
