import type { GhlLocationConnection } from "@prisma/client";

export type GhlLocationConnectionItem = {
  id: string;
  clientAccountId: string | null;
  locationId: string;
  locationName: string | null;
  companyId: string | null;
  userId: string | null;
  appId: string | null;
  authMode: string;
  connectionStatus: string;
  tokenExpiresAt: string;
  scopes: string[];
  lastProbeAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const TOKEN_FIELD_DENYLIST = new Set([
  "accessTokenEncrypted",
  "refreshTokenEncrypted",
  "access_token",
  "refresh_token",
  "accessToken",
  "refreshToken",
]);

export function presentGhlLocationConnection(row: GhlLocationConnection): GhlLocationConnectionItem {
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter((s): s is string => typeof s === "string")
    : [];

  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    locationId: row.locationId,
    locationName: row.locationName,
    companyId: row.companyId,
    userId: row.userId,
    appId: row.appId,
    authMode: row.authMode,
    connectionStatus: row.connectionStatus,
    tokenExpiresAt: row.tokenExpiresAt.toISOString(),
    scopes,
    lastProbeAt: row.lastProbeAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function assertNoTokenFieldsInPayload(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (TOKEN_FIELD_DENYLIST.has(key)) {
      throw new Error(`Token field leaked in API response: ${key}`);
    }
  }
}
