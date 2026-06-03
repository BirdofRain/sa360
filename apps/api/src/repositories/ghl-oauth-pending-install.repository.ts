import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createGhlOAuthPendingInstall(
  data: Prisma.GhlOAuthPendingInstallCreateInput,
  db: PrismaClient = prisma
) {
  return db.ghlOAuthPendingInstall.create({ data });
}

export async function findGhlOAuthPendingInstallById(id: string, db: PrismaClient = prisma) {
  return db.ghlOAuthPendingInstall.findUnique({ where: { id } });
}

export async function listGhlOAuthPendingInstalls(
  opts: { status?: string; limit?: number },
  db: PrismaClient = prisma
) {
  const where: Prisma.GhlOAuthPendingInstallWhereInput = {};
  if (opts.status?.trim()) where.status = opts.status.trim();
  return db.ghlOAuthPendingInstall.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 100),
  });
}

export async function findReconcilableGhlOAuthPendingInstall(
  match: { companyId?: string | null; userId?: string | null; appId?: string | null },
  db: PrismaClient = prisma
) {
  const or: Prisma.GhlOAuthPendingInstallWhereInput[] = [];
  const companyId = match.companyId?.trim();
  const userId = match.userId?.trim();
  const appId = match.appId?.trim();
  if (companyId) or.push({ companyId });
  if (userId) or.push({ userId });
  if (appId) or.push({ appId });
  if (!or.length) return null;

  return db.ghlOAuthPendingInstall.findFirst({
    where: { status: "pending_location", OR: or },
    orderBy: { updatedAt: "desc" },
  });
}

export async function updateGhlOAuthPendingInstall(
  id: string,
  data: Prisma.GhlOAuthPendingInstallUpdateInput,
  db: PrismaClient = prisma
) {
  return db.ghlOAuthPendingInstall.update({ where: { id }, data });
}

export async function deleteGhlOAuthPendingInstall(id: string, db: PrismaClient = prisma) {
  return db.ghlOAuthPendingInstall.delete({ where: { id } });
}
