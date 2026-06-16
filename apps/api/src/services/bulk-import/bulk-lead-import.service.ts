import type {
  Prisma,
  SourceLeadEventStatus,
} from "@prisma/client";
import {
  BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE,
  BULK_IMPORT_MAX_FILE_BYTES,
  BULK_IMPORT_MAX_ROWS,
} from "@sa360/shared";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  createBulkLeadImport,
  createBulkLeadImportRows,
  findBulkLeadImportById,
  findBulkLeadImportWithRows,
  listBulkLeadImportRows,
  updateBulkLeadImport,
  updateBulkLeadImportRow,
} from "../../repositories/bulk-lead-import.repository.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";
import { runSourceEnrichmentPipeline, attachSourceAttributesToLifecyclePayload } from "../source-intake/source-enrichment-pipeline.service.js";
import { hasDeliverableIdentity } from "../source-intake/source-enrichment.service.js";
import {
  applyFieldMapping,
  buildMappingFromSuggestions,
  listMissingRequiredMappings,
  suggestFieldMappings,
} from "./csv-import-mapping.service.js";
import { parseCsvText, sanitizeCsvPreviewRows } from "./csv-import-parser.service.js";
import {
  detectCrossSourceDuplicates,
  detectWithinBatchDuplicates,
  indexParsedRowsForDuplicates,
} from "./bulk-import-duplicate.service.js";
import { evaluateRowEligibility, summarizeRowEligibility } from "./bulk-import-eligibility.service.js";
import {
  normalizeBulkImportRowToLifecycle,
  resolveBulkImportLeadId,
} from "./bulk-import-normalizer.service.js";
import {
  buildImportRouteKey,
  buildManualImportRoutingResult,
  type BulkImportOptions,
  type ImportDefaultValues,
  type ImportFieldMapping,
} from "./bulk-import.types.js";
import { enqueueBulkImportDeliveryChunk } from "./bulk-import-queue.service.js";

export type CreateBulkImportInput = {
  fileName: string;
  csvText: string;
  uploadedBy?: string;
  importLabel?: string;
};

export async function createBulkImportFromCsv(input: CreateBulkImportInput) {
  if (Buffer.byteLength(input.csvText, "utf8") > BULK_IMPORT_MAX_FILE_BYTES) {
    throw new Error("file_too_large");
  }

  const batch = await createBulkLeadImport({
    fileName: input.fileName,
    importLabel: input.importLabel,
    uploadedBy: input.uploadedBy,
    status: "parsing",
    sourceRouteKey: undefined,
    wizardStepJson: { step: "map" },
  });

  const routeKey = buildImportRouteKey(batch.id);
  await updateBulkLeadImport(batch.id, {
    sourceRouteKey: routeKey,
    status: "parsing",
  });

  const parsed = parseCsvText(input.csvText, { maxRows: BULK_IMPORT_MAX_ROWS });
  const suggestions = suggestFieldMappings(parsed.headers);
  const defaultMapping = buildMappingFromSuggestions(suggestions);

  const rowCreates: Prisma.BulkLeadImportRowCreateManyInput[] = parsed.rows.map((row) => ({
    bulkImportId: batch.id,
    rowNumber: row.rowNumber,
    rawRowJson: row.fields as Prisma.InputJsonValue,
  }));

  if (rowCreates.length > 0) {
    await createBulkLeadImportRows(rowCreates);
  }

  const missingRequired = listMissingRequiredMappings(defaultMapping);
  const status = missingRequired.length > 0 ? "mapping_required" : "ready_for_review";

  return updateBulkLeadImport(batch.id, {
    status,
    totalRows: parsed.rows.length,
    parsedRows: parsed.rows.length,
    mappingJson: defaultMapping as Prisma.InputJsonValue,
    wizardStepJson: {
      step: missingRequired.length > 0 ? "map" : "destination",
      headers: parsed.headers,
      suggestions,
      previewRows: sanitizeCsvPreviewRows(parsed.rows, 20),
      missingRequired,
    } as Prisma.InputJsonValue,
  });
}

export async function saveBulkImportMapping(
  batchId: string,
  mapping: ImportFieldMapping,
  defaultValues?: ImportDefaultValues
) {
  const batch = await findBulkLeadImportById(batchId);
  if (!batch) throw new Error("not_found");

  const missingRequired = listMissingRequiredMappings(mapping);
  const status = missingRequired.length > 0 ? "mapping_required" : "ready_for_review";

  return updateBulkLeadImport(batchId, {
    mappingJson: mapping as Prisma.InputJsonValue,
    defaultValuesJson: (defaultValues ?? batch.defaultValuesJson ?? {}) as Prisma.InputJsonValue,
    status,
    wizardStepJson: {
      ...(batch.wizardStepJson as object),
      step: missingRequired.length > 0 ? "map" : "destination",
      missingRequired,
    } as Prisma.InputJsonValue,
  });
}

export async function setBulkImportDestination(
  batchId: string,
  input: {
    destinationClientAccountId: string;
    destinationLocationIdGhl: string;
    options?: BulkImportOptions;
    operator?: string;
  }
) {
  const client = await findClientAccountById(input.destinationClientAccountId);
  if (!client?.ghlDestination) throw new Error("destination_not_found");

  const readiness = evaluateDestinationReadiness(
    destinationInputFromGhlDestination(client, client.ghlDestination)
  );

  const importOptions: BulkImportOptions = {
    ...(input.options ?? {}),
    nicheKey: input.options?.nicheKey ?? "VET",
    nicheLabel: input.options?.nicheLabel ?? "Veteran",
    productType: input.options?.productType ?? "Final Expense",
  };

  return updateBulkLeadImport(batchId, {
    destinationClientAccountId: input.destinationClientAccountId,
    destinationLocationIdGhl: input.destinationLocationIdGhl,
    importOptionsJson: {
      ...importOptions,
      readiness: {
        readyForSimulation: readiness.readyForSimulation,
        blockers: readiness.blockers,
      },
      manualRouting: buildManualImportRoutingResult(
        batchId,
        input.destinationClientAccountId,
        input.destinationLocationIdGhl,
        input.operator,
        importOptions
      ),
    } as Prisma.InputJsonValue,
    wizardStepJson: {
      step: "review",
      destinationReadiness: readiness,
    } as Prisma.InputJsonValue,
    status: readiness.readyForSimulation ? "ready_for_review" : "mapping_required",
  });
}

export async function normalizeBulkImportBatch(batchId: string) {
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("not_found");
  if (!batch.destinationClientAccountId || !batch.destinationLocationIdGhl) {
    throw new Error("destination_required");
  }

  const mapping = (batch.mappingJson ?? {}) as ImportFieldMapping;
  const defaults = (batch.defaultValuesJson ?? {}) as ImportDefaultValues;
  const options = (batch.importOptionsJson ?? {}) as BulkImportOptions & {
    readiness?: { readyForSimulation?: boolean };
  };

  const destinationReady = options.readiness?.readyForSimulation === true;
  const withinBatchIndex = indexParsedRowsForDuplicates(
    batch.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.rawRowJson as Record<string, string>,
    }))
  );

  let validRows = 0;
  let blockedRows = 0;
  let duplicateRows = 0;
  let reviewRows = 0;

  for (const row of batch.rows) {
    if (row.excluded) continue;

    const fields = row.rawRowJson as Record<string, string>;
    const { canonical, unmapped } = applyFieldMapping(fields, mapping, defaults);
    const { sourceLeadId, sourceLeadIdGenerated } = resolveBulkImportLeadId(
      canonical,
      batchId,
      options.vendorLabel
    );

    const normalized = normalizeBulkImportRowToLifecycle({
      batchId,
      row: { rowNumber: row.rowNumber, fields },
      canonical,
      unmapped,
      importLabel: batch.importLabel ?? undefined,
      options: {
        ...options,
        destinationClientAccountId: batch.destinationClientAccountId,
        destinationLocationIdGhl: batch.destinationLocationIdGhl,
      } as BulkImportOptions & {
        destinationClientAccountId: string;
        destinationLocationIdGhl: string;
      },
    });

    normalized.client_account_id = batch.destinationClientAccountId;
    normalized.subaccount_id_ghl = batch.destinationLocationIdGhl;

    const phoneE164 = normalized.contact.phone_e164;
    const email = normalized.contact.email?.trim().toLowerCase();

    const withinDupes = detectWithinBatchDuplicates(
      row.rowNumber,
      phoneE164?.replace(/\D/g, ""),
      email,
      sourceLeadId,
      withinBatchIndex
    );
    const crossDupes = await detectCrossSourceDuplicates({
      sourceLeadId,
      sourceLeadIdGenerated,
      phoneE164,
      email,
    });
    const duplicateCandidates = [...withinDupes, ...crossDupes];

    const eligibility = evaluateRowEligibility({
      normalized,
      mappingComplete: listMissingRequiredMappings(mapping).length === 0,
      mapping,
      destinationSelected: true,
      destinationReadyForSimulation: destinationReady,
      duplicateCandidates,
      excluded: row.excluded,
    });

    const parsed = lifecycleEventSchema.safeParse(normalized);
    let sourceEventId = row.sourceLeadEventId;

    if (parsed.success && !sourceEventId) {
      const routing = buildManualImportRoutingResult(
        batchId,
        batch.destinationClientAccountId,
        batch.destinationLocationIdGhl,
        batch.uploadedBy ?? undefined,
        options
      );

      let eventStatus: SourceLeadEventStatus = "needs_review";
      if (eligibility.validationStatus === "eligible") {
        eventStatus = "routing_matched";
      } else if (eligibility.validationStatus === "duplicate_review") {
        eventStatus = "duplicate_blocked";
      } else if (eligibility.validationStatus === "identity_blocked") {
        eventStatus = "needs_review";
      }

      const correlationBlocks = crossDupes.some((c) => c.kind === "source_lead_id");

      const event = await createSourceLeadEvent({
        sourceProvider: "manual_import",
        sourceSystem: "csv_import",
        sourceType: "bulk_import",
        sourceRouteKey: batch.sourceRouteKey,
        sourceCampaignId: batch.sourceRouteKey,
        sourceCampaignName: options.campaignLabel ?? batch.importLabel,
        sourceLeadId,
        sourceLeadUid: normalized.contact.lead_uid,
        bulkImportId: batchId,
        bulkImportRowId: row.id,
        status: "received",
        rawPayloadJson: fields as object,
        receivedAt: new Date(),
      });

      sourceEventId = event.id;

      const identity = hasDeliverableIdentity(parsed.data);
      const { enrichmentMetadata } = await runSourceEnrichmentPipeline({
        rawPayload: fields,
        normalizedPayload: parsed.data,
        sourceProvider: "manual_import",
        sourceSystem: "csv_import",
        sourceRouteKey: batch.sourceRouteKey ?? buildImportRouteKey(batchId),
        eventStatus,
        routingMatched: routing.matched,
        destinationFieldMapJson: undefined,
        receivedAt: new Date().toISOString(),
      });

      const normalizedWithEnrichment = attachSourceAttributesToLifecyclePayload(
        parsed.data,
        enrichmentMetadata.sourceAttributes,
        enrichmentMetadata.unmappedSourceFields
      );

      await updateSourceLeadEvent(event.id, {
        status: eventStatus,
        normalizedPayloadJson: normalizedWithEnrichment as object,
        routingResultJson: routing as object,
        duplicateRiskJson: {
          blocksDelivery: eligibility.validationStatus === "duplicate_review" || correlationBlocks,
          correlated: correlationBlocks,
          candidateCount: duplicateCandidates.length,
          recommendedAction:
            duplicateCandidates.length > 0
              ? "Review duplicate signals before delivery."
              : "No duplicate risk detected.",
        } as object,
        enrichmentMetadataJson: enrichmentMetadata as object,
        clientAccountIdResolved: batch.destinationClientAccountId,
        destinationLocationIdResolved: batch.destinationLocationIdGhl,
        normalizedAt: new Date(),
        routedAt: new Date(),
      });
    }

    await updateBulkLeadImportRow(row.id, {
      sourceLeadId,
      sourceLeadIdGenerated,
      normalizedPhone: phoneE164 ?? null,
      normalizedEmail: email ?? null,
      sourceLeadEventId: sourceEventId,
      validationStatus: eligibility.validationStatus,
      duplicateStatus:
        duplicateCandidates.length > 0
          ? eligibility.validationStatus === "duplicate_review"
            ? "phone_email_review"
            : "within_batch_duplicate"
          : "none",
      blockerReasonsJson: eligibility.blockerReasons as Prisma.InputJsonValue,
      duplicateCandidatesJson: duplicateCandidates as Prisma.InputJsonValue,
    });

    if (eligibility.validationStatus === "eligible") validRows++;
    else if (eligibility.validationStatus === "identity_blocked") blockedRows++;
    else if (eligibility.validationStatus === "duplicate_review") duplicateRows++;
    else reviewRows++;
  }

  const summary = summarizeRowEligibility(
    await listBulkLeadImportRows(batchId).then((rows) =>
      rows.map((r) => ({ validationStatus: r.validationStatus }))
    )
  );

  return updateBulkLeadImport(batchId, {
    validRows,
    blockedRows,
    duplicateRows,
    reviewRows,
    status: summary.eligibleForSimulation > 0 ? "ready_for_simulation" : "ready_for_review",
    wizardStepJson: {
      step: "review",
      summary,
    } as Prisma.InputJsonValue,
  });
}

export async function simulateBulkImportRows(
  batchId: string,
  opts?: { rowIds?: string[]; limit?: number }
) {
  const batch = await findBulkLeadImportById(batchId);
  if (!batch) throw new Error("not_found");

  await updateBulkLeadImport(batchId, { status: "simulation_running" });

  const { simulateBulkImportRowDelivery } = await import("./bulk-import-delivery.service.js");
  const rows = await listBulkLeadImportRows(batchId, {
    validationStatus: "eligible",
    excluded: false,
    limit: opts?.limit ?? 5,
  });

  const targetRows = opts?.rowIds?.length
    ? rows.filter((r) => opts.rowIds!.includes(r.id))
    : rows;

  const results = [];
  for (const row of targetRows) {
    if (!row.sourceLeadEventId) continue;
    const result = await simulateBulkImportRowDelivery(row.sourceLeadEventId);
    results.push({ rowId: row.id, ...result });
    await updateBulkLeadImportRow(row.id, {
      deliveryStatus: result.ok ? "simulated" : "failed",
      validationStatus: result.ok ? "ready_for_simulation" : row.validationStatus,
      errorSummary: result.ok ? null : result.reason,
    });
  }

  const simulatedRows = results.filter((r) => r.ok).length;
  await updateBulkLeadImport(batchId, {
    simulatedRows: (batch.simulatedRows ?? 0) + simulatedRows,
    status: simulatedRows > 0 ? "simulation_complete" : "ready_for_simulation",
    wizardStepJson: {
      step: "simulate",
      simulationResults: results,
    } as Prisma.InputJsonValue,
  });

  return { ok: true, results, simulatedRows };
}

export async function approveBulkImportDelivery(
  batchId: string,
  input: {
    operatorConfirmationText: string;
    approvedBy?: string;
    rowLimit?: number;
    mode?: "simulate" | "live_canary";
  }
) {
  const { BULK_IMPORT_APPROVE_DELIVERY_CONFIRMATION } = await import("@sa360/shared");
  if (input.operatorConfirmationText.trim() !== BULK_IMPORT_APPROVE_DELIVERY_CONFIRMATION) {
    throw new Error("confirmation_required");
  }

  const batch = await findBulkLeadImportById(batchId);
  if (!batch) throw new Error("not_found");
  if ((batch.simulatedRows ?? 0) < 1) throw new Error("simulation_required");

  const maxWave = input.rowLimit ?? BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE;
  const eligible = await listBulkLeadImportRows(batchId, {
    validationStatus: "ready_for_simulation",
    deliveryStatus: "simulated",
    excluded: false,
    limit: maxWave,
  });

  if (eligible.length === 0) throw new Error("no_eligible_rows");

  await updateBulkLeadImport(batchId, {
    status: "approved_for_delivery",
    approvedAt: new Date(),
    approvedBy: input.approvedBy,
  });

  const rowIds = eligible.map((r) => r.id);
  await enqueueBulkImportDeliveryChunk({
    batchId,
    rowIds,
    mode: input.mode ?? "live_canary",
    approvedBy: input.approvedBy,
  });

  return { ok: true, approvedRowCount: rowIds.length, batchId };
}

export async function getBulkImportDetail(batchId: string) {
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) return null;
  const summary = summarizeRowEligibility(
    batch.rows.map((r) => ({ validationStatus: r.validationStatus }))
  );
  return { batch, summary };
}

export function exportBulkImportResultsCsv(
  rows: Array<{
    rowNumber: number;
    sourceLeadId: string | null;
    validationStatus: string;
    deliveryStatus: string;
    ghlContactId: string | null;
    errorSummary: string | null;
  }>
): string {
  const header = "row_number,source_lead_id,validation_status,delivery_status,ghl_contact_id,error_summary";
  const lines = rows.map((r) =>
    [
      r.rowNumber,
      r.sourceLeadId ?? "",
      r.validationStatus,
      r.deliveryStatus,
      r.ghlContactId ?? "",
      (r.errorSummary ?? "").replace(/"/g, '""'),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}
