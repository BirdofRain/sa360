import type { GoogleAccountConnection, Prisma, PrismaClient } from "@prisma/client";

import { encryptGoogleToken } from "../../lib/google-token-encryption.js";
import {
  compareAndSetGoogleConnectionTokens,
  findActiveGoogleAccountConnectionByGoogleUserId,
  findGoogleAccountConnectionByClientAccountId,
  findGoogleAccountConnectionForTenant,
  findGoogleAccountConnectionSecretsForTenant,
  updateGoogleAccountConnectionForTenant,
  wipeGoogleAccountConnectionCredentials,
  createGoogleAccountConnection,
  type GoogleTokenCasResult,
} from "../../repositories/google-account-connection.repository.js";
import { presentGoogleAccountConnection } from "./google-connection.present.js";

export type UpsertGoogleAccountConnectionInput = {
  clientAccountId: string;
  googleUserId: string;
  googleEmail?: string | null;
  googleDisplayName?: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scopes?: string[];
  tokenType?: string | null;
};

export type UpsertGoogleAccountConnectionResult =
  | { ok: true; connection: ReturnType<typeof presentGoogleAccountConnection> }
  | { ok: false; reason: "google_identity_owned_by_other_tenant" | "invalid_input" };

function requireNonEmpty(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

/**
 * Create or reconnect the single Google connection for a ClientAccount.
 * Tokens are encrypted before persistence. Does not call Google.
 */
export async function upsertGoogleAccountConnectionForClient(
  input: UpsertGoogleAccountConnectionInput,
  db?: PrismaClient
): Promise<UpsertGoogleAccountConnectionResult> {
  let clientAccountId: string;
  let googleUserId: string;
  try {
    clientAccountId = requireNonEmpty(input.clientAccountId, "clientAccountId");
    googleUserId = requireNonEmpty(input.googleUserId, "googleUserId");
    requireNonEmpty(input.accessToken, "accessToken");
    requireNonEmpty(input.refreshToken, "refreshToken");
  } catch {
    return { ok: false, reason: "invalid_input" };
  }

  const other = await findActiveGoogleAccountConnectionByGoogleUserId(googleUserId, db);
  if (other && other.clientAccountId !== clientAccountId) {
    return { ok: false, reason: "google_identity_owned_by_other_tenant" };
  }

  const accessTokenEncrypted = encryptGoogleToken(input.accessToken);
  const refreshTokenEncrypted = encryptGoogleToken(input.refreshToken);
  const now = new Date();
  const scopes = (input.scopes ?? []).filter((s) => s.trim().length > 0);
  const tokenType = input.tokenType?.trim() || "Bearer";

  const existing = await findGoogleAccountConnectionByClientAccountId(clientAccountId, db);
  let row: GoogleAccountConnection;
  if (!existing) {
    row = await createGoogleAccountConnection(
      {
        clientAccount: { connect: { clientAccountId } },
        googleUserId,
        googleEmail: input.googleEmail?.trim() || null,
        googleDisplayName: input.googleDisplayName?.trim() || null,
        status: "connected",
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt: input.tokenExpiresAt,
        scopes: scopes.length ? (scopes as Prisma.InputJsonValue) : undefined,
        tokenType,
        tokenVersion: 1,
        connectedAt: now,
        lastRefreshedAt: now,
        reconnectRequiredAt: null,
        disconnectedAt: null,
        lastError: null,
      },
      db
    );
  } else {
    const updated = await updateGoogleAccountConnectionForTenant(
      { id: existing.id, clientAccountId },
      {
        googleUserId,
        googleEmail: input.googleEmail?.trim() || null,
        googleDisplayName: input.googleDisplayName?.trim() || null,
        status: "connected",
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt: input.tokenExpiresAt,
        scopes: scopes.length ? (scopes as Prisma.InputJsonValue) : undefined,
        tokenType,
        tokenVersion: { increment: 1 },
        connectedAt: existing.connectedAt ?? now,
        lastRefreshedAt: now,
        reconnectRequiredAt: null,
        disconnectedAt: null,
        lastError: null,
      },
      db
    );
    if (!updated) return { ok: false, reason: "invalid_input" };
    row = updated;
  }

  return { ok: true, connection: presentGoogleAccountConnection(row) };
}

export async function getGoogleAccountConnectionByClientAccountId(
  clientAccountId: string,
  db?: PrismaClient
) {
  const row = await findGoogleAccountConnectionByClientAccountId(clientAccountId, db);
  if (!row) return null;
  return presentGoogleAccountConnection(row);
}

export async function getGoogleAccountConnectionForTenant(
  input: { id: string; clientAccountId: string },
  db?: PrismaClient
) {
  const row = await findGoogleAccountConnectionForTenant(input, db);
  if (!row) return null;
  return presentGoogleAccountConnection(row);
}

export async function markGoogleConnectionReconnectRequired(
  input: { id: string; clientAccountId: string; lastError?: string | null },
  db?: PrismaClient
) {
  const updated = await updateGoogleAccountConnectionForTenant(
    input,
    {
      status: "reconnect_required",
      reconnectRequiredAt: new Date(),
      lastError: input.lastError?.trim() || "Reconnect required.",
    },
    db
  );
  if (!updated) return { notFound: true as const };
  return { connection: presentGoogleAccountConnection(updated) };
}

/**
 * Persistence-level disconnect. Wipes token ciphertext. Does not call Google revoke.
 */
export async function disconnectGoogleConnection(
  input: { id: string; clientAccountId: string },
  db?: PrismaClient
) {
  const updated = await wipeGoogleAccountConnectionCredentials(input, db);
  if (!updated) return { notFound: true as const };
  return { connection: presentGoogleAccountConnection(updated) };
}

export async function compareAndSetGoogleConnectionTokenRefresh(
  input: {
    id: string;
    clientAccountId: string;
    expectedTokenVersion: number;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
    tokenType?: string | null;
    scopes?: string[];
  },
  db?: PrismaClient
): Promise<GoogleTokenCasResult | { ok: false; reason: "invalid_input" }> {
  try {
    requireNonEmpty(input.accessToken, "accessToken");
    requireNonEmpty(input.refreshToken, "refreshToken");
  } catch {
    return { ok: false, reason: "invalid_input" };
  }

  const scopes = (input.scopes ?? []).filter((s) => s.trim().length > 0);
  return compareAndSetGoogleConnectionTokens(
    {
      id: input.id,
      clientAccountId: input.clientAccountId,
      expectedTokenVersion: input.expectedTokenVersion,
      accessTokenEncrypted: encryptGoogleToken(input.accessToken),
      refreshTokenEncrypted: encryptGoogleToken(input.refreshToken),
      tokenExpiresAt: input.tokenExpiresAt,
      tokenType: input.tokenType,
      scopes: scopes.length ? (scopes as Prisma.InputJsonValue) : undefined,
    },
    db
  );
}

/** Narrow secret read — never use for list/status APIs. */
export async function getGoogleConnectionSecretsForTenant(
  input: { id: string; clientAccountId: string },
  db?: PrismaClient
) {
  return findGoogleAccountConnectionSecretsForTenant(input, db);
}
