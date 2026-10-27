import type { Prisma, PrismaClient } from "@prisma/client";

import {
  companySheetsCampaignHeader,
  isCompanyGoogleSheetsDispatchEnabled,
} from "../../lib/company-google-sheets-env.js";
import { findPublishedColumnMap } from "../client-onboarding-v2/column-maps.js";

const CUSTOM_CAMPAIGN_SCHEMA = "company_sheets_campaign_custom_v1";

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
  const expectedHeader = companySheetsCampaignHeader(tab?.schemaVersion);
  const storedHeader = Array.isArray(tab?.headerContract)
    ? tab.headerContract.filter((cell): cell is string => typeof cell === "string")
    : [];
  let ready =
    tab?.setupState === "bound" &&
    tab.worksheetId != null &&
    expectedHeader != null &&
    storedHeader.length === expectedHeader.length &&
    expectedHeader.every((cell, index) => storedHeader[index] === cell);
  let reason: string | null = ready ? null : "tab_missing";
  if (
    !ready &&
    tab?.setupState === "bound" &&
    tab.schemaVersion === CUSTOM_CAMPAIGN_SCHEMA &&
    tab.worksheetId != null
  ) {
    const map = await findPublishedColumnMap(db, {
      clientAccountId,
      spreadsheetId: destination.spreadsheetId,
      worksheetId: tab.worksheetId,
      sourceFunnelId: null,
    });
    const snapshot = Array.isArray(map?.headerSnapshot)
      ? map.headerSnapshot.filter((cell): cell is string => typeof cell === "string")
      : [];
    const headerMatches =
      snapshot.length === storedHeader.length && snapshot.every((cell, index) => cell === storedHeader[index]);
    if (env.SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED?.trim() !== "true") reason = "custom_writer_disabled";
    else if (!map) reason = "mapping_required";
    else if (!headerMatches) reason = "header_changed";
    else {
      ready = true;
      reason = null;
    }
  }
  await db.companySheetsDispatchIntent.upsert({
    where: { idempotencyKey: `campaign:${clientAccountId}:${input.sourceLeadEventId}` },
    create: {
      idempotencyKey: `campaign:${clientAccountId}:${input.sourceLeadEventId}`,
      kind: "campaign_lead",
      status: ready ? "pending" : "awaiting_setup",
      clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      reason,
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
