import type { CompanyGoogleConnection, Prisma, PrismaClient } from "@prisma/client";

import {
  COMPANY_GOOGLE_CONNECTION_KEY,
  grantedScopeList,
  missingCompanyOperationalScopes,
} from "../../lib/company-google-sheets-env.js";
import { encryptGoogleToken } from "../../lib/google-token-encryption.js";
import { findActiveGoogleAccountConnectionByGoogleUserId } from "../../repositories/google-account-connection.repository.js";
import {
  compareAndSetCompanyGoogleTokens,
  createCompanyGoogleConnection,
  findCompanyGoogleConnection,
  updateCompanyGoogleConnection,
  wipeCompanyGoogleCredentials,
} from "../../repositories/company-google-connection.repository.js";

export type CompanyGoogleConnectionView = {
  configured: boolean;
  status: CompanyGoogleConnection["status"] | "disconnected";
  connected: boolean;
  reconnectRequired: boolean;
  googleEmail: string | null;
  googleDisplayName: string | null;
  connectedAt: string | null;
  reconnectRequiredAt: string | null;
  scopes: string[];
  missingScopes: string[];
  destinationFolder: {
    folderId: string;
    title: string | null;
    verifiedAt: string;
  } | null;
  liveDeliveryEnabled: false;
};

const SECRET_KEYS = [
  "accessTokenEncrypted",
  "refreshTokenEncrypted",
  "accessToken",
  "refreshToken",
  "pkceVerifierEncrypted",
  "clientSecret",
] as const;

export function presentCompanyGoogleConnection(
  row: CompanyGoogleConnection | null
): CompanyGoogleConnectionView {
  if (!row) {
    return {
      configured: false,
      status: "disconnected",
      connected: false,
      reconnectRequired: false,
      googleEmail: null,
      googleDisplayName: null,
      connectedAt: null,
      reconnectRequiredAt: null,
      scopes: [],
      missingScopes: [],
      destinationFolder: null,
      liveDeliveryEnabled: false,
    };
  }
  const scopes = grantedScopeList(row.scopes);
  const view: CompanyGoogleConnectionView = {
    configured: true,
    status: row.status,
    connected: row.status === "connected",
    reconnectRequired: row.status === "reconnect_required" || row.status === "error",
    googleEmail: row.googleEmail,
    googleDisplayName: row.googleDisplayName,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    reconnectRequiredAt: row.reconnectRequiredAt?.toISOString() ?? null,
    scopes,
    missingScopes: missingCompanyOperationalScopes(scopes),
    destinationFolder:
      row.destinationFolderId && row.destinationFolderVerifiedAt
        ? {
            folderId: row.destinationFolderId,
            title: row.destinationFolderTitle,
            verifiedAt: row.destinationFolderVerifiedAt.toISOString(),
          }
        : null,
    liveDeliveryEnabled: false,
  };
  for (const key of SECRET_KEYS) {
    assertNoSecret(view, key);
  }
  return view;
}

function assertNoSecret(view: CompanyGoogleConnectionView, key: string): void {
  if (Object.prototype.hasOwnProperty.call(view, key)) {
    throw new Error(`Company Google presenter leaked ${key}.`);
  }
}

export type UpsertCompanyGoogleConnectionResult =
  | { ok: true; connection: CompanyGoogleConnectionView }
  | {
      ok: false;
      reason: "google_identity_owned_by_client" | "company_account_already_connected" | "invalid_input";
    };

export async function upsertCompanyGoogleConnection(
  input: {
    googleUserId: string;
    googleEmail?: string | null;
    googleDisplayName?: string | null;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
    scopes?: string[];
    tokenType?: string | null;
  },
  db?: PrismaClient
): Promise<UpsertCompanyGoogleConnectionResult> {
  const googleUserId = input.googleUserId.trim();
  const accessToken = input.accessToken.trim();
  const refreshToken = input.refreshToken.trim();
  if (!googleUserId || !accessToken || !refreshToken) {
    return { ok: false, reason: "invalid_input" };
  }
  const clientOwner = await findActiveGoogleAccountConnectionByGoogleUserId(googleUserId, db);
  if (clientOwner) return { ok: false, reason: "google_identity_owned_by_client" };

  const now = new Date();
  const scopes = (input.scopes ?? []).filter((scope) => scope.trim().length > 0);
  const fields: Prisma.CompanyGoogleConnectionUpdateInput = {
    googleUserId,
    googleEmail: input.googleEmail?.trim() || null,
    googleDisplayName: input.googleDisplayName?.trim() || null,
    status: "connected",
    accessTokenEncrypted: encryptGoogleToken(accessToken),
    refreshTokenEncrypted: encryptGoogleToken(refreshToken),
    tokenExpiresAt: input.tokenExpiresAt,
    scopes,
    tokenType: input.tokenType?.trim() || "Bearer",
    tokenVersion: { increment: 1 },
    connectedAt: now,
    lastRefreshedAt: now,
    reconnectRequiredAt: null,
    disconnectedAt: null,
    lastError: null,
  };

  const existing = await findCompanyGoogleConnection(db);
  if (!existing) {
    const created = await createCompanyGoogleConnection(
      {
        connectionKey: COMPANY_GOOGLE_CONNECTION_KEY,
        googleUserId,
        googleEmail: input.googleEmail?.trim() || null,
        googleDisplayName: input.googleDisplayName?.trim() || null,
        status: "connected",
        accessTokenEncrypted: encryptGoogleToken(accessToken),
        refreshTokenEncrypted: encryptGoogleToken(refreshToken),
        tokenExpiresAt: input.tokenExpiresAt,
        scopes,
        tokenType: input.tokenType?.trim() || "Bearer",
        tokenVersion: 1,
        connectedAt: now,
        lastRefreshedAt: now,
      },
      db
    );
    return { ok: true, connection: presentCompanyGoogleConnection(created) };
  }
  if (
    existing.googleUserId &&
    existing.googleUserId !== googleUserId &&
    existing.status !== "disconnected"
  ) {
    return { ok: false, reason: "company_account_already_connected" };
  }
  const updated = await updateCompanyGoogleConnection(
    existing.id,
    {
      ...fields,
      connectedAt: existing.connectedAt ?? now,
    },
    db
  );
  return { ok: true, connection: presentCompanyGoogleConnection(updated) };
}

export async function getCompanyGoogleConnection(db?: PrismaClient) {
  return presentCompanyGoogleConnection(await findCompanyGoogleConnection(db));
}

export async function markCompanyGoogleReconnectRequired(
  input: { id: string; lastError?: string | null },
  db?: PrismaClient
) {
  const updated = await updateCompanyGoogleConnection(
    input.id,
    {
      status: "reconnect_required",
      reconnectRequiredAt: new Date(),
      lastError: input.lastError?.trim() || "Reconnect required.",
    },
    db
  );
  return presentCompanyGoogleConnection(updated);
}

export async function disconnectCompanyGoogleConnection(id: string, db?: PrismaClient) {
  const updated = await wipeCompanyGoogleCredentials(id, db);
  return presentCompanyGoogleConnection(updated);
}

export async function compareAndSetCompanyGoogleTokenRefresh(
  input: {
    id: string;
    expectedTokenVersion: number;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt: Date;
    tokenType?: string | null;
    scopes?: string[];
  },
  db?: PrismaClient
) {
  const accessToken = input.accessToken.trim();
  if (!accessToken) return { ok: false as const, reason: "invalid_input" as const };
  const scopes = (input.scopes ?? []).filter((scope) => scope.trim().length > 0);
  return compareAndSetCompanyGoogleTokens(
    {
      id: input.id,
      expectedTokenVersion: input.expectedTokenVersion,
      accessTokenEncrypted: encryptGoogleToken(accessToken),
      ...(input.refreshToken ? { refreshTokenEncrypted: encryptGoogleToken(input.refreshToken) } : {}),
      tokenExpiresAt: input.tokenExpiresAt,
      tokenType: input.tokenType,
      scopes,
    },
    db
  );
}

export async function setCompanyDestinationFolder(
  input: { id: string; folderId: string; title: string | null; verifiedAt: Date },
  db?: PrismaClient
) {
  const updated = await updateCompanyGoogleConnection(
    input.id,
    {
      destinationFolderId: input.folderId,
      destinationFolderTitle: input.title,
      destinationFolderVerifiedAt: input.verifiedAt,
    },
    db
  );
  return presentCompanyGoogleConnection(updated);
}

export async function clearCompanyDestinationFolder(id: string, db?: PrismaClient) {
  const updated = await updateCompanyGoogleConnection(
    id,
    {
      destinationFolderId: null,
      destinationFolderTitle: null,
      destinationFolderVerifiedAt: null,
    },
    db
  );
  return presentCompanyGoogleConnection(updated);
}
