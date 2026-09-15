import type { GoogleAccountConnection, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

const ACTIVE_GOOGLE_CONNECTION_STATUSES = ["connected", "reconnect_required", "error"] as const;

export type GoogleConnectionSecretRow = Pick<
  GoogleAccountConnection,
  | "id"
  | "clientAccountId"
  | "status"
  | "tokenVersion"
  | "accessTokenEncrypted"
  | "refreshTokenEncrypted"
  | "tokenExpiresAt"
  | "tokenType"
  | "scopes"
>;

export async function findGoogleAccountConnectionByClientAccountId(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  const id = clientAccountId.trim();
  if (!id) return null;
  return db.googleAccountConnection.findUnique({ where: { clientAccountId: id } });
}

/**
 * Tenant-bound lookup. ID alone is not sufficient — clientAccountId must match.
 */
export async function findGoogleAccountConnectionForTenant(
  input: { id: string; clientAccountId: string },
  db: PrismaClient = prisma
) {
  const id = input.id.trim();
  const clientAccountId = input.clientAccountId.trim();
  if (!id || !clientAccountId) return null;
  return db.googleAccountConnection.findFirst({
    where: { id, clientAccountId },
  });
}

/** Ownership probe only — never returns token ciphertext. */
export async function findActiveGoogleAccountConnectionByGoogleUserId(
  googleUserId: string,
  db: PrismaClient = prisma
) {
  const sub = googleUserId.trim();
  if (!sub) return null;
  return db.googleAccountConnection.findFirst({
    where: {
      googleUserId: sub,
      status: { in: [...ACTIVE_GOOGLE_CONNECTION_STATUSES] },
    },
    select: { id: true, clientAccountId: true, status: true, googleUserId: true },
  });
}

/** Ciphertext-bearing read. Callers must not present this row broadly. */
export async function findGoogleAccountConnectionSecretsForTenant(
  input: { id: string; clientAccountId: string },
  db: PrismaClient = prisma
): Promise<GoogleConnectionSecretRow | null> {
  const row = await findGoogleAccountConnectionForTenant(input, db);
  if (!row) return null;
  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    status: row.status,
    tokenVersion: row.tokenVersion,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    tokenExpiresAt: row.tokenExpiresAt,
    tokenType: row.tokenType,
    scopes: row.scopes,
  };
}

export async function createGoogleAccountConnection(
  data: Prisma.GoogleAccountConnectionCreateInput,
  db: PrismaClient = prisma
) {
  return db.googleAccountConnection.create({ data });
}

export async function updateGoogleAccountConnectionForTenant(
  input: { id: string; clientAccountId: string },
  data: Prisma.GoogleAccountConnectionUpdateInput,
  db: PrismaClient = prisma
) {
  const existing = await findGoogleAccountConnectionForTenant(input, db);
  if (!existing) return null;
  return db.googleAccountConnection.update({
    where: { id: existing.id },
    data,
  });
}

export type GoogleTokenCasUpdateInput = {
  id: string;
  clientAccountId: string;
  expectedTokenVersion: number;
  accessTokenEncrypted: string;
  /** Omit to leave the stored refresh ciphertext unchanged (Google often omits refresh_token). */
  refreshTokenEncrypted?: string;
  tokenExpiresAt: Date;
  tokenType?: string | null;
  scopes?: Prisma.InputJsonValue;
};

export type GoogleTokenCasResult =
  | { ok: true; tokenVersion: number; row: GoogleAccountConnection }
  | { ok: false; reason: "not_found" | "stale_version" | "disconnected" };

/**
 * Compare-and-set token persist: UPDATE … WHERE tokenVersion = N AND tenant matches.
 * Increments tokenVersion on success. Does not call Google.
 */
export async function compareAndSetGoogleConnectionTokens(
  input: GoogleTokenCasUpdateInput,
  db: PrismaClient = prisma
): Promise<GoogleTokenCasResult> {
  const id = input.id.trim();
  const clientAccountId = input.clientAccountId.trim();
  if (!id || !clientAccountId) return { ok: false, reason: "not_found" };

  const updated = await db.googleAccountConnection.updateMany({
    where: {
      id,
      clientAccountId,
      tokenVersion: input.expectedTokenVersion,
      status: { in: [...ACTIVE_GOOGLE_CONNECTION_STATUSES] },
    },
    data: {
      accessTokenEncrypted: input.accessTokenEncrypted,
      ...(input.refreshTokenEncrypted !== undefined
        ? { refreshTokenEncrypted: input.refreshTokenEncrypted }
        : {}),
      tokenExpiresAt: input.tokenExpiresAt,
      tokenType: input.tokenType === undefined ? undefined : input.tokenType,
      scopes: input.scopes,
      tokenVersion: { increment: 1 },
      lastRefreshedAt: new Date(),
      status: "connected",
      reconnectRequiredAt: null,
      disconnectedAt: null,
      lastError: null,
    },
  });

  if (updated.count === 1) {
    const row = await db.googleAccountConnection.findFirst({
      where: { id, clientAccountId },
    });
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, tokenVersion: row.tokenVersion, row };
  }

  const existing = await db.googleAccountConnection.findFirst({
    where: { id, clientAccountId },
  });
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "disconnected") return { ok: false, reason: "disconnected" };
  return { ok: false, reason: "stale_version" };
}

export async function wipeGoogleAccountConnectionCredentials(
  input: { id: string; clientAccountId: string },
  db: PrismaClient = prisma
) {
  const existing = await findGoogleAccountConnectionForTenant(input, db);
  if (!existing) return null;
  return db.googleAccountConnection.update({
    where: { id: existing.id },
    data: {
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      tokenType: null,
      status: "disconnected",
      disconnectedAt: new Date(),
      reconnectRequiredAt: null,
      lastError: null,
      tokenVersion: { increment: 1 },
    },
  });
}
