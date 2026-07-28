import { createHash } from "node:crypto";

import type { LeadAllocationStatus, Prisma, PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { prisma } from "../../lib/db.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { recordBuyerDeliveredIdentities } from "./buyer-delivery-history.service.js";

export const BUYER_CSV_FIELD_SCHEMA_VERSION = "buyer_csv_v1";
export const BUYER_CSV_FORMAT = "csv_v1";
export const BUYER_CSV_COLUMNS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "state",
  "lead_date",
  "niche",
] as const;
export const SPREADSHEET_DELIVERY_CONFIRM_PHRASE = "MARK SPREADSHEET DELIVERED";
export const SPREADSHEET_DELIVERY_EVIDENCE_NOTE = "MANUAL SPREADSHEET DELIVERY RECORDED";

export type BuyerCsvColumn = (typeof BUYER_CSV_COLUMNS)[number];

const EXPORTABLE_ALLOCATION_STATUSES: LeadAllocationStatus[] = [
  "reserved",
  "delivering",
  "committed",
];

export type BuyerCsvRow = Record<BuyerCsvColumn, string>;

export type BuyerCsvExportPreview = {
  ok: true;
  orderId: string;
  clientAccountId: string;
  orderNumber: string;
  rowCount: number;
  allocationIds: string[];
  fieldSchemaVersion: string;
  contentSha256: string;
  columns: readonly BuyerCsvColumn[];
};

export type BuyerCsvExportCommitResult =
  | {
      ok: true;
      exportId: string;
      orderId: string;
      clientAccountId: string;
      orderNumber: string;
      rowCount: number;
      allocationIds: string[];
      fieldSchemaVersion: string;
      contentSha256: string;
      filename: string;
      idempotentReplay: boolean;
    }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "order_not_found"
        | "no_exportable_allocations"
        | "row_count_mismatch"
        | "idempotency_conflict"
        | "forbidden_column";
      details?: Record<string, unknown>;
    };

export function isPplCsvExportEnabled(): boolean {
  return process.env.SA360_PPL_CSV_EXPORT_ENABLED === "true";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function assertBuyerCsvColumns(columns: string[]): void {
  const allowed = new Set<string>(BUYER_CSV_COLUMNS);
  for (const column of columns) {
    if (!allowed.has(column)) {
      throw new Error(`forbidden_column:${column}`);
    }
  }
}

export function leadDateOnlyUtc(generatedAt: Date): string {
  return generatedAt.toISOString().slice(0, 10);
}

export function extractBuyerCsvFields(input: {
  normalizedPayloadJson: unknown;
  generatedAt: Date;
  nicheKey: string;
}): BuyerCsvRow {
  const payload = asRecord(input.normalizedPayloadJson) ?? {};
  const contact = asRecord(payload.contact) ?? {};
  const identity = readNormalizedLeadIdentity(input.normalizedPayloadJson);

  return {
    first_name: readString(contact.first_name, contact.firstName, payload.first_name, payload.firstName),
    last_name: readString(contact.last_name, contact.lastName, payload.last_name, payload.lastName),
    phone: identity?.phoneE164 ?? readString(contact.phone_e164, contact.phone, payload.phone),
    email: identity?.email ?? readString(contact.email, payload.email),
    state: identity?.state ?? readString(contact.state, payload.state, payload.stateCode),
    lead_date: leadDateOnlyUtc(input.generatedAt),
    niche: input.nicheKey.trim(),
  };
}

export function serializeBuyerCsv(rows: BuyerCsvRow[]): string {
  assertBuyerCsvColumns([...BUYER_CSV_COLUMNS]);
  const lines = [BUYER_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(BUYER_CSV_COLUMNS.map((column) => csvEscape(row[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildBuyerCsvFilename(input: {
  clientAccountId: string;
  orderNumber: string;
  exportId: string;
}): string {
  const shortId = input.exportId.slice(0, 8);
  return `sa360-delivery_${input.clientAccountId}_${input.orderNumber}_${shortId}.csv`;
}

type ExportableAllocation = {
  id: string;
  status: LeadAllocationStatus;
  sourceLeadEventId: string;
  leadInventoryItemId: string | null;
  sourceLeadEvent: { normalizedPayloadJson: Prisma.JsonValue };
  leadInventoryItem: {
    id: string;
    generatedAt: Date;
    nicheKey: string;
    status: string;
  } | null;
};

async function loadExportableAllocations(
  orderId: string,
  db: PrismaClient
): Promise<{
  order: { id: string; clientAccountId: string; orderNumber: string; requestedQuantity: number | null } | null;
  allocations: ExportableAllocation[];
}> {
  const order = await db.leadOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      clientAccountId: true,
      orderNumber: true,
      requestedQuantity: true,
    },
  });
  if (!order) return { order: null, allocations: [] };

  const allocations = await db.leadAllocation.findMany({
    where: {
      leadOrderId: orderId,
      status: { in: EXPORTABLE_ALLOCATION_STATUSES },
      leadInventoryItemId: { not: null },
    },
    orderBy: [{ proposedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      sourceLeadEventId: true,
      leadInventoryItemId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
      leadInventoryItem: {
        select: { id: true, generatedAt: true, nicheKey: true, status: true },
      },
    },
  });

  return { order, allocations: allocations as ExportableAllocation[] };
}

function buildCsvFromAllocations(allocations: ExportableAllocation[]): {
  rows: BuyerCsvRow[];
  csv: string;
  contentSha256: string;
  allocationIds: string[];
} {
  const rows: BuyerCsvRow[] = [];
  for (const allocation of allocations) {
    const item = allocation.leadInventoryItem;
    if (!item) continue;
    rows.push(
      extractBuyerCsvFields({
        normalizedPayloadJson: allocation.sourceLeadEvent.normalizedPayloadJson,
        generatedAt: item.generatedAt,
        nicheKey: item.nicheKey,
      })
    );
  }
  const csv = serializeBuyerCsv(rows);
  return {
    rows,
    csv,
    contentSha256: sha256Hex(csv),
    allocationIds: allocations.map((row) => row.id),
  };
}

export async function previewBuyerCsvExport(
  input: { orderId: string },
  db: PrismaClient = prisma
): Promise<BuyerCsvExportPreview | BuyerCsvExportCommitResult> {
  if (!isPplCsvExportEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const { order, allocations } = await loadExportableAllocations(input.orderId.trim(), db);
  if (!order) return { ok: false, code: "order_not_found" };
  if (allocations.length === 0) {
    return { ok: false, code: "no_exportable_allocations" };
  }

  const built = buildCsvFromAllocations(allocations);
  if (built.rows.length !== allocations.length) {
    return {
      ok: false,
      code: "row_count_mismatch",
      details: { expected: allocations.length, actual: built.rows.length },
    };
  }

  return {
    ok: true,
    orderId: order.id,
    clientAccountId: order.clientAccountId,
    orderNumber: order.orderNumber,
    rowCount: built.rows.length,
    allocationIds: built.allocationIds,
    fieldSchemaVersion: BUYER_CSV_FIELD_SCHEMA_VERSION,
    contentSha256: built.contentSha256,
    columns: BUYER_CSV_COLUMNS,
  };
}

export async function commitBuyerCsvExport(
  input: {
    orderId: string;
    idempotencyKey: string;
    createdBy?: string | null;
  },
  db: PrismaClient = prisma
): Promise<BuyerCsvExportCommitResult> {
  if (!isPplCsvExportEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const orderId = input.orderId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return { ok: false, code: "idempotency_conflict", details: { reason: "missing_key" } };
  }

  const existing = await db.leadDeliveryExportPackage.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (existing.leadOrderId !== orderId) {
      return {
        ok: false,
        code: "idempotency_conflict",
        details: { reason: "key_bound_to_other_order", existingOrderId: existing.leadOrderId },
      };
    }
    return {
      ok: true,
      exportId: existing.id,
      orderId: existing.leadOrderId,
      clientAccountId: existing.clientAccountId,
      orderNumber: (
        await db.leadOrder.findUnique({
          where: { id: existing.leadOrderId },
          select: { orderNumber: true },
        })
      )?.orderNumber ?? "unknown",
      rowCount: existing.rowCount,
      allocationIds: Array.isArray(existing.allocationIdsJson)
        ? (existing.allocationIdsJson as string[])
        : [],
      fieldSchemaVersion: existing.fieldSchemaVersion,
      contentSha256: existing.contentSha256,
      filename: buildBuyerCsvFilename({
        clientAccountId: existing.clientAccountId,
        orderNumber:
          (
            await db.leadOrder.findUnique({
              where: { id: existing.leadOrderId },
              select: { orderNumber: true },
            })
          )?.orderNumber ?? "unknown",
        exportId: existing.id,
      }),
      idempotentReplay: true,
    };
  }

  return db.$transaction(async (tx) => {
    const { order, allocations } = await loadExportableAllocations(orderId, tx as unknown as PrismaClient);
    if (!order) return { ok: false as const, code: "order_not_found" as const };
    if (allocations.length === 0) {
      return { ok: false as const, code: "no_exportable_allocations" as const };
    }

    const built = buildCsvFromAllocations(allocations);
    if (built.rows.length !== allocations.length) {
      return {
        ok: false as const,
        code: "row_count_mismatch" as const,
        details: { expected: allocations.length, actual: built.rows.length },
      };
    }

    // Export commit creates an immutable package only. BuyerDeliveredIdentity and
    // inventory commit happen exclusively via markSpreadsheetDelivered.
    const packageRow = await tx.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: order.id,
        clientAccountId: order.clientAccountId,
        format: BUYER_CSV_FORMAT,
        rowCount: built.rows.length,
        contentSha256: built.contentSha256,
        idempotencyKey,
        fieldSchemaVersion: BUYER_CSV_FIELD_SCHEMA_VERSION,
        allocationIdsJson: built.allocationIds,
        csvContent: built.csv,
        createdBy: input.createdBy?.trim() || null,
      },
    });

    return {
      ok: true as const,
      exportId: packageRow.id,
      orderId: order.id,
      clientAccountId: order.clientAccountId,
      orderNumber: order.orderNumber,
      rowCount: built.rows.length,
      allocationIds: built.allocationIds,
      fieldSchemaVersion: BUYER_CSV_FIELD_SCHEMA_VERSION,
      contentSha256: built.contentSha256,
      filename: buildBuyerCsvFilename({
        clientAccountId: order.clientAccountId,
        orderNumber: order.orderNumber,
        exportId: packageRow.id,
      }),
      idempotentReplay: false,
    };
  });
}

export async function getBuyerCsvExportDownload(
  exportId: string,
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      filename: string;
      contentType: string;
      contentSha256: string;
      csv: string;
      spreadsheetDelivered: boolean;
    }
  | { ok: false; code: "feature_disabled" | "export_not_found" }
> {
  if (!isPplCsvExportEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId.trim() },
    include: { leadOrder: { select: { orderNumber: true } } },
  });
  if (!packageRow) return { ok: false, code: "export_not_found" };

  return {
    ok: true,
    filename: buildBuyerCsvFilename({
      clientAccountId: packageRow.clientAccountId,
      orderNumber: packageRow.leadOrder.orderNumber,
      exportId: packageRow.id,
    }),
    contentType: "text/csv; charset=utf-8",
    contentSha256: packageRow.contentSha256,
    csv: packageRow.csvContent,
    // Download alone never claims delivery.
    spreadsheetDelivered: packageRow.spreadsheetDeliveredAt != null,
  };
}

export type SpreadsheetDeliveryResult =
  | {
      ok: true;
      exportId: string;
      orderId: string;
      clientAccountId: string;
      contentSha256: string;
      allocationIds: string[];
      identityCount: number;
      evidenceNote: string;
      deliveredAt: string;
      deliveredBy: string | null;
      idempotentReplay: boolean;
      externalWriteOccurred: false;
    }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "export_not_found"
        | "confirmation_required"
        | "idempotency_conflict"
        | "allocations_missing";
      details?: Record<string, unknown>;
    };

/**
 * Explicit operator action: record manual spreadsheet delivery.
 * This is the only path that creates BuyerDeliveredIdentity for CSV beta.
 */
export async function markSpreadsheetDelivered(
  input: {
    exportId: string;
    confirmationPhrase: string;
    idempotencyKey: string;
    deliveredBy?: string | null;
  },
  db: PrismaClient = prisma
): Promise<SpreadsheetDeliveryResult> {
  if (!isPplCsvExportEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const exportId = input.exportId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return { ok: false, code: "idempotency_conflict", details: { reason: "missing_key" } };
  }
  if (input.confirmationPhrase.trim() !== SPREADSHEET_DELIVERY_CONFIRM_PHRASE) {
    return { ok: false, code: "confirmation_required" };
  }

  const byKey = await db.leadDeliveryExportPackage.findUnique({
    where: { spreadsheetDeliveryIdempotencyKey: idempotencyKey },
  });
  if (byKey) {
    if (byKey.id !== exportId) {
      return {
        ok: false,
        code: "idempotency_conflict",
        details: { reason: "key_bound_to_other_export", existingExportId: byKey.id },
      };
    }
    const allocationIds = Array.isArray(byKey.allocationIdsJson)
      ? (byKey.allocationIdsJson as string[])
      : [];
    return {
      ok: true,
      exportId: byKey.id,
      orderId: byKey.leadOrderId,
      clientAccountId: byKey.clientAccountId,
      contentSha256: byKey.contentSha256,
      allocationIds,
      identityCount: allocationIds.length,
      evidenceNote: SPREADSHEET_DELIVERY_EVIDENCE_NOTE,
      deliveredAt: (byKey.spreadsheetDeliveredAt ?? new Date()).toISOString(),
      deliveredBy: byKey.spreadsheetDeliveredBy,
      idempotentReplay: true,
      externalWriteOccurred: false,
    };
  }

  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId },
  });
  if (!packageRow) return { ok: false, code: "export_not_found" };

  if (packageRow.spreadsheetDeliveredAt) {
    const allocationIds = Array.isArray(packageRow.allocationIdsJson)
      ? (packageRow.allocationIdsJson as string[])
      : [];
    return {
      ok: true,
      exportId: packageRow.id,
      orderId: packageRow.leadOrderId,
      clientAccountId: packageRow.clientAccountId,
      contentSha256: packageRow.contentSha256,
      allocationIds,
      identityCount: allocationIds.length,
      evidenceNote: SPREADSHEET_DELIVERY_EVIDENCE_NOTE,
      deliveredAt: packageRow.spreadsheetDeliveredAt.toISOString(),
      deliveredBy: packageRow.spreadsheetDeliveredBy,
      idempotentReplay: true,
      externalWriteOccurred: false,
    };
  }

  const allocationIds = Array.isArray(packageRow.allocationIdsJson)
    ? (packageRow.allocationIdsJson as string[])
    : [];
  if (allocationIds.length === 0) {
    return { ok: false, code: "allocations_missing" };
  }

  const allocations = await db.leadAllocation.findMany({
    where: { id: { in: allocationIds }, leadOrderId: packageRow.leadOrderId },
    select: {
      id: true,
      status: true,
      sourceLeadEventId: true,
      leadInventoryItemId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
  });
  if (allocations.length !== allocationIds.length) {
    return {
      ok: false,
      code: "allocations_missing",
      details: { expected: allocationIds.length, actual: allocations.length },
    };
  }

  const now = new Date();
  const deliveredBy = input.deliveredBy?.trim() || null;
  const evidence = {
    note: SPREADSHEET_DELIVERY_EVIDENCE_NOTE,
    confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
    contentSha256: packageRow.contentSha256,
    allocationIds,
    orderId: packageRow.leadOrderId,
    clientAccountId: packageRow.clientAccountId,
    exportId: packageRow.id,
    actor: deliveredBy,
    recordedAt: now.toISOString(),
    externalWriteOccurred: false,
  };

  await db.$transaction(async (tx) => {
    const updated = await tx.leadDeliveryExportPackage.updateMany({
      where: { id: packageRow.id, spreadsheetDeliveredAt: null },
      data: {
        spreadsheetDeliveredAt: now,
        spreadsheetDeliveredBy: deliveredBy,
        spreadsheetDeliveryIdempotencyKey: idempotencyKey,
        spreadsheetDeliveryEvidenceJson: evidence,
      },
    });
    if (updated.count !== 1) {
      // Concurrent first-writer won; treat as idempotent success below.
      return;
    }

    const identityRows = allocations.map((allocation) => {
      const identity = readNormalizedLeadIdentity(allocation.sourceLeadEvent.normalizedPayloadJson);
      return {
        clientAccountId: packageRow.clientAccountId,
        phoneFingerprint: identity?.phoneE164
          ? fingerprintIdentityValue("phone", identity.phoneE164)
          : null,
        emailFingerprint: identity?.email
          ? fingerprintIdentityValue("email", identity.email)
          : null,
        sourceLeadEventId: allocation.sourceLeadEventId,
        leadAllocationId: allocation.id,
        leadInventoryItemId: allocation.leadInventoryItemId,
      };
    });
    await recordBuyerDeliveredIdentities(identityRows, tx as unknown as PrismaClient);

    for (const allocation of allocations) {
      if (allocation.status === "reserved" || allocation.status === "delivering") {
        await tx.leadAllocation.updateMany({
          where: { id: allocation.id, status: { in: ["reserved", "delivering"] } },
          data: { status: "committed", committedAt: now },
        });
      }
      if (allocation.leadInventoryItemId) {
        await tx.leadInventoryItem.updateMany({
          where: {
            id: allocation.leadInventoryItemId,
            status: { in: ["reserved", "committed"] },
          },
          data: { status: "committed", committedAt: now },
        });
      }
    }
  });

  const finalized = await db.leadDeliveryExportPackage.findUniqueOrThrow({
    where: { id: packageRow.id },
  });

  return {
    ok: true,
    exportId: finalized.id,
    orderId: finalized.leadOrderId,
    clientAccountId: finalized.clientAccountId,
    contentSha256: finalized.contentSha256,
    allocationIds,
    identityCount: allocationIds.length,
    evidenceNote: SPREADSHEET_DELIVERY_EVIDENCE_NOTE,
    deliveredAt: (finalized.spreadsheetDeliveredAt ?? now).toISOString(),
    deliveredBy: finalized.spreadsheetDeliveredBy,
    idempotentReplay: false,
    externalWriteOccurred: false,
  };
}
