import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { buildOperatorBuyerCsvFilename } from "./buyer-csv-filename.js";
import {
  commitBuyerCsvExport,
  getBuyerCsvExportDownload,
  markSpreadsheetDelivered,
  previewBuyerCsvExport,
  type BuyerCsvExportCommitResult,
  type BuyerCsvExportPreview,
  type SpreadsheetDeliveryResult,
} from "./buyer-csv-export.service.js";
import {
  resolveExportAllocationPricing,
  type ExportAllocationPricing,
  type ExportAllocationPricingResult,
  type ExportLinePricingFailureCode,
} from "./ppl-order-pricing.js";

const EXPORTABLE_ALLOCATION_STATUSES = ["reserved", "delivering", "committed"] as const;

export type LineAwareExportFailure = {
  ok: false;
  code: ExportLinePricingFailureCode;
  details?: Record<string, unknown>;
};

type CommitSuccess = Extract<BuyerCsvExportCommitResult, { ok: true }>;

export type LineAwareBuyerCsvCommitResult =
  | (CommitSuccess & { linePricing: ExportAllocationPricing })
  | Exclude<BuyerCsvExportCommitResult, { ok: true }>
  | LineAwareExportFailure;

export type LineAwareBuyerCsvPreviewResult =
  | (BuyerCsvExportPreview & { linePricing: ExportAllocationPricing })
  | Exclude<BuyerCsvExportCommitResult, { ok: true }>
  | LineAwareExportFailure;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function loadOrderLines(orderId: string, db: PrismaClient) {
  if (!db.leadOrderLine?.findMany) return [];
  return db.leadOrderLine.findMany({
    where: { leadOrderId: orderId },
    orderBy: { lineNumber: "asc" },
  });
}

async function priceAllocations(
  orderId: string,
  allocationIds: readonly string[],
  db: PrismaClient
): Promise<ExportAllocationPricingResult> {
  const [lines, allocations] = await Promise.all([
    loadOrderLines(orderId, db),
    allocationIds.length === 0
      ? Promise.resolve([])
      : db.leadAllocation.findMany({
          where: { id: { in: [...allocationIds] }, leadOrderId: orderId },
          select: { id: true, leadOrderLineId: true },
        }),
  ]);
  const byId = new Map(allocations.map((row) => [row.id, row]));
  const ordered = allocationIds.map((id) => byId.get(id) ?? { id, leadOrderLineId: null });
  return resolveExportAllocationPricing(lines, ordered);
}

async function priceExportableOrder(
  orderId: string,
  db: PrismaClient
): Promise<ExportAllocationPricingResult | { ok: true; pricing: null }> {
  const allocations = await db.leadAllocation.findMany({
    where: {
      leadOrderId: orderId,
      status: { in: [...EXPORTABLE_ALLOCATION_STATUSES] },
      leadInventoryItemId: { not: null },
    },
    select: { id: true, leadOrderLineId: true },
    orderBy: [{ proposedAt: "asc" }, { id: "asc" }],
  });
  if (allocations.length === 0) return { ok: true, pricing: null };
  return priceAllocations(
    orderId,
    allocations.map((row) => row.id),
    db
  );
}

function filenameForPricing(input: {
  clientDisplayName?: string | null;
  clientAccountId: string;
  orderNumber: string;
  nicheKey: string;
  statesJson?: unknown;
  pricing: ExportAllocationPricing;
  rowCount: number;
}): string {
  return buildOperatorBuyerCsvFilename({
    clientDisplayName: input.clientDisplayName,
    clientAccountId: input.clientAccountId,
    orderNumber: input.orderNumber,
    nicheKey: input.nicheKey,
    states: parseStates(input.statesJson),
    commerceAgeBucketKey: input.pricing.commerceAgeBucketKey,
    rowCount: input.rowCount,
  });
}

async function writeLineAwareMetadata(
  exportId: string,
  db: PrismaClient
): Promise<
  | { ok: true; linePricing: ExportAllocationPricing; filename: string; metadata: Record<string, unknown> }
  | LineAwareExportFailure
  | { ok: false; code: "export_not_found" }
> {
  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId },
    include: {
      leadOrder: {
        select: {
          id: true,
          orderNumber: true,
          clientDisplayName: true,
          nicheKey: true,
          statesJson: true,
        },
      },
    },
  });
  if (!packageRow) return { ok: false, code: "export_not_found" };
  const allocationIds = Array.isArray(packageRow.allocationIdsJson)
    ? packageRow.allocationIdsJson.filter((id): id is string => typeof id === "string")
    : [];
  const priced = await priceAllocations(packageRow.leadOrderId, allocationIds, db);
  if (!priced.ok) return { ok: false, code: priced.code, details: { reasons: priced.reasons } };

  const previous = asRecord(packageRow.metadataJson) ?? {};
  const metadata: Record<string, unknown> = {
    ...previous,
    commerceAgeBucketKey: priced.pricing.commerceAgeBucketKey,
    pricingVersion: priced.pricing.pricingVersion ?? previous.pricingVersion ?? null,
    unitPriceCents: priced.pricing.unitPriceCents,
    requestedQuantity: priced.pricing.requestedQuantity ?? previous.requestedQuantity ?? null,
    linePricing: priced.pricing,
  };
  await db.leadDeliveryExportPackage.update({
    where: { id: packageRow.id },
    data: { metadataJson: metadata as Prisma.InputJsonValue },
  });
  const niche =
    typeof previous.niche === "string" && previous.niche.trim()
      ? previous.niche
      : packageRow.leadOrder.nicheKey;
  return {
    ok: true,
    linePricing: priced.pricing,
    metadata,
    filename: filenameForPricing({
      clientDisplayName: packageRow.leadOrder.clientDisplayName,
      clientAccountId: packageRow.clientAccountId,
      orderNumber: packageRow.leadOrder.orderNumber,
      nicheKey: niche,
      statesJson: packageRow.leadOrder.statesJson,
      pricing: priced.pricing,
      rowCount: packageRow.rowCount,
    }),
  };
}

export async function previewLineAwareBuyerCsvExport(
  input: { orderId: string },
  db: PrismaClient = prisma
): Promise<LineAwareBuyerCsvPreviewResult> {
  const priced = await priceExportableOrder(input.orderId.trim(), db);
  if (!priced.ok) return { ok: false, code: priced.code, details: { reasons: priced.reasons } };
  const preview = await previewBuyerCsvExport(input, db);
  if (!preview.ok) return preview;
  if (!("columns" in preview)) {
    return { ok: false, code: "no_exportable_allocations" };
  }
  const committedPricing = await priceAllocations(preview.orderId, preview.allocationIds, db);
  if (!committedPricing.ok) {
    return { ok: false, code: committedPricing.code, details: { reasons: committedPricing.reasons } };
  }
  return { ...preview, linePricing: committedPricing.pricing };
}

export async function commitLineAwareBuyerCsvExport(
  input: {
    orderId: string;
    idempotencyKey: string;
    createdBy?: string | null;
  },
  db: PrismaClient = prisma
): Promise<LineAwareBuyerCsvCommitResult> {
  const orderId = input.orderId.trim();
  const pre = await priceExportableOrder(orderId, db);
  if (!pre.ok) return { ok: false, code: pre.code, details: { reasons: pre.reasons } };

  const committed = await commitBuyerCsvExport(input, db);
  if (!committed.ok) return committed;

  const written = await writeLineAwareMetadata(committed.exportId, db);
  if (!written.ok) {
    if (written.code === "export_not_found") {
      return { ok: false, code: "export_line_not_found", details: { reason: "export_not_found" } };
    }
    return written;
  }
  return {
    ...committed,
    filename: written.filename,
    metadata: written.metadata as CommitSuccess["metadata"],
    linePricing: written.linePricing,
  };
}

const COUNTED_ALLOCATION_STATUSES = ["reserved", "delivering", "committed", "review_required"] as const;

/**
 * Spreadsheet delivery stays in the existing export service.
 * Order and line counters are rewritten from current allocation counts, so a
 * delivery retry converges on the same totals and cannot increment them again.
 */
export async function markSpreadsheetDeliveredLineAware(
  input: {
    exportId: string;
    confirmationPhrase: string;
    idempotencyKey: string;
    deliveredBy?: string | null;
  },
  db: PrismaClient = prisma
): Promise<SpreadsheetDeliveryResult> {
  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: input.exportId.trim() },
    select: { leadOrderId: true },
  });
  const delivered = await markSpreadsheetDelivered(input, db);
  if (!delivered.ok) return delivered;
  const orderId = packageRow?.leadOrderId ?? delivered.orderId;
  if (orderId) await reconcileDeliveredAllocationCounters(orderId, db);
  return delivered;
}

async function reconcileDeliveredAllocationCounters(orderId: string, db: PrismaClient): Promise<void> {
  const groups = await db.leadAllocation.groupBy({
    by: ["leadOrderLineId", "status"],
    where: {
      leadOrderId: orderId,
      releasedAt: null,
      status: { in: [...COUNTED_ALLOCATION_STATUSES] },
    },
    _count: { _all: true },
  });
  let reservedQuantity = 0;
  let fulfilledQuantity = 0;
  const lines = new Map<string, { reservedQuantity: number; fulfilledQuantity: number }>();
  for (const group of groups) {
    const count = group._count._all;
    const fulfilled = group.status === "committed";
    if (fulfilled) fulfilledQuantity += count;
    else reservedQuantity += count;
    if (!group.leadOrderLineId) continue;
    const bucket = lines.get(group.leadOrderLineId) ?? { reservedQuantity: 0, fulfilledQuantity: 0 };
    if (fulfilled) bucket.fulfilledQuantity += count;
    else bucket.reservedQuantity += count;
    lines.set(group.leadOrderLineId, bucket);
  }

  await db.$transaction(async (tx) => {
    await tx.leadOrder.update({
      where: { id: orderId },
      data: { reservedQuantity, fulfilledQuantity },
    });
    if (!tx.leadOrderLine?.findMany) return;
    const orderLines = await tx.leadOrderLine.findMany({
      where: { leadOrderId: orderId },
      select: { id: true },
    });
    for (const line of orderLines) {
      const bucket = lines.get(line.id) ?? { reservedQuantity: 0, fulfilledQuantity: 0 };
      await tx.leadOrderLine.update({
        where: { id: line.id },
        data: bucket,
      });
    }
  });
}

export async function readBuyerCsvExportLinePricing(
  exportId: string,
  db: PrismaClient = prisma
): Promise<ExportAllocationPricing | null> {
  const download = await getBuyerCsvExportDownload(exportId, db);
  if (!download.ok) return null;
  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId },
    select: { metadataJson: true },
  });
  const metadata = asRecord(packageRow?.metadataJson);
  const linePricing = metadata?.linePricing;
  if (!linePricing || typeof linePricing !== "object") return null;
  return linePricing as ExportAllocationPricing;
}
