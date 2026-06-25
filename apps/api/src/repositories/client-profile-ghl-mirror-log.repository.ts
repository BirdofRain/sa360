import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function createClientProfileGhlMirrorLog(
  data: Prisma.ClientProfileGhlMirrorLogCreateInput,
  db: PrismaClient = prisma
) {
  return db.clientProfileGhlMirrorLog.create({ data });
}

export async function findLatestClientProfileGhlMirrorLog(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.clientProfileGhlMirrorLog.findFirst({
    where: { clientAccountId: clientAccountId.trim() },
    orderBy: { createdAt: "desc" },
  });
}
