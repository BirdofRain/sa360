import type { Prisma } from "@prisma/client";
import { decryptGhlToken, encryptGhlToken } from "../../lib/ghl-token-encryption.js";
import {
  findGhlLocationConnectionByLocationId,
  updateGhlLocationConnection,
  upsertGhlLocationConnection,
} from "../../repositories/ghl-location-connection.repository.js";
import { refreshGhlOAuthTokens } from "./ghl-oauth-client.service.js";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type GhlLocationAuthMode = "oauth" | "env_private_token";

export type GhlLocationAuthResult = {
  accessToken: string;
  authMode: GhlLocationAuthMode;
  locationId: string;
};

/** Server-side only — never return to browser/API list responses. */
export async function getGhlAccessTokenForLocation(
  locationId: string,
  opts?: { fetchImpl?: typeof fetch; forceRefresh?: boolean }
): Promise<string> {
  const result = await resolveGhlAccessTokenForLocation(locationId, opts);
  if (!result) {
    throw new Error(`No GHL OAuth connection for location ${locationId.trim()}.`);
  }
  return result.accessToken;
}

export async function resolveGhlAccessTokenForLocation(
  locationId: string,
  opts?: { fetchImpl?: typeof fetch; forceRefresh?: boolean }
): Promise<GhlLocationAuthResult | null> {
  const trimmed = locationId.trim();
  if (!trimmed) return null;

  const row = await findGhlLocationConnectionByLocationId(trimmed);
  if (!row || row.connectionStatus === "revoked") {
    return null;
  }

  const needsRefresh =
    opts?.forceRefresh === true ||
    row.connectionStatus === "expired" ||
    row.tokenExpiresAt.getTime() - Date.now() <= REFRESH_BUFFER_MS;

  if (needsRefresh) {
    try {
      const refreshed = await refreshGhlOAuthTokens(row, decryptGhlToken, opts?.fetchImpl);
      await updateGhlLocationConnection(row.id, {
        accessTokenEncrypted: encryptGhlToken(refreshed.accessToken),
        refreshTokenEncrypted: encryptGhlToken(refreshed.refreshToken),
        tokenExpiresAt: refreshed.expiresAt,
        scopes: refreshed.scopes.length ? (refreshed.scopes as Prisma.InputJsonValue) : undefined,
        connectionStatus: "connected",
        lastError: null,
      });
      return { accessToken: refreshed.accessToken, authMode: "oauth", locationId: trimmed };
    } catch (err) {
      await updateGhlLocationConnection(row.id, {
        connectionStatus: "error",
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  if (row.connectionStatus === "error") {
    throw new Error(row.lastError || "GHL OAuth connection is in error state.");
  }

  return {
    accessToken: decryptGhlToken(row.accessTokenEncrypted),
    authMode: "oauth",
    locationId: trimmed,
  };
}

export function persistOAuthTokensForLocation(input: {
  locationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  clientAccountId?: string | null;
  locationName?: string | null;
  companyId?: string | null;
  userId?: string | null;
  appId?: string | null;
  connectionStatus?: string;
}) {
  return upsertGhlLocationConnection(input.locationId, {
    clientAccountId: input.clientAccountId?.trim() || null,
    locationName: input.locationName?.trim() || null,
    companyId: input.companyId?.trim() || null,
    userId: input.userId?.trim() || null,
    appId: input.appId?.trim() || null,
    accessTokenEncrypted: encryptGhlToken(input.accessToken),
    refreshTokenEncrypted: encryptGhlToken(input.refreshToken),
    tokenExpiresAt: input.expiresAt,
    scopes: input.scopes.length ? (input.scopes as Prisma.InputJsonValue) : undefined,
    authMode: "oauth",
    connectionStatus: input.connectionStatus?.trim() || "connected",
    lastError: null,
  });
}
