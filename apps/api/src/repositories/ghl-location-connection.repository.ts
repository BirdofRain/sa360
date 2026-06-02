import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function findGhlLocationConnectionById(id: string, db: PrismaClient = prisma) {
  return db.ghlLocationConnection.findUnique({ where: { id } });
}

export async function findGhlLocationConnectionByLocationId(
  locationId: string,
  db: PrismaClient = prisma
) {
  return db.ghlLocationConnection.findUnique({ where: { locationId: locationId.trim() } });
}

export async function listGhlLocationConnections(
  opts: { clientAccountId?: string; connectionStatus?: string; limit?: number },
  db: PrismaClient = prisma
) {
  const where: Prisma.GhlLocationConnectionWhereInput = {};
  if (opts.clientAccountId?.trim()) {
    where.clientAccountId = opts.clientAccountId.trim();
  }
  if (opts.connectionStatus?.trim()) {
    where.connectionStatus = opts.connectionStatus.trim();
  }
  return db.ghlLocationConnection.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 100, 1), 200),
  });
}

export async function upsertGhlLocationConnection(
  locationId: string,
  data: Omit<Prisma.GhlLocationConnectionCreateInput, "locationId">,
  db: PrismaClient = prisma
) {
  return db.ghlLocationConnection.upsert({
    where: { locationId: locationId.trim() },
    create: { locationId: locationId.trim(), ...data },
    update: { ...data, updatedAt: new Date() },
  });
}

export async function updateGhlLocationConnection(
  id: string,
  data: Prisma.GhlLocationConnectionUpdateInput,
  db: PrismaClient = prisma
) {
  return db.ghlLocationConnection.update({ where: { id }, data });
}

export async function deleteGhlLocationConnection(id: string, db: PrismaClient = prisma) {
  return db.ghlLocationConnection.delete({ where: { id } });
}
