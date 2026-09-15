import type { GoogleAccountConnection, GoogleOAuthPendingAuth } from "@prisma/client";

import { assertNoTokenFieldsInPayload } from "../../lib/token-field-denylist.js";

export type GoogleAccountConnectionItem = {
  id: string;
  clientAccountId: string;
  googleUserId: string | null;
  googleEmail: string | null;
  googleDisplayName: string | null;
  status: GoogleAccountConnection["status"];
  tokenExpiresAt: string | null;
  scopes: string[];
  tokenType: string | null;
  tokenVersion: number;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  reconnectRequiredAt: string | null;
  disconnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoogleOAuthPendingAuthItem = {
  id: string;
  clientAccountId: string;
  returnTo: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

function presentScopes(scopes: GoogleAccountConnection["scopes"]): string[] {
  return Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : [];
}

export function presentGoogleAccountConnection(
  row: GoogleAccountConnection
): GoogleAccountConnectionItem {
  const item: GoogleAccountConnectionItem = {
    id: row.id,
    clientAccountId: row.clientAccountId,
    googleUserId: row.googleUserId,
    googleEmail: row.googleEmail,
    googleDisplayName: row.googleDisplayName,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    scopes: presentScopes(row.scopes),
    tokenType: row.tokenType,
    tokenVersion: row.tokenVersion,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    lastRefreshedAt: row.lastRefreshedAt?.toISOString() ?? null,
    reconnectRequiredAt: row.reconnectRequiredAt?.toISOString() ?? null,
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  assertNoTokenFieldsInPayload(item as unknown as Record<string, unknown>);
  return item;
}

export function presentGoogleOAuthPendingAuth(row: GoogleOAuthPendingAuth): GoogleOAuthPendingAuthItem {
  const item: GoogleOAuthPendingAuthItem = {
    id: row.id,
    clientAccountId: row.clientAccountId,
    returnTo: row.returnTo,
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
  assertNoTokenFieldsInPayload(item as unknown as Record<string, unknown>);
  return item;
}

export { assertNoTokenFieldsInPayload };
