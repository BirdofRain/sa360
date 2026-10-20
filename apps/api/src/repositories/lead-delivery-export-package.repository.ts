import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

const releasedPackageSelect = {
  id: true,
  leadOrderId: true,
  clientAccountId: true,
  rowCount: true,
  csvContent: true,
  spreadsheetDeliveredAt: true,
  createdAt: true,
  metadataJson: true,
  leadOrder: {
    select: {
      orderNumber: true,
      clientDisplayName: true,
      nicheKey: true,
      statesJson: true,
    },
  },
} satisfies Prisma.LeadDeliveryExportPackageSelect;

export type ReleasedLeadDeliveryExportPackageRow = {
  id: string;
  leadOrderId: string;
  clientAccountId: string;
  rowCount: number;
  csvContent: string;
  /** Operator Approve & Release. Null when only a verified Sheets write authorizes the CSV. */
  spreadsheetDeliveredAt: Date | null;
  /** Operator receipt, or the verified Sheets evidence time when the receipt is absent. */
  clientDownloadAuthorizedAt: Date;
  createdAt: Date;
  metadataJson: Prisma.JsonValue | null;
  leadOrder: {
    orderNumber: string;
    clientDisplayName: string | null;
    nicheKey: string;
    statesJson: Prisma.JsonValue;
  };
};

type ReleasedPackagePayload = Prisma.LeadDeliveryExportPackageGetPayload<{
  select: typeof releasedPackageSelect;
}>;

function asReleasedRow(
  row: ReleasedPackagePayload,
  sheetsAuthorizedAt: Date | null
): ReleasedLeadDeliveryExportPackageRow | null {
  const clientDownloadAuthorizedAt = row.spreadsheetDeliveredAt ?? sheetsAuthorizedAt;
  if (!clientDownloadAuthorizedAt) return null;
  return {
    id: row.id,
    leadOrderId: row.leadOrderId,
    clientAccountId: row.clientAccountId,
    rowCount: row.rowCount,
    csvContent: row.csvContent,
    spreadsheetDeliveredAt: row.spreadsheetDeliveredAt,
    clientDownloadAuthorizedAt,
    createdAt: row.createdAt,
    metadataJson: row.metadataJson,
    leadOrder: row.leadOrder,
  };
}

/**
 * A succeeded job plus succeeded evidence is a verified automated delivery.
 * Queued, running, retryable, and uncertain jobs do not authorize a download.
 */
async function verifiedSheetsAuthorization(
  db: PrismaClient,
  input: { leadOrderId: string; clientAccountId: string; exportId?: string }
): Promise<Map<string, Date>> {
  const rows = await db.companySheetsOrderDeliveryEvidence.findMany({
    where: {
      leadOrderId: input.leadOrderId.trim(),
      clientAccountId: input.clientAccountId.trim(),
      status: "succeeded",
      job: { status: "succeeded" },
      ...(input.exportId ? { exportPackageId: input.exportId.trim() } : {}),
    },
    select: { exportPackageId: true, updatedAt: true },
  });
  const authorized = new Map<string, Date>();
  for (const row of rows) authorized.set(row.exportPackageId, row.updatedAt);
  return authorized;
}

function releasedWhere(
  input: { leadOrderId: string; clientAccountId: string; exportId?: string },
  sheetsPackageIds: string[]
): Prisma.LeadDeliveryExportPackageWhereInput {
  const scope: Prisma.LeadDeliveryExportPackageWhereInput = {
    leadOrderId: input.leadOrderId.trim(),
    clientAccountId: input.clientAccountId.trim(),
    ...(input.exportId ? { id: input.exportId.trim() } : {}),
  };
  const sheetsIds = input.exportId
    ? sheetsPackageIds.filter((id) => id === input.exportId?.trim())
    : sheetsPackageIds;
  return {
    AND: [
      scope,
      {
        OR: [
          { spreadsheetDeliveredAt: { not: null } },
          ...(sheetsIds.length > 0 ? [{ id: { in: sheetsIds } }] : []),
        ],
      },
    ],
  };
}

function byClientAuthorization(
  left: ReleasedLeadDeliveryExportPackageRow,
  right: ReleasedLeadDeliveryExportPackageRow
): number {
  const byAuth = left.clientDownloadAuthorizedAt.getTime() - right.clientDownloadAuthorizedAt.getTime();
  if (byAuth !== 0) return byAuth;
  const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export async function listReleasedLeadDeliveryExportPackagesForOrder(
  input: { leadOrderId: string; clientAccountId: string },
  db: PrismaClient = prisma
): Promise<ReleasedLeadDeliveryExportPackageRow[]> {
  const sheets = await verifiedSheetsAuthorization(db, input);
  const rows = await db.leadDeliveryExportPackage.findMany({
    where: releasedWhere(input, [...sheets.keys()]),
    select: releasedPackageSelect,
  });
  return rows
    .map((row) => asReleasedRow(row, sheets.get(row.id) ?? null))
    .filter((row): row is ReleasedLeadDeliveryExportPackageRow => row != null)
    .sort(byClientAuthorization);
}

export async function findReleasedLeadDeliveryExportPackageForClient(
  input: { exportId: string; leadOrderId: string; clientAccountId: string },
  db: PrismaClient = prisma
): Promise<ReleasedLeadDeliveryExportPackageRow | null> {
  const sheets = await verifiedSheetsAuthorization(db, input);
  const row = await db.leadDeliveryExportPackage.findFirst({
    where: releasedWhere(input, [...sheets.keys()]),
    select: releasedPackageSelect,
  });
  return row ? asReleasedRow(row, sheets.get(row.id) ?? null) : null;
}
