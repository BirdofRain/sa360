import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { prisma } from "../../lib/db.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";

export const EXTERNAL_RECEIPT_APPLY_PHRASE = "APPLY RECEIPT SUPPRESSION";
export const EXTERNAL_RECEIPT_APPLY_PREVIEW = "preview";
export const EXTERNAL_RECEIPT_APPLY_APPLIED = "applied";
export const EXTERNAL_RECEIPT_SUPPRESSED_REJECTED = "suppressed_rejected_before_delivery";
export const EXTERNAL_RECEIPT_SKIPPED = "skipped";

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
};

export type OccupiedRowReconciliation = {
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  blankRowCount: number;
};

export type ExternalReceiptView = {
  rowNumber: number;
  occupancyStatus: "occupied" | "blank";
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
  applyMode: string;
  status: string;
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  blankRowCount: number;
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

function identityKey(phoneFingerprint: string | null, emailFingerprint: string | null): string {
  return `${phoneFingerprint ?? ""}|${emailFingerprint ?? ""}`;
}

function rowHash(row: ExternalReceiptInputRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        n: row.rowNumber,
        p: row.phone?.trim() ?? "",
        e: row.email?.trim() ?? "",
        f: row.firstName?.trim() ?? "",
        l: row.lastName?.trim() ?? "",
        r: Boolean(row.rejectedBeforeDelivery),
      })
    )
    .digest("hex");
}

export function fingerprintReceiptContact(row: ExternalReceiptInputRow): {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
} {
  const phoneRaw = row.phone?.trim() ?? "";
  const emailRaw = row.email?.trim() ?? "";
  const phone = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : { ok: false as const };
  const phoneFingerprint =
    phone.ok ? fingerprintIdentityValue("phone", phone.e164) : null;
  const emailFingerprint = emailRaw
    ? fingerprintIdentityValue("email", emailRaw.toLowerCase())
    : null;
  return { phoneFingerprint, emailFingerprint };
}

export function reconcileOccupiedRows(
  rows: ExternalReceiptInputRow[]
): OccupiedRowReconciliation {
  const seen = new Set<string>();
  let occupiedRowCount = 0;
  let uniqueLeadCount = 0;
  let extraOccupiedRowCount = 0;
  let blankRowCount = 0;

  for (const row of rows) {
    const fp = fingerprintReceiptContact(row);
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

  return { occupiedRowCount, uniqueLeadCount, extraOccupiedRowCount, blankRowCount };
}

function matchInventory(
  fp: { phoneFingerprint: string | null; emailFingerprint: string | null },
  inventory: ExternalReceiptInventoryMatch[]
): {
  matchStatus: "matched" | "unmatched" | "ambiguous";
  matchedSourceLeadEventId: string | null;
  matchedInventoryItemId: string | null;
} {
  const hits = inventory.filter((item) => {
    const phoneHit =
      fp.phoneFingerprint != null && item.phoneFingerprint === fp.phoneFingerprint;
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
  inventory: ExternalReceiptInventoryMatch[]
): {
  reconciliation: OccupiedRowReconciliation;
  receipts: Array<
    ExternalReceiptView & {
      rejectedBeforeDelivery: boolean;
      rawRowHash: string;
    }
  >;
} {
  const reconciliation = reconcileOccupiedRows(rows);
  const seen = new Set<string>();
  const receipts: Array<
    ExternalReceiptView & { rejectedBeforeDelivery: boolean; rawRowHash: string }
  > = [];

  for (const row of rows) {
    const fp = fingerprintReceiptContact(row);
    if (!fp.phoneFingerprint && !fp.emailFingerprint) {
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
      applyNote: rejected
        ? "rejected_before_delivery_not_marked_delivered"
        : null,
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

function presentBatch(row: {
  id: string;
  clientAccountId: string;
  requestId: string;
  sourceLabel: string;
  applyMode: string;
  status: string;
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  blankRowCount: number;
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
    applyMode: row.applyMode,
    status: row.status,
    occupiedRowCount: row.occupiedRowCount,
    uniqueLeadCount: row.uniqueLeadCount,
    extraOccupiedRowCount: row.extraOccupiedRowCount,
    blankRowCount: row.blankRowCount,
    matchedCount: row.matchedCount,
    unmatchedCount: row.unmatchedCount,
    ambiguousCount: row.ambiguousCount,
    rejectedBeforeDeliveryCount: row.rejectedBeforeDeliveryCount,
    receipts: row.receipts.map((receipt) => ({
      rowNumber: receipt.rowNumber,
      occupancyStatus: receipt.occupancyStatus === "blank" ? "blank" : "occupied",
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

export async function previewExternalDeliveryReceipts(
  input: {
    clientAccountId: string;
    requestId: string;
    sourceLabel?: string;
    rows: ExternalReceiptInputRow[];
    createdBy?: string | null;
    inventory?: ExternalReceiptInventoryMatch[];
  },
  db: PrismaClient = prisma
): Promise<
  | { ok: true; item: ExternalReceiptImportView; idempotentReplay: boolean }
  | { ok: false; code: "feature_disabled" | "invalid_rows" }
> {
  if (!isPplExternalReceiptImportEnabled()) return { ok: false, code: "feature_disabled" };
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, code: "invalid_rows" };
  }

  const existing = await db.buyerExternalDeliveryImportBatch.findUnique({
    where: { requestId: input.requestId.trim() },
    include: { receipts: { orderBy: { rowNumber: "asc" } } },
  });
  if (existing) {
    return { ok: true, item: presentBatch(existing), idempotentReplay: true };
  }

  const inventory =
    input.inventory ??
    (await db.leadInventoryItem.findMany({
      where: {
        OR: [
          { phoneFingerprint: { not: null } },
          { emailFingerprint: { not: null } },
        ],
      },
      select: {
        id: true,
        sourceLeadEventId: true,
        phoneFingerprint: true,
        emailFingerprint: true,
      },
    })).map((row) => ({
      inventoryItemId: row.id,
      sourceLeadEventId: row.sourceLeadEventId,
      phoneFingerprint: row.phoneFingerprint,
      emailFingerprint: row.emailFingerprint,
    }));

  const classified = classifyReceiptRows(input.rows, inventory);
  const matchedCount = classified.receipts.filter((row) => row.matchStatus === "matched").length;
  const unmatchedCount = classified.receipts.filter((row) => row.matchStatus === "unmatched").length;
  const ambiguousCount = classified.receipts.filter((row) => row.matchStatus === "ambiguous").length;
  const rejectedBeforeDeliveryCount = classified.receipts.filter(
    (row) => row.applyStatus === EXTERNAL_RECEIPT_SUPPRESSED_REJECTED
  ).length;

  const created = await db.buyerExternalDeliveryImportBatch.create({
    data: {
      clientAccountId: input.clientAccountId.trim(),
      requestId: input.requestId.trim(),
      sourceLabel: input.sourceLabel?.trim() || "spreadsheet",
      occupiedRowCount: classified.reconciliation.occupiedRowCount,
      uniqueLeadCount: classified.reconciliation.uniqueLeadCount,
      extraOccupiedRowCount: classified.reconciliation.extraOccupiedRowCount,
      blankRowCount: classified.reconciliation.blankRowCount,
      matchedCount,
      unmatchedCount,
      ambiguousCount,
      rejectedBeforeDeliveryCount,
      applyMode: EXTERNAL_RECEIPT_APPLY_PREVIEW,
      status: "previewed",
      createdBy: input.createdBy?.trim() || null,
      receipts: {
        create: classified.receipts.map((row) => ({
          clientAccountId: input.clientAccountId.trim(),
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
}

export async function applyExternalDeliveryReceipts(
  input: {
    batchId: string;
    confirmationPhrase: string;
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

  const batch = await db.buyerExternalDeliveryImportBatch.findUnique({
    where: { id: input.batchId.trim() },
    include: { receipts: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch) return { ok: false, code: "batch_not_found" };
  if (batch.status === "applied") {
    return { ok: true, item: presentBatch(batch) };
  }
  if (batch.status !== "previewed") return { ok: false, code: "invalid_status" };

  await db.buyerExternalDeliveryReceipt.updateMany({
    where: {
      importBatchId: batch.id,
      applyStatus: EXTERNAL_RECEIPT_APPLY_PREVIEW,
    },
    data: { applyStatus: EXTERNAL_RECEIPT_APPLY_APPLIED },
  });

  const updated = await db.buyerExternalDeliveryImportBatch.update({
    where: { id: batch.id },
    data: {
      status: "applied",
      applyMode: "apply",
    },
    include: { receipts: { orderBy: { rowNumber: "asc" } } },
  });

  return { ok: true, item: presentBatch(updated) };
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
