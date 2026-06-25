import type { Prisma, PrismaClient, ClientChannelProfileConfig } from "@prisma/client";
import { prisma } from "../lib/db.js";

/** Normalize subaccount scoping to "" (empty string) so the composite unique works reliably. */
export function normalizeSubaccountKey(subaccountIdGhl?: string | null): string {
  return subaccountIdGhl?.trim() ?? "";
}

export async function findClientChannelProfile(
  clientAccountId: string,
  subaccountIdGhl?: string | null,
  db: PrismaClient = prisma
): Promise<ClientChannelProfileConfig | null> {
  return db.clientChannelProfileConfig.findUnique({
    where: {
      clientAccountId_subaccountIdGhl: {
        clientAccountId: clientAccountId.trim(),
        subaccountIdGhl: normalizeSubaccountKey(subaccountIdGhl),
      },
    },
  });
}

/** Stamp lastAppliedAt after a successful live mirror. No-op when the row does not exist. */
export async function touchClientChannelProfileLastApplied(
  clientAccountId: string,
  subaccountIdGhl: string | null | undefined,
  appliedAt: Date,
  db: PrismaClient = prisma
): Promise<void> {
  await db.clientChannelProfileConfig.updateMany({
    where: {
      clientAccountId: clientAccountId.trim(),
      subaccountIdGhl: normalizeSubaccountKey(subaccountIdGhl),
    },
    data: { lastAppliedAt: appliedAt },
  });
}

export async function upsertClientChannelProfile(
  clientAccountId: string,
  subaccountIdGhl: string | null | undefined,
  data: Omit<
    Prisma.ClientChannelProfileConfigCreateInput,
    "clientAccountId" | "subaccountIdGhl"
  >,
  db: PrismaClient = prisma
): Promise<ClientChannelProfileConfig> {
  const id = clientAccountId.trim();
  const sub = normalizeSubaccountKey(subaccountIdGhl);
  return db.clientChannelProfileConfig.upsert({
    where: {
      clientAccountId_subaccountIdGhl: { clientAccountId: id, subaccountIdGhl: sub },
    },
    create: { ...data, clientAccountId: id, subaccountIdGhl: sub },
    update: data,
  });
}
