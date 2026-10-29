import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { ongoingActivationInvalidationPatch } from "../services/ongoing-ghl-activation-rules.js";
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

export async function findClientAccountsByIds(
  clientAccountIds: string[],
  db: PrismaClient = prisma
) {
  const ids = [...new Set(clientAccountIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  return db.clientAccount.findMany({
    where: { clientAccountId: { in: ids } },
    select: { clientAccountId: true, clientDisplayName: true },
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

export async function findClientAccountByPortalInviteTokenHash(
  tokenHash: string,
  db: PrismaClient = prisma
) {
  const hash = tokenHash.trim();
  if (!hash) return null;
  return db.clientAccount.findUnique({
    where: { portalInviteTokenHash: hash },
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

export async function findClientGhlDestinationsByClientIds(
  clientAccountIds: string[],
  db: PrismaClient = prisma
) {
  const ids = [...new Set(clientAccountIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  return db.clientGhlDestination.findMany({
    where: { clientAccountId: { in: ids } },
  });
}

function textField(data: object, key: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return undefined;
  const value = (data as Record<string, unknown>)[key];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export async function upsertClientGhlDestination(
  clientAccountId: string,
  data: Omit<Prisma.ClientGhlDestinationCreateInput, "clientAccount">,
  db: PrismaClient = prisma
) {
  const id = clientAccountId.trim();
  const existing = await db.clientGhlDestination.findUnique({ where: { clientAccountId: id } });
  const invalidation = existing
    ? ongoingActivationInvalidationPatch(existing, {
        destinationSubaccountIdGhl: textField(data, "destinationSubaccountIdGhl"),
        destinationWorkflowIdGhl: textField(data, "destinationWorkflowIdGhl"),
        destinationPipelineIdGhl: textField(data, "destinationPipelineIdGhl"),
        destinationPipelineStageIdGhl: textField(data, "destinationPipelineStageIdGhl"),
      })
    : null;
  const next = invalidation ? { ...data, ...invalidation } : data;
  const saved = await db.clientGhlDestination.upsert({
    where: { clientAccountId: id },
    create: {
      ...next,
      clientAccount: { connect: { clientAccountId: id } },
    },
    update: next,
  });
  if (invalidation) {
    try {
      await db.clientOnboardingV2AuditEvent.create({
        data: {
          clientAccountId: id,
          historicalClientAccountId: id,
          requestId: `ghl-ongoing-invalidate:${randomUUID()}`,
          action: "ghl_ongoing_activation_invalidated",
          auth: "admin_api_key",
          destinations: [],
          metadataJson: {
            reason: "destination_resources_changed",
            sendsLead: false,
          },
        },
      });
    } catch {
      // The destination clear already committed. Delivery stays off.
    }
  }
  return saved;
}
