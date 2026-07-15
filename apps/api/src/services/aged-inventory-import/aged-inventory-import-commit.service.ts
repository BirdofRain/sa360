import type { InventoryExclusivityMode, Prisma, PrismaClient } from "@prisma/client";
import {
  AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION,
  AGED_INVENTORY_IMPORT_SOURCE_LANE,
} from "@sa360/shared";

import { prisma as defaultPrisma } from "../../lib/db.js";
import type { AgedInventoryCommitInput } from "./aged-inventory-import.types.js";
import {
  fingerprintAgedInventoryCsv,
  parseAgedInventoryCsv,
  validateAgedInventoryMapping,
  validateAgedInventoryUpload,
} from "./aged-inventory-import-mapping.service.js";
import {
  buildAgedInventoryLeadUid,
  normalizeAndClassifyAgedInventoryRows,
} from "./aged-inventory-import-classify.service.js";
import { buildAgedInventoryErrorReportCsv } from "./aged-inventory-import-error-report.service.js";

function parseExclusivityMode(value: string): InventoryExclusivityMode {
  if (value === "exclusive" || value === "shared" || value === "configurable") return value;
  throw new Error("invalid_exclusivity_mode");
}

export async function commitAgedInventoryImport(
  input: AgedInventoryCommitInput,
  db: PrismaClient = defaultPrisma
) {
  if (input.confirmation !== AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION) {
    return { ok: false as const, error: "invalid_confirmation", code: "invalid_confirmation" };
  }
  if (!input.operatorNote?.trim()) {
    return { ok: false as const, error: "operator_note_required", code: "operator_note_required" };
  }
  if (input.inventoryClass !== "aged") {
    return { ok: false as const, error: "inventory_class_must_be_aged", code: "invalid_inventory_class" };
  }

  const existing = await db.leadInventoryImportBatch.findUnique({
    where: { requestId: input.requestId },
  });
  if (existing?.status === "committed") {
    return {
      ok: true as const,
      idempotentReplay: true,
      batch: presentCommittedBatch(existing),
      errorReportCsv: null,
    };
  }
  if (existing && existing.status !== "previewed" && existing.status !== "ready") {
    return { ok: false as const, error: "request_id_conflict", code: "request_id_conflict" };
  }

  const upload = validateAgedInventoryUpload({ fileName: input.fileName, csvText: input.csvText });
  if (!upload.ok) return { ok: false as const, error: upload.code, code: upload.code };

  const fingerprint = fingerprintAgedInventoryCsv(input.csvText);
  if (fingerprint !== input.fileFingerprint) {
    return { ok: false as const, error: "file_fingerprint_mismatch", code: "file_fingerprint_mismatch" };
  }

  const mappingErrors = validateAgedInventoryMapping(input.mapping);
  if (mappingErrors.length > 0) {
    return { ok: false as const, error: "invalid_mapping", code: "invalid_mapping", details: mappingErrors };
  }

  let parsed;
  try {
    parsed = parseAgedInventoryCsv(input.csvText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse_failed";
    return { ok: false as const, error: message, code: "parse_failed" };
  }

  const classified = await normalizeAndClassifyAgedInventoryRows({
    rows: parsed.rows,
    mapping: input.mapping,
    mappingErrors: [],
    dateFormat: input.dateFormat,
    defaultNicheKey: input.nicheKey,
    defaultProductType: input.productType ?? undefined,
  });

  const readyRows = classified.filter((row) => row.classification === "ready");
  if (readyRows.length === 0) {
    return { ok: false as const, error: "no_ready_rows", code: "no_ready_rows" };
  }

  const lotKeyExists = await db.inventoryLot.findUnique({ where: { lotKey: input.lotKey } });
  if (lotKeyExists) {
    return { ok: false as const, error: "lot_key_exists", code: "lot_key_exists" };
  }

  const sourceLane = input.sourceLane?.trim() || AGED_INVENTORY_IMPORT_SOURCE_LANE;
  const exclusivityMode = parseExclusivityMode(input.exclusivityMode);
  const receivedAt = new Date();
  const errorReportCsv = buildAgedInventoryErrorReportCsv(classified);

  try {
    const result = await db.$transaction(async (tx) => {
      const lot = await tx.inventoryLot.create({
        data: {
          lotKey: input.lotKey,
          displayName: input.lotDisplayName,
          sourceProvider: input.sourceProvider,
          sourceLane,
          nicheKey: input.nicheKey,
          productType: input.productType ?? null,
          inventoryClass: "aged",
          exclusivityMode,
          status: "active",
          activatedAt: receivedAt,
          metadataJson: {
            importRequestId: input.requestId,
            operatorNote: input.operatorNote.trim(),
            fileFingerprint: fingerprint,
          },
        },
      });

      let importedRows = 0;
      let quarantinedRows = 0;

      for (const row of classified) {
        if (row.classification !== "ready" || !row.generatedAt || !row.state || !row.nicheKey) {
          quarantinedRows += 1;
          continue;
        }

        const leadUid = buildAgedInventoryLeadUid(row.sourceLeadId);
        const normalizedPayloadJson = {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone_e164: row.phoneE164,
          state: row.state,
          generated_at: row.generatedAt.toISOString(),
          niche_key: row.nicheKey,
          product_type: row.productType,
        } satisfies Prisma.JsonObject;

        const sourceLeadEvent = await tx.sourceLeadEvent.create({
          data: {
            sourceProvider: input.sourceProvider,
            sourceSystem: "csv_import",
            sourceType: "bulk_import",
            sourceRouteKey: `AGED_INV::${input.lotKey}`,
            sourceCampaignName: input.lotDisplayName,
            sourceLeadId: row.sourceLeadId,
            sourceLeadUid: leadUid,
            status: "normalized",
            rawPayloadJson: { importRequestId: input.requestId, rowNumber: row.rowNumber },
            normalizedPayloadJson,
            enrichmentMetadataJson: {
              sourceLane,
              generatedAt: row.generatedAt.toISOString(),
              importClass: "aged_inventory_csv",
            },
            receivedAt,
            normalizedAt: receivedAt,
          },
        });

        await tx.leadInventoryItem.create({
          data: {
            inventoryLotId: lot.id,
            sourceLeadEventId: sourceLeadEvent.id,
            generatedAt: row.generatedAt,
            normalizedState: row.state,
            nicheKey: row.nicheKey,
            productType: row.productType,
            sourceProvider: input.sourceProvider,
            sourceLane,
            inventoryClass: "aged",
            exclusivityMode,
            status: "pending_review",
            metadataJson: {
              importRequestId: input.requestId,
              rowNumber: row.rowNumber,
              classification: row.classification,
            },
          },
        });
        importedRows += 1;
      }

      const invalidRows = classified.length - readyRows.length;
      const duplicateRows = classified.filter(
        (r) => r.classification === "duplicate_in_file" || r.classification === "existing_source_event"
      ).length;

      const batch = await tx.leadInventoryImportBatch.create({
        data: {
          requestId: input.requestId,
          lotKey: input.lotKey,
          fileName: input.fileName,
          fileFingerprint: fingerprint,
          uploadedBy: input.uploadedBy ?? null,
          operatorNote: input.operatorNote.trim(),
          inventoryClass: "aged",
          exclusivityMode,
          nicheKey: input.nicheKey,
          productType: input.productType ?? null,
          sourceProvider: input.sourceProvider,
          sourceLane,
          totalRows: classified.length,
          validRows: readyRows.length,
          invalidRows,
          duplicateRows,
          quarantinedRows,
          importedRows,
          status: "committed",
          mappingJson: input.mapping,
          summaryJson: {
            byState: readyRows.reduce<Record<string, number>>((acc, r) => {
              if (r.state) acc[r.state] = (acc[r.state] ?? 0) + 1;
              return acc;
            }, {}),
            byAgeBand: readyRows.reduce<Record<string, number>>((acc, r) => {
              if (r.ageBandKey) acc[r.ageBandKey] = (acc[r.ageBandKey] ?? 0) + 1;
              return acc;
            }, {}),
            pendingReview: importedRows,
          },
          previewedAt: receivedAt,
          committedAt: receivedAt,
          inventoryLotId: lot.id,
        },
      });

      return { lot, batch, importedRows, quarantinedRows };
    });

    return {
      ok: true as const,
      idempotentReplay: false,
      batch: presentCommittedBatch(result.batch),
      lotId: result.lot.id,
      importedRows: result.importedRows,
      quarantinedRows: result.quarantinedRows,
      pendingReviewRows: result.importedRows,
      errorReportCsv,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "commit_failed";
    return { ok: false as const, error: message, code: "commit_failed" };
  }
}

function presentCommittedBatch(batch: {
  id: string;
  requestId: string;
  status: string;
  lotKey: string | null;
  fileFingerprint: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  importedRows: number;
  quarantinedRows: number;
  inventoryLotId: string | null;
  committedAt: Date | null;
}) {
  return {
    id: batch.id,
    requestId: batch.requestId,
    status: batch.status,
    lotKey: batch.lotKey,
    fileFingerprint: batch.fileFingerprint,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    invalidRows: batch.invalidRows,
    duplicateRows: batch.duplicateRows,
    importedRows: batch.importedRows,
    quarantinedRows: batch.quarantinedRows,
    inventoryLotId: batch.inventoryLotId,
    committedAt: batch.committedAt?.toISOString() ?? null,
  };
}

export async function getAgedInventoryImportBatchByRequestId(
  requestId: string,
  db: PrismaClient = defaultPrisma
) {
  const batch = await db.leadInventoryImportBatch.findUnique({ where: { requestId } });
  if (!batch) return null;
  return presentCommittedBatch(batch);
}
