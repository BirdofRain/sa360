import type { Prisma, PrismaClient } from "@prisma/client";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  isCompanyGoogleSheetsDispatchEnabled,
} from "../../lib/company-google-sheets-env.js";

type DispatchDb = PrismaClient | Prisma.TransactionClient;

/**
 * Inserts a schedule row in the caller's transaction. Does not call Google
 * and does not create a delivery job. Flag off inserts nothing.
 */
export async function recordCompanySheetsCampaignIntent(
  input: {
    sourceLeadEventId: string;
    status: string;
    clientAccountId: string | null;
    resolvedAt: Date;
  },
  db: DispatchDb,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!isCompanyGoogleSheetsDispatchEnabled(env)) return;
  if (input.status !== "routing_matched") return;
  const clientAccountId = input.clientAccountId?.trim() ?? "";
  if (!clientAccountId) return;
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  if (!destination?.campaignDispatchEnabled || !destination.campaignDispatchNotBefore) return;
  if (input.resolvedAt < destination.campaignDispatchNotBefore) return;
  const tab = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
  });
  const ready =
    tab?.setupState === "bound" &&
    tab.worksheetId != null &&
    tab.schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION;
  await db.companySheetsDispatchIntent.upsert({
    where: { idempotencyKey: `campaign:${clientAccountId}:${input.sourceLeadEventId}` },
    create: {
      idempotencyKey: `campaign:${clientAccountId}:${input.sourceLeadEventId}`,
      kind: "campaign_lead",
      status: ready ? "pending" : "awaiting_setup",
      clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      reason: ready ? null : "tab_missing",
    },
    update: {},
  });
}

/**
 * Records an aged release at Approve & Release time.
 * `createdAt` is that release time, compared with the client cutoff and tab bind.
 * A release recorded before the aged tab was bound stays needs_explicit_schedule.
 */
export async function recordCompanySheetsAgedIntent(
  input: {
    exportPackageId: string;
    clientAccountId: string;
    leadOrderId: string;
    createdAt: Date;
  },
  db: DispatchDb,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!isCompanyGoogleSheetsDispatchEnabled(env)) return;
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: input.clientAccountId },
  });
  if (!destination?.agedDispatchEnabled || !destination.agedDispatchNotBefore) return;
  if (input.createdAt < destination.agedDispatchNotBefore) return;
  const tab = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: destination.id, role: "aged" } },
  });
  const ready =
    tab?.setupState === "bound" &&
    tab.worksheetId != null &&
    tab.boundAt != null &&
    input.createdAt >= tab.boundAt;
  await db.companySheetsDispatchIntent.upsert({
    where: {
      idempotencyKey: `release:${input.clientAccountId}:${input.leadOrderId}:${input.exportPackageId}`,
    },
    create: {
      idempotencyKey: `release:${input.clientAccountId}:${input.leadOrderId}:${input.exportPackageId}`,
      kind: "aged_release",
      status: ready ? "pending" : "needs_explicit_schedule",
      clientAccountId: input.clientAccountId,
      exportPackageId: input.exportPackageId,
      leadOrderId: input.leadOrderId,
      reason: ready ? null : "release_preceded_setup",
    },
    update: {},
  });
}
