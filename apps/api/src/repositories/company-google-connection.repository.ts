import type { CompanyGoogleConnection, CompanyGoogleOAuthPendingAuth, Prisma, PrismaClient } from "@prisma/client";

import { COMPANY_GOOGLE_CONNECTION_KEY } from "../lib/company-google-sheets-env.js";
import { prisma } from "../lib/db.js";

const ACTIVE_STATUSES = ["connected", "reconnect_required", "error"] as const;

export type CompanyGoogleSecretRow = Pick<
  CompanyGoogleConnection,
  | "id"
  | "status"
  | "tokenVersion"
  | "accessTokenEncrypted"
  | "refreshTokenEncrypted"
  | "tokenExpiresAt"
  | "tokenType"
  | "scopes"
  | "googleEmail"
  | "googleUserId"
>;

export async function findCompanyGoogleConnection(db: PrismaClient = prisma) {
  return db.companyGoogleConnection.findUnique({
    where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
  });
}

export async function findCompanyGoogleSecrets(
  db: PrismaClient = prisma
): Promise<CompanyGoogleSecretRow | null> {
  const row = await findCompanyGoogleConnection(db);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    tokenVersion: row.tokenVersion,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    tokenExpiresAt: row.tokenExpiresAt,
    tokenType: row.tokenType,
    scopes: row.scopes,
    googleEmail: row.googleEmail,
    googleUserId: row.googleUserId,
  };
}

/** Active company identity probe. Never returns token ciphertext. */
export async function findActiveCompanyGoogleUser(
  googleUserId: string,
  db: PrismaClient = prisma
) {
  const sub = googleUserId.trim();
  if (!sub) return null;
  return db.companyGoogleConnection.findFirst({
    where: {
      googleUserId: sub,
      status: { in: [...ACTIVE_STATUSES] },
    },
    select: { id: true, status: true, googleUserId: true, connectionKey: true },
  });
}

export async function createCompanyGoogleConnection(
  data: Prisma.CompanyGoogleConnectionCreateInput,
  db: PrismaClient = prisma
) {
  return db.companyGoogleConnection.create({ data });
}

export async function updateCompanyGoogleConnection(
  id: string,
  data: Prisma.CompanyGoogleConnectionUpdateInput,
  db: PrismaClient = prisma
) {
  return db.companyGoogleConnection.update({ where: { id }, data });
}

export async function compareAndSetCompanyGoogleTokens(
  input: {
    id: string;
    expectedTokenVersion: number;
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string;
    tokenExpiresAt: Date;
    tokenType?: string | null;
    scopes?: Prisma.InputJsonValue;
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; tokenVersion: number }
  | { ok: false; reason: "not_found" | "stale_version" | "disconnected" }
> {
  const id = input.id.trim();
  if (!id) return { ok: false, reason: "not_found" };
  const updated = await db.companyGoogleConnection.updateMany({
    where: {
      id,
      connectionKey: COMPANY_GOOGLE_CONNECTION_KEY,
      tokenVersion: input.expectedTokenVersion,
      status: { in: [...ACTIVE_STATUSES] },
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
    const row = await db.companyGoogleConnection.findUnique({ where: { id } });
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, tokenVersion: row.tokenVersion };
  }
  const existing = await db.companyGoogleConnection.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "disconnected") return { ok: false, reason: "disconnected" };
  return { ok: false, reason: "stale_version" };
}

export async function wipeCompanyGoogleCredentials(id: string, db: PrismaClient = prisma) {
  return db.companyGoogleConnection.update({
    where: { id },
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

export async function createCompanyGooglePendingAuth(
  data: Prisma.CompanyGoogleOAuthPendingAuthCreateInput,
  db: PrismaClient = prisma
) {
  return db.companyGoogleOAuthPendingAuth.create({ data });
}

export async function consumeCompanyGooglePendingAuthOnce(
  input: { stateHash: string; now?: Date },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; row: CompanyGoogleOAuthPendingAuth }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" }
> {
  const now = input.now ?? new Date();
  const row = await db.companyGoogleOAuthPendingAuth.findUnique({
    where: { stateHash: input.stateHash },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.consumedAt) return { ok: false, reason: "already_consumed" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  const consumed = await db.companyGoogleOAuthPendingAuth.updateMany({
    where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return { ok: false, reason: "already_consumed" };
  const latest = await db.companyGoogleOAuthPendingAuth.findUnique({ where: { id: row.id } });
  if (!latest) return { ok: false, reason: "not_found" };
  return { ok: true, row: latest };
}

export async function wipeCompanyGooglePendingVerifier(id: string, db: PrismaClient = prisma) {
  await db.companyGoogleOAuthPendingAuth.update({
    where: { id },
    data: { pkceVerifierEncrypted: "" },
  });
}
