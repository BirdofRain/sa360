import type { BulkLeadImportRowDuplicateStatus } from "@prisma/client";
import { findCorrelatedSourceLeadEvents } from "../../repositories/source-lead-event.repository.js";
import type { ImportDuplicateCandidate, ParsedImportRow } from "./bulk-import.types.js";

export type WithinBatchDuplicateIndex = {
  byPhone: Map<string, number[]>;
  byEmail: Map<string, number[]>;
  bySourceLeadId: Map<string, number[]>;
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
  index?: WithinBatchDuplicateIndex
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
        detail: `Duplicate source lead ID within batch (row ${others[0]})`,
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
        detail: `Duplicate phone within batch (canonical row ${others[0]})`,
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
        detail: `Duplicate email within batch (row ${others[0]})`,
      });
    }
  }

  return candidates;
}

export async function detectCrossSourceDuplicates(opts: {
  sourceLeadId: string;
  sourceLeadIdGenerated: boolean;
  phoneE164?: string;
  email?: string;
}): Promise<ImportDuplicateCandidate[]> {
  const candidates: ImportDuplicateCandidate[] = [];

  if (!opts.sourceLeadIdGenerated) {
    const existing = await findCorrelatedSourceLeadEvents(
      "manual_import",
      "csv_import",
      opts.sourceLeadId
    );
    for (const row of existing) {
      candidates.push({
        kind: "source_lead_id",
        existingSourceLeadEventId: row.id,
        detail: `Existing source lead event for same provider/system/lead id`,
      });
    }
  }

  return candidates;
}

export function classifyDuplicateStatus(
  candidates: ImportDuplicateCandidate[]
): BulkLeadImportRowDuplicateStatus {
  if (candidates.some((c) => c.kind === "source_lead_id")) return "source_duplicate";
  if (candidates.some((c) => c.kind === "within_batch")) return "within_batch_duplicate";
  if (candidates.length > 0) return "phone_email_review";
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
