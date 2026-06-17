import type { BulkLeadImportRowDuplicateStatus } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { findBulkImportRowsByIdentity } from "../../repositories/bulk-lead-import.repository.js";
import { findCorrelatedSourceLeadEvents } from "../../repositories/source-lead-event.repository.js";
import type { ImportDuplicateCandidate, ParsedImportRow } from "./bulk-import.types.js";

export type WithinBatchDuplicateIndex = {
  byPhone: Map<string, number[]>;
  byEmail: Map<string, number[]>;
  bySourceLeadId: Map<string, number[]>;
};

export type DuplicateExclusions = {
  currentBulkImportId?: string;
  currentBulkImportRowId?: string;
  currentSourceLeadEventId?: string;
};

export function buildWithinBatchDuplicateIndex(
  rows: Array<{ rowNumber: number; phone?: string; email?: string; sourceLeadId?: string }>
): WithinBatchDuplicateIndex {
  const byPhone = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  const bySourceLeadId = new Map<string, number[]>();

  for (const row of rows) {
    if (row.phone) {
      const list = byPhone.get(row.phone) ?? [];
      list.push(row.rowNumber);
      byPhone.set(row.phone, list);
    }
    if (row.email) {
      const list = byEmail.get(row.email) ?? [];
      list.push(row.rowNumber);
      byEmail.set(row.email, list);
    }
    if (row.sourceLeadId && !row.sourceLeadId.startsWith("gen-")) {
      const list = bySourceLeadId.get(row.sourceLeadId) ?? [];
      list.push(row.rowNumber);
      bySourceLeadId.set(row.sourceLeadId, list);
    }
  }

  return { byPhone, byEmail, bySourceLeadId };
}

export function detectWithinBatchDuplicates(
  rowNumber: number,
  phone?: string,
  email?: string,
  sourceLeadId?: string,
  index?: WithinBatchDuplicateIndex,
  currentBulkImportId?: string
): ImportDuplicateCandidate[] {
  if (!index) return [];
  const candidates: ImportDuplicateCandidate[] = [];

  if (sourceLeadId && !sourceLeadId.startsWith("gen-")) {
    const matches = index.bySourceLeadId.get(sourceLeadId) ?? [];
    const others = matches.filter((n) => n !== rowNumber);
    if (others.length > 0) {
      candidates.push({
        kind: "within_batch",
        rowNumber: others[0],
        detail: `Same import, row ${others[0]}: same source lead ID`,
        originLabel: `Same import, row ${others[0]}`,
        blocksReview: true,
        sameSourceLeadId: true,
        severity: "active_import_duplicate",
        previousBatchId: currentBulkImportId,
      });
    }
  }

  if (phone) {
    const matches = index.byPhone.get(phone) ?? [];
    const others = matches.filter((n) => n < rowNumber);
    if (others.length > 0) {
      candidates.push({
        kind: "within_batch",
        rowNumber: others[0],
        detail: `Same import, row ${others[0]}: same phone`,
        originLabel: `Same import, row ${others[0]}`,
        blocksReview: true,
        samePhone: true,
        severity: "active_import_duplicate",
        previousBatchId: currentBulkImportId,
      });
    }
  }

  if (email) {
    const matches = index.byEmail.get(email) ?? [];
    const others = matches.filter((n) => n < rowNumber);
    if (others.length > 0) {
      candidates.push({
        kind: "phone_email_review",
        rowNumber: others[0],
        detail: `Same import, row ${others[0]}: same email`,
        originLabel: `Same import, row ${others[0]}`,
        blocksReview: true,
        sameEmail: true,
        severity: "active_import_duplicate",
        previousBatchId: currentBulkImportId,
      });
    }
  }

  return candidates;
}

function classifyCrossSourceSeverity(opts: {
  batchCancelled: boolean;
  delivered: boolean;
}): ImportDuplicateCandidate["severity"] {
  if (opts.delivered) return "blocking_delivered_duplicate";
  if (opts.batchCancelled) return "informational_cancelled_duplicate";
  return "active_import_duplicate";
}

function blocksReviewFromSeverity(severity: ImportDuplicateCandidate["severity"]): boolean {
  return severity !== "informational_cancelled_duplicate";
}

export async function detectCrossSourceDuplicates(opts: {
  sourceLeadId: string;
  sourceLeadIdGenerated: boolean;
  phoneE164?: string;
  email?: string;
  rowNumber?: number;
  exclusions?: DuplicateExclusions;
}): Promise<ImportDuplicateCandidate[]> {
  const candidates: ImportDuplicateCandidate[] = [];
  const exclusions = opts.exclusions ?? {};

  if (!opts.sourceLeadIdGenerated) {
    const existing = await findCorrelatedSourceLeadEvents(
      "manual_import",
      "csv_import",
      opts.sourceLeadId,
      opts.exclusions?.currentSourceLeadEventId
    );
    for (const row of existing) {
      if (
        exclusions.currentBulkImportRowId &&
        row.bulkImportRowId === exclusions.currentBulkImportRowId
      ) {
        continue;
      }

      let delivered = row.status === "delivered";
      let batchCancelled = false;
      let importLabel = row.sourceRouteKey ?? row.id;
      if (row.bulkImportRowId) {
        const matchRow = await prisma.bulkLeadImportRow.findUnique({
          where: { id: row.bulkImportRowId },
          include: {
            bulkImport: {
              select: { status: true, importLabel: true, fileName: true, id: true },
            },
          },
        });
        if (matchRow) {
          delivered =
            delivered ||
            matchRow.deliveryStatus === "delivered" ||
            Boolean(matchRow.ghlContactId?.trim());
          batchCancelled = matchRow.bulkImport.status === "cancelled";
          importLabel =
            matchRow.bulkImport.importLabel ??
            matchRow.bulkImport.fileName ??
            matchRow.bulkImport.id;
        }
      }

      const severity = classifyCrossSourceSeverity({ batchCancelled, delivered });
      const detailParts = [
        `Previous import: ${importLabel}`,
        `Source Intake event ID ${row.id}`,
        `Delivered to GHL: ${delivered ? "yes" : "no"}`,
        `Previous batch cancelled: ${batchCancelled ? "yes" : "no"}`,
        "Same source lead ID",
      ];

      candidates.push({
        kind: "source_lead_id",
        existingSourceLeadEventId: row.id,
        detail: detailParts.join(" · "),
        originLabel: `Previous import: ${importLabel}`,
        blocksReview: blocksReviewFromSeverity(severity),
        sameSourceLeadId: true,
        severity,
        deliveredToGhl: delivered,
        previousBatchCancelled: batchCancelled,
        previousImportLabel: importLabel,
        previousBatchId: row.bulkImportId ?? undefined,
      });
    }
  }

  const identityMatches = await findBulkImportRowsByIdentity({
    phoneE164: opts.phoneE164,
    email: opts.email,
    excludeBulkImportRowId: exclusions.currentBulkImportRowId,
    excludeSourceLeadEventId: exclusions.currentSourceLeadEventId,
  });

  for (const match of identityMatches) {
    if (match.bulkImportId === exclusions.currentBulkImportId && match.id === exclusions.currentBulkImportRowId) {
      continue;
    }

    const samePhone = Boolean(opts.phoneE164 && match.normalizedPhone === opts.phoneE164);
    const sameEmail = Boolean(opts.email && match.normalizedEmail === opts.email);
    if (!samePhone && !sameEmail) continue;

    const delivered =
      match.deliveryStatus === "delivered" || Boolean(match.ghlContactId?.trim());
    const batchCancelled = match.bulkImport.status === "cancelled";
    const severity = classifyCrossSourceSeverity({ batchCancelled, delivered });
    const importLabel =
      match.bulkImport.importLabel ?? match.bulkImport.fileName ?? match.bulkImport.id;
    const sameImport = match.bulkImportId === exclusions.currentBulkImportId;

    const originLabel = sameImport
      ? `Same import, row ${match.rowNumber}`
      : `Previous import: ${importLabel}`;

    const detailParts = [
      originLabel,
      match.sourceLeadEventId ? `Source Intake event ID ${match.sourceLeadEventId}` : null,
      `Delivered to GHL: ${delivered ? "yes" : "no"}`,
      `Previous batch cancelled: ${batchCancelled ? "yes" : "no"}`,
      samePhone ? "Same phone" : null,
      sameEmail ? "Same email" : null,
    ].filter(Boolean);

    candidates.push({
      kind: samePhone ? "phone" : "email",
      rowNumber: sameImport ? match.rowNumber : undefined,
      existingSourceLeadEventId: match.sourceLeadEventId ?? undefined,
      detail: detailParts.join(" · "),
      originLabel,
      deliveredToGhl: delivered,
      previousBatchCancelled: batchCancelled,
      blocksReview: blocksReviewFromSeverity(severity),
      samePhone,
      sameEmail,
      severity,
      previousImportLabel: sameImport ? undefined : importLabel,
      previousBatchId: match.bulkImportId,
    });
  }

  return candidates;
}

export function getBlockingDuplicateCandidates(
  candidates: ImportDuplicateCandidate[]
): ImportDuplicateCandidate[] {
  return candidates.filter((c) => c.blocksReview !== false);
}

export function classifyDuplicateStatus(
  candidates: ImportDuplicateCandidate[]
): BulkLeadImportRowDuplicateStatus {
  const blocking = getBlockingDuplicateCandidates(candidates);
  if (blocking.some((c) => c.kind === "source_lead_id")) return "source_duplicate";
  if (blocking.some((c) => c.kind === "within_batch")) return "within_batch_duplicate";
  if (blocking.length > 0) return "phone_email_review";
  return "none";
}

export function duplicateStatusBlocksDelivery(status: BulkLeadImportRowDuplicateStatus): boolean {
  return status === "source_duplicate" || status === "blocked";
}

export function extractRowIdentityFromFields(fields: Record<string, string>): {
  phone?: string;
  email?: string;
  sourceLeadId?: string;
} {
  const phone = fields.phone?.replace(/\D/g, "");
  const email = fields.email?.trim().toLowerCase();
  const sourceLeadId =
    fields.source_lead_id?.trim() || fields.lead_id?.trim() || fields.vendor_lead_id?.trim();
  return {
    phone: phone && phone.length >= 7 ? phone : undefined,
    email: email || undefined,
    sourceLeadId,
  };
}

export function indexParsedRowsForDuplicates(rows: ParsedImportRow[]): WithinBatchDuplicateIndex {
  return buildWithinBatchDuplicateIndex(
    rows.map((row) => {
      const id = extractRowIdentityFromFields(row.fields);
      return { rowNumber: row.rowNumber, ...id };
    })
  );
}
