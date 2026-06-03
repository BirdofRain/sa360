import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function listClientAccounts(
  opts: { status?: string },
  db: PrismaClient = prisma
) {
  const where: Prisma.ClientAccountWhereInput = {};
  if (opts.status?.trim()) {
    where.status = opts.status.trim() as Prisma.EnumClientAccountStatusFilter["equals"];
  }
  return db.clientAccount.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: { ghlDestination: true },
  });
}

export async function findClientAccountById(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  return db.clientAccount.findUnique({
    where: { clientAccountId: clientAccountId.trim() },
    include: { ghlDestination: true },
  });
}

export async function findClientAccountByPortalLoginEmail(
  loginEmail: string,
  db: PrismaClient = prisma
) {
  const normalized = loginEmail.trim().toLowerCase();
  if (!normalized) return null;
  return db.clientAccount.findFirst({
    where: {
      portalLoginEmail: { equals: normalized, mode: "insensitive" },
    },
    include: { ghlDestination: true },
  });
}

export async function createClientAccount(
  data: Prisma.ClientAccountCreateInput,
  db: PrismaClient = prisma
) {
  return db.clientAccount.create({ data, include: { ghlDestination: true } });
}

export async function updateClientAccount(
  clientAccountId: string,
  data: Prisma.ClientAccountUpdateInput,
  db: PrismaClient = prisma
) {
  return db.clientAccount.update({
    where: { clientAccountId: clientAccountId.trim() },
    data,
    include: { ghlDestination: true },
  });
}

export async function deleteClientAccountById(
  clientAccountId: string,
  db: PrismaClient = prisma
) {
  const id = clientAccountId.trim();
  return db.$transaction(async (tx) => {
    await tx.campaignRoutingRule.deleteMany({ where: { clientAccountId: id } });
    await tx.ghlLocationConnection.updateMany({
      where: { clientAccountId: id },
      data: { clientAccountId: null },
    });
    return tx.clientAccount.delete({ where: { clientAccountId: id } });
  });
}

export async function upsertClientGhlDestination(
  clientAccountId: string,
  data: Omit<Prisma.ClientGhlDestinationCreateInput, "clientAccount">,
  db: PrismaClient = prisma
) {
  const id = clientAccountId.trim();
  return db.clientGhlDestination.upsert({
    where: { clientAccountId: id },
    create: {
      ...data,
      clientAccount: { connect: { clientAccountId: id } },
    },
    update: data,
  });
}
