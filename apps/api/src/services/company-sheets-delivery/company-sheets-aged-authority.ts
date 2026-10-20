import type { LeadDeliveryExportPackage, LeadOrder, LeadOrderStatus, PrismaClient } from "@prisma/client";

import { parseCsvDocument, sha256Hex } from "../ppl-fulfillment/buyer-csv-export.service.js";

/**
 * Order states that may carry a client-released export package.
 * Draft, setup, held (paused), and revoked (canceled) orders cannot.
 * Order status is not the release. The package must also have the operator
 * Approve & Release mark. This module reads that mark and does not write it.
 * Supersession is not a stored package state; a later package does not revoke an earlier one.
 */
const AUTHORIZED_RELEASE_ORDER_STATUSES: ReadonlySet<LeadOrderStatus> = new Set([
  "ready",
  "active",
  "completed",
]);

export type AgedAuthorityFailure = { ok: false; code: string };

export type AuthorizedAgedDeliverySet = {
  ok: true;
  packageRow: LeadDeliveryExportPackage;
  order: LeadOrder;
  schemaVersion: string;
  header: string[];
  rows: Array<{ stableRowId: string; values: string[] }>;
};

function blankRow(row: string[] | undefined): boolean {
  return !row || row.every((cell) => cell.trim() === "");
}

function orderReleaseCode(status: LeadOrderStatus): string | null {
  if (status === "draft") return "order_draft";
  if (status === "paused") return "order_held";
  if (status === "canceled") return "order_revoked";
  if (!AUTHORIZED_RELEASE_ORDER_STATUSES.has(status)) return "release_not_authorized";
  return null;
}

/**
 * The authorized aged set is the stored export package, not caller rows.
 * Inventory is not reselected. The operator receipt is required and is not written.
 */
export async function loadAuthorizedAgedDeliverySet(
  db: PrismaClient,
  exportPackageId: string
): Promise<AuthorizedAgedDeliverySet | AgedAuthorityFailure> {
  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportPackageId.trim() },
  });
  if (!packageRow) return { ok: false, code: "export_not_found" };
  if (sha256Hex(packageRow.csvContent) !== packageRow.contentSha256) {
    return { ok: false, code: "csv_integrity_mismatch" };
  }
  const schemaVersion = packageRow.fieldSchemaVersion.trim();
  if (!schemaVersion) return { ok: false, code: "schema_mismatch" };
  const order = await db.leadOrder.findUnique({ where: { id: packageRow.leadOrderId } });
  if (!order || order.clientAccountId !== packageRow.clientAccountId) {
    return { ok: false, code: "order_client_mismatch" };
  }
  const releaseCode = orderReleaseCode(order.status);
  if (releaseCode) return { ok: false, code: releaseCode };
  if (!packageRow.spreadsheetDeliveredAt) return { ok: false, code: "package_not_released" };
  const parsed = parseCsvDocument(packageRow.csvContent);
  const csvHeader = parsed[0] ?? [];
  const dataRows = parsed.slice(1).filter((row) => !blankRow(row));
  const allocationIds = Array.isArray(packageRow.allocationIdsJson)
    ? packageRow.allocationIdsJson.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (csvHeader.length === 0 || dataRows.length === 0) return { ok: false, code: "csv_empty" };
  if (dataRows.length !== packageRow.rowCount || allocationIds.length !== dataRows.length) {
    return { ok: false, code: "row_count_mismatch" };
  }
  const header = ["delivery_row_id", ...csvHeader];
  const rows = dataRows.map((row, index) => {
    const stableRowId = `release:${packageRow.clientAccountId}:${order.id}:${packageRow.id}:${allocationIds[index]}`;
    const padded = csvHeader.map((_, cellIndex) => row[cellIndex] ?? "");
    return { stableRowId, values: [stableRowId, ...padded] };
  });
  return { ok: true, packageRow, order, schemaVersion, header, rows };
}
