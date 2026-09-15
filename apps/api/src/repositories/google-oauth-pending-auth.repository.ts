import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createGoogleOAuthPendingAuth(
  data: Prisma.GoogleOAuthPendingAuthCreateInput,
  db: PrismaClient = prisma
) {
  return db.googleOAuthPendingAuth.create({ data });
}

export async function findGoogleOAuthPendingAuthByStateHash(
  stateHash: string,
  db: PrismaClient = prisma
) {
  const hash = stateHash.trim();
  if (!hash) return null;
  return db.googleOAuthPendingAuth.findUnique({ where: { stateHash: hash } });
}

export type ConsumeGoogleOAuthPendingAuthInput = {
  stateHash: string;
  clientAccountId: string;
  now?: Date;
};

export type ConsumeGoogleOAuthPendingAuthResult =
  | { ok: true; row: NonNullable<Awaited<ReturnType<typeof findGoogleOAuthPendingAuthByStateHash>>> }
  | {
      ok: false;
      reason: "not_found" | "tenant_mismatch" | "expired" | "already_consumed";
    };

/**
 * Consume a pending OAuth row exactly once for the bound tenant.
 * Tenant mismatch, expiry, and replay all fail closed.
 */
export async function consumeGoogleOAuthPendingAuthOnce(
  input: ConsumeGoogleOAuthPendingAuthInput,
  db: PrismaClient = prisma
): Promise<ConsumeGoogleOAuthPendingAuthResult> {
  const stateHash = input.stateHash.trim();
  const clientAccountId = input.clientAccountId.trim();
  const now = input.now ?? new Date();
  if (!stateHash || !clientAccountId) return { ok: false, reason: "not_found" };

  const existing = await findGoogleOAuthPendingAuthByStateHash(stateHash, db);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.clientAccountId !== clientAccountId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  if (existing.consumedAt) return { ok: false, reason: "already_consumed" };
  if (existing.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const consumed = await db.googleOAuthPendingAuth.updateMany({
    where: {
      id: existing.id,
      clientAccountId,
      stateHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  if (consumed.count !== 1) {
    const again = await findGoogleOAuthPendingAuthByStateHash(stateHash, db);
    if (!again) return { ok: false, reason: "not_found" };
    if (again.clientAccountId !== clientAccountId) return { ok: false, reason: "tenant_mismatch" };
    if (again.consumedAt) return { ok: false, reason: "already_consumed" };
    if (again.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
    return { ok: false, reason: "already_consumed" };
  }

  const row = await db.googleOAuthPendingAuth.findUnique({ where: { id: existing.id } });
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, row };
}

export async function wipeConsumedGoogleOAuthPendingAuthVerifier(
  input: { id: string; clientAccountId: string },
  db: PrismaClient = prisma
) {
  const id = input.id.trim();
  const clientAccountId = input.clientAccountId.trim();
  if (!id || !clientAccountId) return null;
  const result = await db.googleOAuthPendingAuth.updateMany({
    where: { id, clientAccountId, consumedAt: { not: null } },
    data: { pkceVerifierEncrypted: "" },
  });
  if (result.count !== 1) return null;
  return db.googleOAuthPendingAuth.findFirst({ where: { id, clientAccountId } });
}
