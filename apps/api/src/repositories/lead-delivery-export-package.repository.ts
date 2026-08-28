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
  spreadsheetDeliveredAt: Date;
  createdAt: Date;
  metadataJson: Prisma.JsonValue | null;
  leadOrder: {
    orderNumber: string;
    clientDisplayName: string | null;
    nicheKey: string;
    statesJson: Prisma.JsonValue;
  };
};

function asReleasedRow(
  row: Prisma.LeadDeliveryExportPackageGetPayload<{ select: typeof releasedPackageSelect }>
): ReleasedLeadDeliveryExportPackageRow | null {
  if (!row.spreadsheetDeliveredAt) return null;
  return {
    id: row.id,
    leadOrderId: row.leadOrderId,
    clientAccountId: row.clientAccountId,
    rowCount: row.rowCount,
    csvContent: row.csvContent,
    spreadsheetDeliveredAt: row.spreadsheetDeliveredAt,
    createdAt: row.createdAt,
    metadataJson: row.metadataJson,
    leadOrder: row.leadOrder,
  };
}

const releasedWhere = (input: {
  leadOrderId: string;
  clientAccountId: string;
  exportId?: string;
}): Prisma.LeadDeliveryExportPackageWhereInput => ({
  leadOrderId: input.leadOrderId.trim(),
  clientAccountId: input.clientAccountId.trim(),
  spreadsheetDeliveredAt: { not: null },
  ...(input.exportId ? { id: input.exportId.trim() } : {}),
});

export async function listReleasedLeadDeliveryExportPackagesForOrder(
  input: { leadOrderId: string; clientAccountId: string },
  db: PrismaClient = prisma
): Promise<ReleasedLeadDeliveryExportPackageRow[]> {
  const rows = await db.leadDeliveryExportPackage.findMany({
    where: releasedWhere(input),
    orderBy: [{ spreadsheetDeliveredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: releasedPackageSelect,
  });
  return rows
    .map(asReleasedRow)
    .filter((row): row is ReleasedLeadDeliveryExportPackageRow => row != null);
}

export async function findReleasedLeadDeliveryExportPackageForClient(
  input: { exportId: string; leadOrderId: string; clientAccountId: string },
  db: PrismaClient = prisma
): Promise<ReleasedLeadDeliveryExportPackageRow | null> {
  const row = await db.leadDeliveryExportPackage.findFirst({
    where: releasedWhere(input),
    select: releasedPackageSelect,
  });
  return row ? asReleasedRow(row) : null;
}
