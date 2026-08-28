import { buildOperatorBuyerCsvFilename } from "../ppl-fulfillment/buyer-csv-filename.js";
import type { ReleasedLeadDeliveryExportPackageRow } from "../../repositories/lead-delivery-export-package.repository.js";

export type ClientReleasedDelivery = {
  id: string;
  orderId: string;
  filename: string;
  displayFilename: string;
  releasedAt: string;
  leadCount: number;
  downloadAvailable: true;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseStatesJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function presentClientReleasedDelivery(
  row: ReleasedLeadDeliveryExportPackageRow
): ClientReleasedDelivery {
  const metadata = asRecord(row.metadataJson);
  const niche =
    typeof metadata?.niche === "string" && metadata.niche.trim()
      ? metadata.niche
      : row.leadOrder.nicheKey;
  const filename = buildOperatorBuyerCsvFilename({
    clientDisplayName: row.leadOrder.clientDisplayName,
    clientAccountId: row.clientAccountId,
    orderNumber: row.leadOrder.orderNumber,
    nicheKey: niche,
    states: parseStatesJson(row.leadOrder.statesJson),
    commerceAgeBucketKey:
      typeof metadata?.commerceAgeBucketKey === "string" ? metadata.commerceAgeBucketKey : null,
    rowCount: row.rowCount,
  });
  return {
    id: row.id,
    orderId: row.leadOrderId,
    filename,
    displayFilename: filename,
    releasedAt: row.spreadsheetDeliveredAt.toISOString(),
    leadCount: row.rowCount,
    downloadAvailable: true,
  };
}

export function assertClientReleasedDeliveryIsSafe(item: Record<string, unknown>): void {
  const forbidden = [
    "allocationIds",
    "allocationIdsJson",
    "csvContent",
    "contentSha256",
    "idempotencyKey",
    "spreadsheetDeliveryIdempotencyKey",
    "spreadsheetDeliveredBy",
    "spreadsheetDeliveryEvidenceJson",
    "createdBy",
    "metadataJson",
    "adminNotes",
    "path",
    "filePath",
    "storagePath",
  ];
  for (const key of forbidden) {
    if (Object.hasOwn(item, key)) {
      throw new Error(`customer_delivery_leaked:${key}`);
    }
  }
}
