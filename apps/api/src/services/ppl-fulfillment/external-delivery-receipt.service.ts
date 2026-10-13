import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  fingerprintIdentityValue,
  fingerprintPhoneIdentity,
  phoneFingerprintLookupSet,
} from "../../lib/identity-fingerprint.js";
import { prisma } from "../../lib/db.js";
import { parseCsvDocument } from "./buyer-csv-export.service.js";

export const EXTERNAL_RECEIPT_APPLY_PHRASE = "APPLY RECEIPT SUPPRESSION";
export const EXTERNAL_RECEIPT_APPLY_PREVIEW = "preview";
export const EXTERNAL_RECEIPT_APPLY_APPLIED = "applied";
export const EXTERNAL_RECEIPT_SUPPRESSED_REJECTED = "suppressed_rejected_before_delivery";
export const EXTERNAL_RECEIPT_SKIPPED = "skipped";
export const EXTERNAL_RECEIPT_LOOKUP_BATCH = 400;
export const EXTERNAL_RECEIPT_MAX_ROWS = 25_000;

export function isPplExternalReceiptImportEnabled(): boolean {
  return process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED === "true";
}

export type ExternalReceiptInputRow = {
  rowNumber: number;
  phone?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  rejectedBeforeDelivery?: boolean;
  malformed?: boolean;
};

export type OccupiedRowReconciliation = {
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  blankRowCount: number;
  headerRowCount: number;
  malformedCount: number;
};

export type ExternalReceiptView = {
  rowNumber: number;
  occupancyStatus: "occupied" | "blank" | "malformed";
  matchStatus: string;
  applyStatus: string;
  applyNote: string | null;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
  matchedSourceLeadEventId: string | null;
  matchedInventoryItemId: string | null;
};

export type ExternalReceiptImportView = {
  id: string;
  clientAccountId: string;
  requestId: string;
  sourceLabel: string;
  sourceFilename: string | null;
  contentChecksum: string;
  createdBy: string | null;
  appliedBy: string | null;
  applyMode: string;
  status: string;
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  blankRowCount: number;
  headerRowCount: number;
  malformedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  rejectedBeforeDeliveryCount: number;
  receipts: ExternalReceiptView[];
  wroteBuyerDeliveredIdentity: false;
};

export type ExternalReceiptInventoryMatch = {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
  sourceLeadEventId: string;
  inventoryItemId: string;
};

export type ExternalReceiptCsvParseResult = {
  headerRowCount: number;
  rows: ExternalReceiptInputRow[];
};

const PHONE_HEADERS = new Set(["phone", "phone number", "mobile", "cell", "telephone"]);
const EMAIL_HEADERS = new Set(["email", "e-mail", "email address"]);
const FIRST_HEADERS = new Set(["first name", "firstname", "first", "fname"]);
const LAST_HEADERS = new Set(["last name", "lastname", "last", "lname"]);
const REJECTED_HEADERS = new Set([
  "rejected_before_delivery",
  "rejected before delivery",
  "rejected",
]);

function headerKey(cell: string): string {
  return cell.trim().toLowerCase().replace(/[_-]+/g, " ");
}

export function mapExternalReceiptHeaders(header: readonly string[]): {
  phone: number;
  email: number;
  firstName: number;
  lastName: number;
  rejectedBeforeDelivery: number;
} {
  const mapped = {
    phone: -1,
    email: -1,
    firstName: -1,
    lastName: -1,
    rejectedBeforeDelivery: -1,
  };
  header.forEach((cell, index) => {
    const key = headerKey(cell);
    if (mapped.phone < 0 && PHONE_HEADERS.has(key)) mapped.phone = index;
    else if (mapped.email < 0 && EMAIL_HEADERS.has(key)) mapped.email = index;
    else if (mapped.firstName < 0 && FIRST_HEADERS.has(key)) mapped.firstName = index;
    else if (mapped.lastName < 0 && LAST_HEADERS.has(key)) mapped.lastName = index;
    else if (mapped.rejectedBeforeDelivery < 0 && REJECTED_HEADERS.has(key)) {
      mapped.rejectedBeforeDelivery = index;
    }
  });
  return mapped;
}

export function isExternalReceiptHeaderRow(cells: readonly string[]): boolean {
  const mapped = mapExternalReceiptHeaders(cells);
  return mapped.phone >= 0 || mapped.email >= 0;
}

function truthy(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * RFC4180 parse + explicit header mapping. A header that looks occupied is
 * not a second delivery (the 3261-vs-3260 Vanessa-sheet case).
 */
export function parseExternalReceiptCsvDocument(csvContent: string): ExternalReceiptCsvParseResult {
  const records = parseCsvDocument(csvContent);
  if (records.length === 0) return { headerRowCount: 0, rows: [] };
  const first = records[0]!;
  const hasHeader = isExternalReceiptHeaderRow(first);
  const mapping = hasHeader
    ? mapExternalReceiptHeaders(first)
    : { phone: 0, email: 1, firstName: 2, lastName: 3, rejectedBeforeDelivery: 4 };
  const data = hasHeader ? records.slice(1) : records;
  return {
    headerRowCount: hasHeader ? 1 : 0,
    rows: data.map((record, index) => {
      const phone = (mapping.phone >= 0 ? record[mapping.phone] : "")?.trim() ?? "";
      const email = (mapping.email >= 0 ? record[mapping.email] : "")?.trim() ?? "";
      const firstName = (mapping.firstName >= 0 ? record[mapping.firstName] : "")?.trim() ?? "";
      const lastName = (mapping.lastName >= 0 ? record[mapping.lastName] : "")?.trim() ?? "";
      const rejected =
        mapping.rejectedBeforeDelivery >= 0
          ? truthy(record[mapping.rejectedBeforeDelivery])
          : false;
      const malformed = !phone && !email && Boolean(firstName || lastName);
      return {
        rowNumber: index + 1,
        phone: phone || undefined,
        email: email || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        rejectedBeforeDelivery: rejected || undefined,
        malformed: malformed || undefined,
      };
    }),
  };
}

function identityKey(phoneFingerprint: string | null, emailFingerprint: string | null): string {
  return `${phoneFingerprint ?? ""}|${emailFingerprint ?? ""}`;
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export function rowHash(row: ExternalReceiptInputRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        n: row.rowNumber,
        p: row.phone?.trim() ?? "",
        e: row.email?.trim() ?? "",
        f: row.firstName?.trim() ?? "",
        l: row.lastName?.trim() ?? "",
        r: Boolean(row.rejectedBeforeDelivery),
        m: Boolean(row.malformed),
      })
    )
    .digest("hex");
}

export function computeReceiptContentChecksum(input: {
  clientAccountId: string;
  rows: ExternalReceiptInputRow[];
}): string {
  const hashes = input.rows.map(rowHash);
  return createHash("sha256")
    .update(JSON.stringify({ buyer: input.clientAccountId.trim(), rows: hashes }))
    .digest("hex");
}

export function fingerprintReceiptContact(row: ExternalReceiptInputRow): {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
  phoneLookups: string[];
} {
  const phoneRaw = row.phone?.trim() ?? "";
  const emailRaw = row.email?.trim() ?? "";
  return {
    phoneFingerprint: phoneRaw ? fingerprintPhoneIdentity(phoneRaw) : null,
    emailFingerprint: emailRaw ? fingerprintIdentityValue("email", emailRaw.toLowerCase()) : null,
    phoneLookups: phoneRaw ? phoneFingerprintLookupSet(phoneRaw) : [],
  };
}

export function reconcileOccupiedRows(
  rows: ExternalReceiptInputRow[],
  headerRowCount = 0
): OccupiedRowReconciliation {
  const seen = new Set<string>();
  let occupiedRowCount = 0;
  let uniqueLeadCount = 0;
  let extraOccupiedRowCount = 0;
  let blankRowCount = 0;
  let malformedCount = 0;

  for (const row of rows) {
    const fp = fingerprintReceiptContact(row);
    if (row.malformed || (!fp.phoneFingerprint && !fp.emailFingerprint && (row.firstName || row.lastName))) {
      malformedCount += 1;
      continue;
    }
    if (!fp.phoneFingerprint && !fp.emailFingerprint) {
      blankRowCount += 1;
      continue;
    }
    occupiedRowCount += 1;
    const key = identityKey(fp.phoneFingerprint, fp.emailFingerprint);
    if (seen.has(key)) {
      extraOccupiedRowCount += 1;
      continue;
    }
    seen.add(key);
    uniqueLeadCount += 1;
  }

  return {
    occupiedRowCount,
    uniqueLeadCount,
    extraOccupiedRowCount,
    blankRowCount,
    headerRowCount,
    malformedCount,
  };
}

function matchInventory(
  fp: {
    phoneFingerprint: string | null;
    emailFingerprint: string | null;
    phoneLookups: string[];
  },
  inventory: ExternalReceiptInventoryMatch[]
): {
  matchStatus: "matched" | "unmatched" | "ambiguous";
  matchedSourceLeadEventId: string | null;
  matchedInventoryItemId: string | null;
} {
  const lookup = new Set(fp.phoneLookups);
  const hits = inventory.filter((item) => {
    const phoneHit = Boolean(item.phoneFingerprint && lookup.has(item.phoneFingerprint));
    const emailHit =
      fp.emailFingerprint != null && item.emailFingerprint === fp.emailFingerprint;
    return phoneHit || emailHit;
  });
  const uniqueEvents = [...new Set(hits.map((item) => item.sourceLeadEventId))];
  if (uniqueEvents.length === 0) {
    return { matchStatus: "unmatched", matchedSourceLeadEventId: null, matchedInventoryItemId: null };
  }
  if (uniqueEvents.length > 1) {
    return { matchStatus: "ambiguous", matchedSourceLeadEventId: null, matchedInventoryItemId: null };
  }
  const hit = hits[0]!;
  return {
    matchStatus: "matched",
    matchedSourceLeadEventId: hit.sourceLeadEventId,
    matchedInventoryItemId: hit.inventoryItemId,
  };
}

export function classifyReceiptRows(
  rows: ExternalReceiptInputRow[],
  inventory: ExternalReceiptInventoryMatch[],
  headerRowCount = 0
): {
  reconciliation: OccupiedRowReconciliation;
  receipts: Array<
    ExternalReceiptView & {
      rejectedBeforeDelivery: boolean;
      rawRowHash: string;
    }
  >;
} {
  const reconciliation = reconcileOccupiedRows(rows, headerRowCount);
  const seen = new Set<string>();
  const receipts: Array<
    ExternalReceiptView & { rejectedBeforeDelivery: boolean; rawRowHash: string }
  > = [];

  for (const row of rows) {
    const fp = fingerprintReceiptContact(row);
    const noIdentity = !fp.phoneFingerprint && !fp.emailFingerprint;
    if (row.malformed || (noIdentity && (row.firstName || row.lastName))) {
      receipts.push({
        rowNumber: row.rowNumber,
        occupancyStatus: "malformed",
        matchStatus: "malformed",
        applyStatus: EXTERNAL_RECEIPT_SKIPPED,
        applyNote: "malformed_row_not_applied",
        phoneFingerprint: fp.phoneFingerprint,
        emailFingerprint: fp.emailFingerprint,
        matchedSourceLeadEventId: null,
        matchedInventoryItemId: null,
        rejectedBeforeDelivery: Boolean(row.rejectedBeforeDelivery),
        rawRowHash: rowHash(row),
      });
      continue;
    }
    if (noIdentity) {
      receipts.push({
        rowNumber: row.rowNumber,
        occupancyStatus: "blank",
        matchStatus: "blank_skipped",
        applyStatus: EXTERNAL_RECEIPT_SKIPPED,
        applyNote: "blank_row",
        phoneFingerprint: null,
        emailFingerprint: null,
        matchedSourceLeadEventId: null,
        matchedInventoryItemId: null,
        rejectedBeforeDelivery: Boolean(row.rejectedBeforeDelivery),
        rawRowHash: rowHash(row),
      });
      continue;
    }

    const key = identityKey(fp.phoneFingerprint, fp.emailFingerprint);
    if (seen.has(key)) {
      receipts.push({
        rowNumber: row.rowNumber,
        occupancyStatus: "occupied",
        matchStatus: "extra_occupied_row",
        applyStatus: EXTERNAL_RECEIPT_SKIPPED,
        applyNote: "duplicate_occupied_row_not_a_second_lead",
        phoneFingerprint: fp.phoneFingerprint,
        emailFingerprint: fp.emailFingerprint,
        matchedSourceLeadEventId: null,
        matchedInventoryItemId: null,
        rejectedBeforeDelivery: Boolean(row.rejectedBeforeDelivery),
        rawRowHash: rowHash(row),
      });
      continue;
    }
    seen.add(key);

    const matched = matchInventory(fp, inventory);
    const rejected = Boolean(row.rejectedBeforeDelivery);
    receipts.push({
      rowNumber: row.rowNumber,
      occupancyStatus: "occupied",
      matchStatus: matched.matchStatus,
      applyStatus: rejected
        ? EXTERNAL_RECEIPT_SUPPRESSED_REJECTED
        : EXTERNAL_RECEIPT_APPLY_PREVIEW,
      applyNote: rejected ? "rejected_before_delivery_not_marked_delivered" : null,
      phoneFingerprint: fp.phoneFingerprint,
      emailFingerprint: fp.emailFingerprint,
      matchedSourceLeadEventId: matched.matchedSourceLeadEventId,
      matchedInventoryItemId: matched.matchedInventoryItemId,
      rejectedBeforeDelivery: rejected,
      rawRowHash: rowHash(row),
    });
  }

  return { reconciliation, receipts };
}

function occupancyOf(value: string): ExternalReceiptView["occupancyStatus"] {
  if (value === "blank") return "blank";
  if (value === "malformed") return "malformed";
  return "occupied";
}

function presentBatch(row: {
  id: string;
  clientAccountId: string;
  requestId: string;
  sourceLabel: string;
  sourceFilename?: string | null;
  contentChecksum?: string | null;
  createdBy?: string | null;
  appliedBy?: string | null;
  applyMode: string;
  status: string;
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  blankRowCount: number;
  headerRowCount?: number | null;
  malformedCount?: number | null;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  rejectedBeforeDeliveryCount: number;
  receipts: Array<{
    rowNumber: number;
    occupancyStatus: string;
    matchStatus: string;
    applyStatus: string;
    applyNote: string | null;
    phoneFingerprint: string | null;
    emailFingerprint: string | null;
    matchedSourceLeadEventId: string | null;
    matchedInventoryItemId: string | null;
  }>;
}): ExternalReceiptImportView {
  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    requestId: row.requestId,
    sourceLabel: row.sourceLabel,
    sourceFilename: row.sourceFilename ?? null,
    contentChecksum: row.contentChecksum ?? "",
    createdBy: row.createdBy ?? null,
    appliedBy: row.appliedBy ?? null,
    applyMode: row.applyMode,
    status: row.status,
    occupiedRowCount: row.occupiedRowCount,
    uniqueLeadCount: row.uniqueLeadCount,
    extraOccupiedRowCount: row.extraOccupiedRowCount,
    blankRowCount: row.blankRowCount,
    headerRowCount: row.headerRowCount ?? 0,
    malformedCount: row.malformedCount ?? 0,
    matchedCount: row.matchedCount,
    unmatchedCount: row.unmatchedCount,
    ambiguousCount: row.ambiguousCount,
    rejectedBeforeDeliveryCount: row.rejectedBeforeDeliveryCount,
    receipts: row.receipts.map((receipt) => ({
      rowNumber: receipt.rowNumber,
      occupancyStatus: occupancyOf(receipt.occupancyStatus),
      matchStatus: receipt.matchStatus,
      applyStatus: receipt.applyStatus,
      applyNote: receipt.applyNote,
      phoneFingerprint: receipt.phoneFingerprint,
      emailFingerprint: receipt.emailFingerprint,
      matchedSourceLeadEventId: receipt.matchedSourceLeadEventId,
      matchedInventoryItemId: receipt.matchedInventoryItemId,
    })),
    wroteBuyerDeliveredIdentity: false,
  };
}

async function runInTransaction<T>(
  db: PrismaClient,
  work: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  const txCapable = db as PrismaClient & {
    $transaction?: (fn: (tx: PrismaClient) => Promise<T>) => Promise<T>;
  };
  if (typeof txCapable.$transaction === "function") {
    return txCapable.$transaction((tx) => work(tx as PrismaClient));
  }
  return work(db);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function loadInventoryMatchesByFingerprints(
  input: { phoneLookups: string[]; emailFingerprints: string[] },
  db: PrismaClient = prisma
): Promise<ExternalReceiptInventoryMatch[]> {
  const phones = [...new Set(input.phoneLookups.filter(Boolean))];
  const emails = [...new Set(input.emailFingerprints.filter(Boolean))];
  const found = new Map<string, ExternalReceiptInventoryMatch>();

  const remember = (
    rows: Array<{
      id: string;
      sourceLeadEventId: string;
      phoneFingerprint: string | null;
      emailFingerprint: string | null;
    }>
  ) => {
    for (const row of rows) {
      found.set(row.id, {
        inventoryItemId: row.id,
        sourceLeadEventId: row.sourceLeadEventId,
        phoneFingerprint: row.phoneFingerprint,
        emailFingerprint: row.emailFingerprint,
      });
    }
  };

  for (const phoneChunk of chunk(phones, EXTERNAL_RECEIPT_LOOKUP_BATCH)) {
    remember(
      await db.leadInventoryItem.findMany({
        where: { phoneFingerprint: { in: phoneChunk } },
        select: {
          id: true,
          sourceLeadEventId: true,
          phoneFingerprint: true,
          emailFingerprint: true,
        },
      })
    );
  }
  for (const emailChunk of chunk(emails, EXTERNAL_RECEIPT_LOOKUP_BATCH)) {
    remember(
      await db.leadInventoryItem.findMany({
        where: { emailFingerprint: { in: emailChunk } },
        select: {
          id: true,
          sourceLeadEventId: true,
          phoneFingerprint: true,
          emailFingerprint: true,
        },
      })
    );
  }
  return [...found.values()];
}

export async function loadAppliedExternalReceiptFingerprints(
  clientAccountId: string,
  db: PrismaClient = prisma
): Promise<{ phoneFingerprints: Set<string>; emailFingerprints: Set<string> }> {
  const phoneFingerprints = new Set<string>();
  const emailFingerprints = new Set<string>();
  if (!isPplExternalReceiptImportEnabled()) {
    return { phoneFingerprints, emailFingerprints };
  }

  const rows = await db.buyerExternalDeliveryReceipt.findMany({
    where: {
      clientAccountId: clientAccountId.trim(),
      applyStatus: EXTERNAL_RECEIPT_APPLY_APPLIED,
    },
    select: { phoneFingerprint: true, emailFingerprint: true },
  });
  for (const row of rows) {
    if (row.phoneFingerprint) phoneFingerprints.add(row.phoneFingerprint);
    if (row.emailFingerprint) emailFingerprints.add(row.emailFingerprint);
  }
  return { phoneFingerprints, emailFingerprints };
}

function collectLookupFingerprints(rows: ExternalReceiptInputRow[]): {
  phoneLookups: string[];
  emailFingerprints: string[];
} {
  const phoneLookups = new Set<string>();
  const emailFingerprints = new Set<string>();
  for (const row of rows) {
    const fp = fingerprintReceiptContact(row);
    for (const lookup of fp.phoneLookups) phoneLookups.add(lookup);
    if (fp.emailFingerprint) emailFingerprints.add(fp.emailFingerprint);
  }
  return { phoneLookups: [...phoneLookups], emailFingerprints: [...emailFingerprints] };
}

export async function previewExternalDeliveryReceipts(
  input: {
    clientAccountId: string;
    requestId: string;
    sourceLabel?: string;
    sourceFilename?: string | null;
    csvText?: string;
    rows?: ExternalReceiptInputRow[];
    createdBy?: string | null;
    inventory?: ExternalReceiptInventoryMatch[];
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; item: ExternalReceiptImportView; idempotentReplay: boolean }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "invalid_rows"
        | "row_limit_exceeded"
        | "idempotency_conflict";
    }
> {
  if (!isPplExternalReceiptImportEnabled()) return { ok: false, code: "feature_disabled" };

  let headerRowCount = 0;
  let rows = input.rows ?? [];
  if (typeof input.csvText === "string" && input.csvText.trim()) {
    const parsed = parseExternalReceiptCsvDocument(input.csvText);
    rows = parsed.rows;
    headerRowCount = parsed.headerRowCount;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, code: "invalid_rows" };
  }
  if (rows.length > EXTERNAL_RECEIPT_MAX_ROWS) {
    return { ok: false, code: "row_limit_exceeded" };
  }

  const clientAccountId = input.clientAccountId.trim();
  const requestId = input.requestId.trim();
  const contentChecksum = computeReceiptContentChecksum({ clientAccountId, rows });
  const sourceFilename = input.sourceFilename?.trim() || null;

  const existing = await db.buyerExternalDeliveryImportBatch.findUnique({
    where: { requestId },
    include: { receipts: { orderBy: { rowNumber: "asc" } } },
  });
  if (existing) {
    if (existing.clientAccountId !== clientAccountId || existing.contentChecksum !== contentChecksum) {
      return { ok: false, code: "idempotency_conflict" };
    }
    return { ok: true, item: presentBatch(existing), idempotentReplay: true };
  }

  const inventory =
    input.inventory ??
    (await loadInventoryMatchesByFingerprints(collectLookupFingerprints(rows), db));

  const classified = classifyReceiptRows(rows, inventory, headerRowCount);
  const matchedCount = classified.receipts.filter((row) => row.matchStatus === "matched").length;
  const unmatchedCount = classified.receipts.filter((row) => row.matchStatus === "unmatched").length;
  const ambiguousCount = classified.receipts.filter((row) => row.matchStatus === "ambiguous").length;
  const rejectedBeforeDeliveryCount = classified.receipts.filter(
    (row) => row.applyStatus === EXTERNAL_RECEIPT_SUPPRESSED_REJECTED
  ).length;

  try {
    const created = await db.buyerExternalDeliveryImportBatch.create({
      data: {
        clientAccountId,
        requestId,
        sourceLabel: input.sourceLabel?.trim() || "spreadsheet",
        sourceFilename,
        contentChecksum,
        occupiedRowCount: classified.reconciliation.occupiedRowCount,
        uniqueLeadCount: classified.reconciliation.uniqueLeadCount,
        extraOccupiedRowCount: classified.reconciliation.extraOccupiedRowCount,
        blankRowCount: classified.reconciliation.blankRowCount,
        headerRowCount: classified.reconciliation.headerRowCount,
        malformedCount: classified.reconciliation.malformedCount,
        matchedCount,
        unmatchedCount,
        ambiguousCount,
        rejectedBeforeDeliveryCount,
        applyMode: EXTERNAL_RECEIPT_APPLY_PREVIEW,
        status: "previewed",
        createdBy: input.createdBy?.trim() || null,
        receipts: {
          create: classified.receipts.map((row) => ({
            clientAccountId,
            source: "spreadsheet",
            rowNumber: row.rowNumber,
            occupancyStatus: row.occupancyStatus,
            phoneFingerprint: row.phoneFingerprint,
            emailFingerprint: row.emailFingerprint,
            rawRowHash: row.rawRowHash,
            matchStatus: row.matchStatus,
            matchedSourceLeadEventId: row.matchedSourceLeadEventId,
            matchedInventoryItemId: row.matchedInventoryItemId,
            applyStatus: row.applyStatus,
            applyNote: row.applyNote,
          })),
        },
      },
      include: { receipts: { orderBy: { rowNumber: "asc" } } },
    });
    return { ok: true, item: presentBatch(created), idempotentReplay: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.buyerExternalDeliveryImportBatch.findUnique({
      where: { requestId },
      include: { receipts: { orderBy: { rowNumber: "asc" } } },
    });
    if (!raced) throw error;
    if (raced.clientAccountId !== clientAccountId || raced.contentChecksum !== contentChecksum) {
      return { ok: false, code: "idempotency_conflict" };
    }
    return { ok: true, item: presentBatch(raced), idempotentReplay: true };
  }
}

function isConfirmedDeliveredPreview(row: { applyStatus: string; matchStatus: string }): boolean {
  return (
    row.applyStatus === EXTERNAL_RECEIPT_APPLY_PREVIEW && row.matchStatus === "matched"
  );
}

export async function applyExternalDeliveryReceipts(
  input: {
    batchId: string;
    confirmationPhrase: string;
    appliedBy?: string | null;
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; item: ExternalReceiptImportView }
  | {
      ok: false;
      code: "feature_disabled" | "batch_not_found" | "confirmation_required" | "invalid_status";
    }
> {
  if (!isPplExternalReceiptImportEnabled()) return { ok: false, code: "feature_disabled" };
  if (input.confirmationPhrase.trim() !== EXTERNAL_RECEIPT_APPLY_PHRASE) {
    return { ok: false, code: "confirmation_required" };
  }

  return runInTransaction(db, async (tx) => {
    const batch = await tx.buyerExternalDeliveryImportBatch.findUnique({
      where: { id: input.batchId.trim() },
      include: { receipts: { orderBy: { rowNumber: "asc" } } },
    });
    if (!batch) return { ok: false as const, code: "batch_not_found" as const };
    if (batch.status === "applied") {
      return { ok: true as const, item: presentBatch(batch) };
    }
    if (batch.status !== "previewed") return { ok: false as const, code: "invalid_status" as const };

    const confirmedIds = batch.receipts
      .filter(isConfirmedDeliveredPreview)
      .map((row) => row.id);

    if (confirmedIds.length > 0) {
      await tx.buyerExternalDeliveryReceipt.updateMany({
        where: {
          importBatchId: batch.id,
          id: { in: confirmedIds },
          applyStatus: EXTERNAL_RECEIPT_APPLY_PREVIEW,
          matchStatus: "matched",
        },
        data: { applyStatus: EXTERNAL_RECEIPT_APPLY_APPLIED },
      });
    }

    const updated = await tx.buyerExternalDeliveryImportBatch.updateMany({
      where: { id: batch.id, status: "previewed" },
      data: {
        status: "applied",
        applyMode: "apply",
        appliedBy: input.appliedBy?.trim() || null,
        appliedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const raced = await tx.buyerExternalDeliveryImportBatch.findUnique({
        where: { id: batch.id },
        include: { receipts: { orderBy: { rowNumber: "asc" } } },
      });
      if (raced?.status === "applied") return { ok: true as const, item: presentBatch(raced) };
      return { ok: false as const, code: "invalid_status" as const };
    }

    const fresh = await tx.buyerExternalDeliveryImportBatch.findUnique({
      where: { id: batch.id },
      include: { receipts: { orderBy: { rowNumber: "asc" } } },
    });
    if (!fresh) return { ok: false as const, code: "batch_not_found" as const };
    return { ok: true as const, item: presentBatch(fresh) };
  });
}

export async function listExternalDeliveryReceiptBatches(
  clientAccountId: string,
  db: PrismaClient = prisma
): Promise<ExternalReceiptImportView[]> {
  const rows = await db.buyerExternalDeliveryImportBatch.findMany({
    where: { clientAccountId: clientAccountId.trim() },
    include: { receipts: { orderBy: { rowNumber: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(presentBatch);
}
