import { createHash } from "node:crypto";

import type { LeadAllocationStatus, Prisma, PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import {
  BUYER_CSV_BASE_COLUMNS,
  BUYER_CSV_V3_COVERAGE_COLUMNS,
  buyerCsvColumnsForNiche,
  buyerCsvV3ColumnsForNiche,
  nicheSpecificColumnsFor,
  nicheSpecificV3ColumnsFor,
  normalizeBuyerNicheKey,
  readBuyerCsvV3ZipAndAge,
  readOptionalBuyerSalesContextFields,
  summarizeOptionalFieldCoverage,
  type OptionalFieldCoverage,
} from "./buyer-lead-fields.js";
import { recordBuyerDeliveredIdentities } from "./buyer-delivery-history.service.js";
import { buildOperatorBuyerCsvFilename } from "./buyer-csv-filename.js";
import { loadPricedPplOrderLine } from "./ppl-order-pricing.js";
import {
  CUSTOMER_RELEASE_NOTIFY_STATUS,
  notifyCustomerDeliveryReleased,
  presentCustomerNotification,
  type CustomerNotificationView,
  type DeliveryReleaseNotifyDeps,
} from "./delivery-release-notify.service.js";

export { buildOperatorBuyerCsvFilename as buildBuyerCsvFilename } from "./buyer-csv-filename.js";

/** Historical packages keep this schema identity forever. */
export const BUYER_CSV_FIELD_SCHEMA_VERSION = "buyer_csv_v1";
/** Historical packages after commercial CSV contract activation. */
export const BUYER_CSV_V2_FIELD_SCHEMA_VERSION = "buyer_csv_v2";
/** Latest defined buyer CSV schema identity. */
export const BUYER_CSV_V3_FIELD_SCHEMA_VERSION = "buyer_csv_v3";
/**
 * Integration correction (not a B/C redesign): do not globally activate v3.
 * Latest defined schema remains v3, but new packages are niche-scoped.
 */
export const ACTIVE_BUYER_CSV_FIELD_SCHEMA_VERSION = BUYER_CSV_V3_FIELD_SCHEMA_VERSION;
/** Historical VET/TRUCKER repair is the only urgent v3 contract. */
export const BUYER_CSV_V3_ACTIVE_NICHES = ["vet", "trucker"] as const;

export function isBuyerCsvV3ActiveNiche(nicheKey: string): boolean {
  const key = normalizeBuyerNicheKey(nicheKey);
  return (BUYER_CSV_V3_ACTIVE_NICHES as readonly string[]).includes(key);
}

/** Vet/Trucker new exports use v3; nurse/mortgage/solar/unknown stay on v2. */
export function activeBuyerCsvFieldSchemaVersionForNiche(nicheKey: string): string {
  return isBuyerCsvV3ActiveNiche(nicheKey)
    ? BUYER_CSV_V3_FIELD_SCHEMA_VERSION
    : BUYER_CSV_V2_FIELD_SCHEMA_VERSION;
}
export const BUYER_CSV_FORMAT = "csv_v1";
/** @deprecated Prefer BUYER_CSV_BASE_COLUMNS / buyerCsvColumnsForNiche — kept for v1 contract tests. */
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

export type BuyerCsvRow = Record<string, string>;

export type BuyerCsvExportPackageMetadata = {
  schema: "buyer_csv_export_metadata_v1";
  fieldSchemaVersion: string;
  niche: string;
  commerceAgeBucketKey: string | null;
  pricingVersion: string | null;
  unitPriceCents: number | null;
  requestedQuantity: number | null;
  selectedRowCount: number;
  columns: string[];
};

export type BuyerCsvExportPreview = {
  ok: true;
  orderId: string;
  clientAccountId: string;
  orderNumber: string;
  rowCount: number;
  allocationIds: string[];
  fieldSchemaVersion: string;
  contentSha256: string;
  columns: readonly string[];
  niche: string;
  optionalFieldCoverage: OptionalFieldCoverage;
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
      metadata?: BuyerCsvExportPackageMetadata;
    }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "order_not_found"
        | "no_exportable_allocations"
        | "row_count_mismatch"
        | "idempotency_conflict"
        | "forbidden_column"
        | "mixed_niche_export";
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

export function assertBuyerCsvV2Columns(columns: string[], nicheKey: string): void {
  const allowed = new Set(buyerCsvColumnsForNiche(nicheKey));
  for (const column of columns) {
    if (!allowed.has(column)) {
      throw new Error(`forbidden_column:${column}`);
    }
  }
}

export function assertBuyerCsvV3Columns(columns: string[], nicheKey: string): void {
  const allowed = new Set(buyerCsvV3ColumnsForNiche(nicheKey));
  for (const column of columns) {
    if (!allowed.has(column)) {
      throw new Error(`forbidden_column:${column}`);
    }
  }
}

export function leadDateOnlyUtc(generatedAt: Date): string {
  return generatedAt.toISOString().slice(0, 10);
}

/** Legacy v1 seven-column extractor (historical contract). */
export function extractBuyerCsvFields(input: {
  normalizedPayloadJson: unknown;
  generatedAt: Date;
  nicheKey: string;
}): Record<BuyerCsvColumn, string> {
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

/** buyer_csv_v2 extractor — base + optional niche allowlist; blanks never fail. */
export function extractBuyerCsvV2Fields(input: {
  normalizedPayloadJson: unknown;
  generatedAt: Date;
  nicheKey: string;
}): BuyerCsvRow {
  const base = extractBuyerCsvFields(input);
  const optional = readOptionalBuyerSalesContextFields(input.normalizedPayloadJson);
  const row: BuyerCsvRow = {
    ...base,
    beneficiary: optional.beneficiary,
    coverage_amount: optional.coverage_amount,
  };
  for (const column of nicheSpecificColumnsFor(input.nicheKey)) {
    row[column] = optional[column as keyof typeof optional] ?? "";
  }
  return row;
}

/** buyer_csv_v3 extractor — v2 identity + zip + consumer_age; blanks never fail. */
export function extractBuyerCsvV3Fields(input: {
  normalizedPayloadJson: unknown;
  generatedAt: Date;
  nicheKey: string;
}): BuyerCsvRow {
  const v2 = extractBuyerCsvV2Fields(input);
  const zipAndAge = readBuyerCsvV3ZipAndAge(input.normalizedPayloadJson);
  const optional = readOptionalBuyerSalesContextFields(input.normalizedPayloadJson);
  const row: BuyerCsvRow = {
    ...v2,
    zip: zipAndAge.zip,
    age: zipAndAge.age,
  };
  for (const column of nicheSpecificV3ColumnsFor(input.nicheKey)) {
    row[column] = optional[column as keyof typeof optional] ?? row[column] ?? "";
  }
  return row;
}

export function serializeBuyerCsv(rows: Array<Record<BuyerCsvColumn, string>>): string {
  assertBuyerCsvColumns([...BUYER_CSV_COLUMNS]);
  const lines = [BUYER_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(BUYER_CSV_COLUMNS.map((column) => csvEscape(row[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function serializeBuyerCsvV2(rows: BuyerCsvRow[], nicheKey: string): string {
  const columns = buyerCsvColumnsForNiche(nicheKey);
  assertBuyerCsvV2Columns(columns, nicheKey);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function serializeBuyerCsvV3(rows: BuyerCsvRow[], nicheKey: string): string {
  const columns = buyerCsvV3ColumnsForNiche(nicheKey);
  assertBuyerCsvV3Columns(columns, nicheKey);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function parseStatesJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function filenameForExport(input: {
  clientDisplayName?: string | null;
  clientAccountId: string;
  orderNumber: string;
  nicheKey: string;
  statesJson?: unknown;
  commerceAgeBucketKey?: string | null;
  rowCount: number;
}): string {
  return buildOperatorBuyerCsvFilename({
    clientDisplayName: input.clientDisplayName,
    clientAccountId: input.clientAccountId,
    orderNumber: input.orderNumber,
    nicheKey: input.nicheKey,
    states: parseStatesJson(input.statesJson),
    commerceAgeBucketKey: input.commerceAgeBucketKey,
    rowCount: input.rowCount,
  });
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
  order: {
    id: string;
    clientAccountId: string;
    clientDisplayName: string | null;
    orderNumber: string;
    requestedQuantity: number | null;
    nicheKey: string;
    statesJson: Prisma.JsonValue;
  } | null;
  allocations: ExportableAllocation[];
}> {
  const order = await db.leadOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      clientAccountId: true,
      clientDisplayName: true,
      orderNumber: true,
      requestedQuantity: true,
      nicheKey: true,
      statesJson: true,
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

function resolveExportNiche(
  orderNicheKey: string,
  allocations: ExportableAllocation[]
): { ok: true; nicheKey: string } | { ok: false; code: "mixed_niche_export"; niches: string[] } {
  const niches = new Set<string>();
  niches.add(normalizeBuyerNicheKey(orderNicheKey));
  for (const allocation of allocations) {
    const itemNiche = allocation.leadInventoryItem?.nicheKey;
    if (itemNiche) niches.add(normalizeBuyerNicheKey(itemNiche));
  }
  if (niches.size > 1) {
    return { ok: false, code: "mixed_niche_export", niches: [...niches].sort() };
  }
  return { ok: true, nicheKey: orderNicheKey.trim() };
}

function buildCsvV2FromAllocations(
  allocations: ExportableAllocation[],
  nicheKey: string
): {
  rows: BuyerCsvRow[];
  csv: string;
  contentSha256: string;
  allocationIds: string[];
  columns: string[];
  optionalFieldCoverage: OptionalFieldCoverage;
} {
  const rows: BuyerCsvRow[] = [];
  for (const allocation of allocations) {
    const item = allocation.leadInventoryItem;
    if (!item) continue;
    rows.push(
      extractBuyerCsvV2Fields({
        normalizedPayloadJson: allocation.sourceLeadEvent.normalizedPayloadJson,
        generatedAt: item.generatedAt,
        nicheKey,
      })
    );
  }
  const columns = buyerCsvColumnsForNiche(nicheKey);
  const csv = serializeBuyerCsvV2(rows, nicheKey);
  return {
    rows,
    csv,
    contentSha256: sha256Hex(csv),
    allocationIds: allocations.map((row) => row.id),
    columns,
    optionalFieldCoverage: summarizeOptionalFieldCoverage(rows, columns),
  };
}

function buildCsvV3FromAllocations(
  allocations: ExportableAllocation[],
  nicheKey: string
): {
  rows: BuyerCsvRow[];
  csv: string;
  contentSha256: string;
  allocationIds: string[];
  columns: string[];
  optionalFieldCoverage: OptionalFieldCoverage;
} {
  const rows: BuyerCsvRow[] = [];
  for (const allocation of allocations) {
    const item = allocation.leadInventoryItem;
    if (!item) continue;
    rows.push(
      extractBuyerCsvV3Fields({
        normalizedPayloadJson: allocation.sourceLeadEvent.normalizedPayloadJson,
        generatedAt: item.generatedAt,
        nicheKey,
      })
    );
  }
  const columns = buyerCsvV3ColumnsForNiche(nicheKey);
  const csv = serializeBuyerCsvV3(rows, nicheKey);
  return {
    rows,
    csv,
    contentSha256: sha256Hex(csv),
    allocationIds: allocations.map((row) => row.id),
    columns,
    optionalFieldCoverage: summarizeOptionalFieldCoverage(
      rows,
      columns,
      BUYER_CSV_V3_COVERAGE_COLUMNS
    ),
  };
}

function buildCsvForActiveSchema(allocations: ExportableAllocation[], nicheKey: string) {
  if (isBuyerCsvV3ActiveNiche(nicheKey)) {
    return {
      ...buildCsvV3FromAllocations(allocations, nicheKey),
      fieldSchemaVersion: BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
    };
  }
  return {
    ...buildCsvV2FromAllocations(allocations, nicheKey),
    fieldSchemaVersion: BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  };
}

async function buildExportMetadata(input: {
  orderId: string;
  nicheKey: string;
  columns: string[];
  rowCount: number;
  requestedQuantity: number | null;
  fieldSchemaVersion: string;
  db: PrismaClient;
}): Promise<BuyerCsvExportPackageMetadata> {
  const priced = await loadPricedPplOrderLine(input.orderId, input.db);
  return {
    schema: "buyer_csv_export_metadata_v1",
    fieldSchemaVersion: input.fieldSchemaVersion,
    niche: input.nicheKey,
    commerceAgeBucketKey: priced?.commerceAgeBucketKey ?? null,
    pricingVersion: priced?.pricingVersion ?? null,
    unitPriceCents: priced?.unitPriceCents ?? null,
    requestedQuantity: priced?.requestedQuantity ?? input.requestedQuantity,
    selectedRowCount: input.rowCount,
    columns: input.columns,
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

  const niche = resolveExportNiche(order.nicheKey, allocations);
  if (!niche.ok) {
    return {
      ok: false,
      code: "mixed_niche_export",
      details: { niches: niche.niches },
    };
  }

  const built = buildCsvForActiveSchema(allocations, niche.nicheKey);
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
    fieldSchemaVersion: built.fieldSchemaVersion,
    contentSha256: built.contentSha256,
    columns: built.columns,
    niche: niche.nicheKey,
    optionalFieldCoverage: built.optionalFieldCoverage,
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
    const replayOrder = await db.leadOrder.findUnique({
      where: { id: existing.leadOrderId },
      select: {
        orderNumber: true,
        clientDisplayName: true,
        nicheKey: true,
        statesJson: true,
      },
    });
    const replayMetadata = asRecord(existing.metadataJson) as BuyerCsvExportPackageMetadata | undefined;
    const orderNumber = replayOrder?.orderNumber ?? "unknown";
    return {
      ok: true,
      exportId: existing.id,
      orderId: existing.leadOrderId,
      clientAccountId: existing.clientAccountId,
      orderNumber,
      rowCount: existing.rowCount,
      allocationIds: Array.isArray(existing.allocationIdsJson)
        ? (existing.allocationIdsJson as string[])
        : [],
      fieldSchemaVersion: existing.fieldSchemaVersion,
      contentSha256: existing.contentSha256,
      filename: filenameForExport({
        clientDisplayName: replayOrder?.clientDisplayName,
        clientAccountId: existing.clientAccountId,
        orderNumber,
        nicheKey: replayMetadata?.niche ?? replayOrder?.nicheKey ?? "niche",
        statesJson: replayOrder?.statesJson,
        commerceAgeBucketKey: replayMetadata?.commerceAgeBucketKey ?? null,
        rowCount: existing.rowCount,
      }),
      idempotentReplay: true,
      metadata: replayMetadata,
    };
  }

  return db.$transaction(async (tx) => {
    const { order, allocations } = await loadExportableAllocations(orderId, tx as unknown as PrismaClient);
    if (!order) return { ok: false as const, code: "order_not_found" as const };
    if (allocations.length === 0) {
      return { ok: false as const, code: "no_exportable_allocations" as const };
    }

    const niche = resolveExportNiche(order.nicheKey, allocations);
    if (!niche.ok) {
      return {
        ok: false as const,
        code: "mixed_niche_export" as const,
        details: { niches: niche.niches },
      };
    }

    const built = buildCsvForActiveSchema(allocations, niche.nicheKey);
    if (built.rows.length !== allocations.length) {
      return {
        ok: false as const,
        code: "row_count_mismatch" as const,
        details: { expected: allocations.length, actual: built.rows.length },
      };
    }

    const metadata = await buildExportMetadata({
      orderId: order.id,
      nicheKey: niche.nicheKey,
      columns: built.columns,
      rowCount: built.rows.length,
      requestedQuantity: order.requestedQuantity,
      fieldSchemaVersion: built.fieldSchemaVersion,
      db: tx as unknown as PrismaClient,
    });

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
        fieldSchemaVersion: built.fieldSchemaVersion,
        allocationIdsJson: built.allocationIds,
        csvContent: built.csv,
        metadataJson: metadata,
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
      fieldSchemaVersion: built.fieldSchemaVersion,
      contentSha256: built.contentSha256,
      filename: filenameForExport({
        clientDisplayName: order.clientDisplayName,
        clientAccountId: order.clientAccountId,
        orderNumber: order.orderNumber,
        nicheKey: metadata.niche,
        statesJson: order.statesJson,
        commerceAgeBucketKey: metadata.commerceAgeBucketKey,
        rowCount: built.rows.length,
      }),
      idempotentReplay: false,
      metadata,
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
      fieldSchemaVersion: string;
    }
  | { ok: false; code: "feature_disabled" | "export_not_found" }
> {
  if (!isPplCsvExportEnabled()) {
    return { ok: false, code: "feature_disabled" };
  }

  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId.trim() },
    include: {
      leadOrder: {
        select: {
          orderNumber: true,
          clientDisplayName: true,
          nicheKey: true,
          statesJson: true,
        },
      },
    },
  });
  if (!packageRow) return { ok: false, code: "export_not_found" };

  const downloadMetadata = asRecord(packageRow.metadataJson) as
    | BuyerCsvExportPackageMetadata
    | undefined;

  return {
    ok: true,
    filename: filenameForExport({
      clientDisplayName: packageRow.leadOrder.clientDisplayName,
      clientAccountId: packageRow.clientAccountId,
      orderNumber: packageRow.leadOrder.orderNumber,
      nicheKey: downloadMetadata?.niche ?? packageRow.leadOrder.nicheKey,
      statesJson: packageRow.leadOrder.statesJson,
      commerceAgeBucketKey: downloadMetadata?.commerceAgeBucketKey ?? null,
      rowCount: packageRow.rowCount,
    }),
    contentType: "text/csv; charset=utf-8",
    contentSha256: packageRow.contentSha256,
    csv: packageRow.csvContent,
    // Download alone never claims delivery.
    spreadsheetDelivered: packageRow.spreadsheetDeliveredAt != null,
    fieldSchemaVersion: packageRow.fieldSchemaVersion,
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
      customerNotification?: CustomerNotificationView;
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
  db: PrismaClient = prisma,
  deps: DeliveryReleaseNotifyDeps = {}
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
    return attachCustomerReleaseNotification(
      {
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
      },
      db,
      deps
    );
  }

  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId },
  });
  if (!packageRow) return { ok: false, code: "export_not_found" };

  if (packageRow.spreadsheetDeliveredAt) {
    const allocationIds = Array.isArray(packageRow.allocationIdsJson)
      ? (packageRow.allocationIdsJson as string[])
      : [];
    return attachCustomerReleaseNotification(
      {
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
      },
      db,
      deps
    );
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
        customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.pending,
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

  return attachCustomerReleaseNotification(
    {
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
    },
    db,
    deps
  );
}

async function attachCustomerReleaseNotification(
  result: Extract<SpreadsheetDeliveryResult, { ok: true }>,
  db: PrismaClient,
  deps: DeliveryReleaseNotifyDeps
): Promise<Extract<SpreadsheetDeliveryResult, { ok: true }>> {
  try {
    const notification = await notifyCustomerDeliveryReleased(
      { exportId: result.exportId },
      db,
      deps
    );
    return {
      ...result,
      customerNotification: presentCustomerNotification(notification),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("delivery_release.notify.unhandled", {
      exportId: result.exportId,
      error: message.slice(0, 300),
    });
    return {
      ...result,
      customerNotification: { status: "failed", reason: "notify_unhandled" },
    };
  }
}

// Re-export base columns for callers that need v2 base list.
export { BUYER_CSV_BASE_COLUMNS };
