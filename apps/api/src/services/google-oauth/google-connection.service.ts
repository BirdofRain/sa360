import { Prisma, type PrismaClient } from "@prisma/client";

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

export type GoogleConnectionTokenRefreshResult =
  | { ok: true; tokenVersion: number; connection: ReturnType<typeof presentGoogleAccountConnection> }
  | { ok: false; reason: "not_found" | "stale_version" | "disconnected" | "invalid_input" };

function requireNonEmpty(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function isPrismaUniqueConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2002" || err.code === "P2014")
  );
}

function connectionWriteFields(input: {
  googleUserId: string;
  googleEmail?: string | null;
  googleDisplayName?: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
  scopes: string[];
  tokenType: string;
  now: Date;
  connectedAt?: Date | null;
}) {
  return {
    googleUserId: input.googleUserId,
    googleEmail: input.googleEmail?.trim() || null,
    googleDisplayName: input.googleDisplayName?.trim() || null,
    status: "connected" as const,
    accessTokenEncrypted: input.accessTokenEncrypted,
    refreshTokenEncrypted: input.refreshTokenEncrypted,
    tokenExpiresAt: input.tokenExpiresAt,
    scopes: input.scopes.length ? (input.scopes as Prisma.InputJsonValue) : undefined,
    tokenType: input.tokenType,
    connectedAt: input.connectedAt ?? input.now,
    lastRefreshedAt: input.now,
    reconnectRequiredAt: null,
    disconnectedAt: null,
    lastError: null,
  };
}

/**
 * Create or reconnect the single Google connection for a ClientAccount.
 * Tokens are encrypted before persistence. Does not call Google.
 * Unique-index races map to `google_identity_owned_by_other_tenant` (never a raw Prisma error).
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
  const fields = connectionWriteFields({
    googleUserId,
    googleEmail: input.googleEmail,
    googleDisplayName: input.googleDisplayName,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiresAt: input.tokenExpiresAt,
    scopes,
    tokenType,
    now,
  });

  const persistUpdate = async (existingId: string, existingConnectedAt: Date | null) => {
    const updated = await updateGoogleAccountConnectionForTenant(
      { id: existingId, clientAccountId },
      {
        ...connectionWriteFields({
          googleUserId,
          googleEmail: input.googleEmail,
          googleDisplayName: input.googleDisplayName,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiresAt: input.tokenExpiresAt,
          scopes,
          tokenType,
          now,
          connectedAt: existingConnectedAt ?? now,
        }),
        tokenVersion: { increment: 1 },
      },
      db
    );
    if (!updated) return { ok: false as const, reason: "invalid_input" as const };
    return { ok: true as const, connection: presentGoogleAccountConnection(updated) };
  };

  const mapUniqueConflict = async (): Promise<UpsertGoogleAccountConnectionResult> => {
    const owner = await findActiveGoogleAccountConnectionByGoogleUserId(googleUserId, db);
    if (owner && owner.clientAccountId !== clientAccountId) {
      return { ok: false, reason: "google_identity_owned_by_other_tenant" };
    }
    const raced = await findGoogleAccountConnectionByClientAccountId(clientAccountId, db);
    if (raced) {
      try {
        return await persistUpdate(raced.id, raced.connectedAt);
      } catch (retryErr) {
        if (!isPrismaUniqueConflict(retryErr)) throw retryErr;
        const retryOwner = await findActiveGoogleAccountConnectionByGoogleUserId(googleUserId, db);
        if (retryOwner && retryOwner.clientAccountId !== clientAccountId) {
          return { ok: false, reason: "google_identity_owned_by_other_tenant" };
        }
        return { ok: false, reason: "google_identity_owned_by_other_tenant" };
      }
    }
    return { ok: false, reason: "google_identity_owned_by_other_tenant" };
  };

  const existing = await findGoogleAccountConnectionByClientAccountId(clientAccountId, db);
  try {
    if (!existing) {
      const row = await createGoogleAccountConnection(
        {
          clientAccount: { connect: { clientAccountId } },
          ...fields,
          tokenVersion: 1,
        },
        db
      );
      return { ok: true, connection: presentGoogleAccountConnection(row) };
    }
    return await persistUpdate(existing.id, existing.connectedAt);
  } catch (err) {
    if (!isPrismaUniqueConflict(err)) throw err;
    return mapUniqueConflict();
  }
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
    /** Omit when Google does not return a new refresh_token; existing ciphertext is kept. */
    refreshToken?: string;
    tokenExpiresAt: Date;
    tokenType?: string | null;
    scopes?: string[];
  },
  db?: PrismaClient
): Promise<GoogleConnectionTokenRefreshResult> {
  try {
    requireNonEmpty(input.accessToken, "accessToken");
    if (input.refreshToken !== undefined) {
      requireNonEmpty(input.refreshToken, "refreshToken");
    }
  } catch {
    return { ok: false, reason: "invalid_input" };
  }

  const scopes = (input.scopes ?? []).filter((s) => s.trim().length > 0);
  const result = await compareAndSetGoogleConnectionTokens(
    {
      id: input.id,
      clientAccountId: input.clientAccountId,
      expectedTokenVersion: input.expectedTokenVersion,
      accessTokenEncrypted: encryptGoogleToken(input.accessToken),
      refreshTokenEncrypted:
        input.refreshToken !== undefined ? encryptGoogleToken(input.refreshToken) : undefined,
      tokenExpiresAt: input.tokenExpiresAt,
      tokenType: input.tokenType,
      scopes: scopes.length ? (scopes as Prisma.InputJsonValue) : undefined,
    },
    db
  );
  if (!result.ok) return result;
  return {
    ok: true,
    tokenVersion: result.tokenVersion,
    connection: presentGoogleAccountConnection(result.row),
  };
}

/** Narrow secret read — never use for list/status APIs. */
export async function getGoogleConnectionSecretsForTenant(
  input: { id: string; clientAccountId: string },
  db?: PrismaClient
) {
  return findGoogleAccountConnectionSecretsForTenant(input, db);
}
