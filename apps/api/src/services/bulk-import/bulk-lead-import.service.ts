import type { BulkLeadImportRowValidationStatus, Prisma } from "@prisma/client";
import {
  BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE,
  BULK_IMPORT_INITIAL_CANARY_MAX_ROWS,
  BULK_IMPORT_MAX_FILE_BYTES,
  BULK_IMPORT_MAX_ROWS,
} from "@sa360/shared";
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
  applyFieldMapping,
  buildMappingFromSuggestions,
  importFieldMappingsEqual,
  listMissingRequiredMappings,
  suggestFieldMappings,
  summarizeImportMappingChanges,
  validateBulkImportMapping,
} from "./csv-import-mapping.service.js";
import {
  MappingChangeRequiresResetError,
  type MappingChangeImpact,
} from "./bulk-import-mapping-change.js";
import { assertBulkImportHasNoDeliveredRows } from "./bulk-import-lifecycle.service.js";
import { deleteSourceLeadEventsByBulkImportId, findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { prisma } from "../../lib/db.js";
import { BULK_IMPORT_RESET_CONFIRMATION } from "@sa360/shared";
import { parseCsvText, sanitizeCsvPreviewRows } from "./csv-import-parser.service.js";
import {
  detectCrossSourceDuplicates,
  detectWithinBatchDuplicates,
  indexParsedRowsForDuplicates,
} from "./bulk-import-duplicate.service.js";
import {
  isMissingSourceEventRow,
  isSimulationReadyRow,
  resolveSourceIntakeNormalizationState,
  summarizeBulkImportRowEligibility,
} from "./bulk-import-simulation-eligibility.service.js";
import { normalizeAndPersistBulkImportRow } from "./bulk-import-row-normalize.service.js";
import { resolveBulkImportLeadId } from "./bulk-import-normalizer.service.js";
import type { SanitizedSchemaIssue } from "./bulk-import-row-normalize.service.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import {
  buildImportRouteKey,
  buildManualImportRoutingResult,
  type BulkImportNormalizationOptions,
  type BulkImportOptions,
  type ImportDefaultValues,
  type ImportFieldMapping,
} from "./bulk-import.types.js";
import { enqueueBulkImportDeliveryChunk } from "./bulk-import-queue.service.js";
import {
  flatDestinationBodyToOptions,
  validateBulkImportDestinationSelection,
  type FlatBulkImportDestinationBody,
} from "./bulk-import-destination.js";
import { BulkImportDestinationError } from "./bulk-import-destination-errors.js";
import {
  asWizardStepJson,
  batchHasLiveDeliveryApproval,
  inferMappingConfirmed,
  isRetryableSimulationFailureRow,
  mergeBulkImportWizardStepJson,
  reconstructBulkImportWizardMetadata,
  sanitizeSimulationRowResult,
} from "./bulk-import-wizard-metadata.service.js";
import {
  resolveDestinationSaveNextStep,
  resolveMappingSaveNextStep,
  resolveNormalizeNextStep,
  resolveSimulateNextStep,
  resolveApproveNextStep,
} from "./bulk-import-wizard-progression.service.js";
import { repairSimulationOnlySourceLeadEvent } from "./bulk-import-simulation.service.js";
import { BulkImportApprovalError } from "./bulk-import-approval.error.js";
import { runBulkImportLiveCanaryPreflightForBatch } from "./bulk-import-live-canary-preflight.service.js";
import {
  isBulkImportInitialCanaryDemoOnlyEnabled,
  validateInitialBulkImportCanary,
} from "./bulk-import-initial-canary-guard.js";
import { getBulkImportDeliveryMonitor } from "./bulk-import-queue-monitor.service.js";
import { parseBulkImportLiveDeliverySnapshot } from "./bulk-import-live-delivery-present.service.js";
import { presentBulkImportDetailResponse } from "./bulk-import-detail.present.js";

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

  return updateBulkLeadImport(batch.id, {
    status: "mapping_required",
    totalRows: parsed.rows.length,
    parsedRows: parsed.rows.length,
    mappingJson: defaultMapping as Prisma.InputJsonValue,
    wizardStepJson: mergeBulkImportWizardStepJson(null, {
      step: "map",
      headers: parsed.headers,
      suggestions,
      previewRows: sanitizeCsvPreviewRows(parsed.rows, 20),
      missingRequired,
      mappingConfirmed: false,
    }),
  });
}

export async function saveBulkImportMapping(
  batchId: string,
  mapping: ImportFieldMapping,
  defaultValues?: ImportDefaultValues,
  resetConfirmation?: string
) {
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("not_found");
  if (batch.status === "cancelled") throw new Error("bulk_import_already_cancelled");

  await assertBulkImportHasNoDeliveredRows(batchId);

  const validation = validateBulkImportMapping(mapping);
  if (!validation.ok) {
    if (validation.conflicts.length > 0) throw new Error("mapping_conflict");
    if (validation.invalidCustomKeys.length > 0) throw new Error("invalid_custom_attribute_key");
  }

  const savedMapping = (batch.mappingJson ?? {}) as ImportFieldMapping;
  const wizardMeta = (batch.wizardStepJson ?? {}) as { headers?: string[] };
  const csvColumns = wizardMeta.headers?.length
    ? wizardMeta.headers
    : [...new Set([...Object.keys(savedMapping), ...Object.keys(mapping)])];

  const mappingChanged = !importFieldMappingsEqual(savedMapping, mapping, csvColumns);
  const wasMappingConfirmed = asWizardStepJson(batch.wizardStepJson).mappingConfirmed === true;
  if (!mappingChanged) {
    const missingRequired = validation.missingRequired;
    const wizardMeta = asWizardStepJson(batch.wizardStepJson);
    if (!wizardMeta.mappingConfirmed && missingRequired.length === 0) {
      const nextStep = mappingSaveNextStep(batch, missingRequired);
      const updated = await updateBulkLeadImport(batchId, {
        status: "ready_for_review",
        wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
          step: nextStep,
          missingRequired,
          mappingConfirmed: true,
          mappingConfirmedAt: new Date().toISOString(),
          mappingConfirmedBy: batch.uploadedBy ?? undefined,
        }),
      });
      return {
        batch: updated,
        mappingChanged: false,
        mappingConfirmed: true,
        confirmationChanged: !wasMappingConfirmed,
        resetRequired: false,
        resetPerformed: false,
        nextStep,
      };
    }
    const mappingConfirmed = wasMappingConfirmed;
    return {
      batch,
      mappingChanged: false,
      mappingConfirmed,
      confirmationChanged: false,
      resetRequired: false,
      resetPerformed: false,
      nextStep: mappingSaveNextStep(batch, validation.missingRequired),
    };
  }

  const sourceLeadEventsToRemove = batch.rows.filter((r) => r.sourceLeadEventId).length;
  const simulationArtifactsToRemove = batch.rows.filter(
    (r) => r.deliveryStatus === "simulated"
  ).length;
  const hasDownstream =
    sourceLeadEventsToRemove > 0 ||
    simulationArtifactsToRemove > 0 ||
    (batch.simulatedRows ?? 0) > 0;

  const changeSummary = summarizeImportMappingChanges(savedMapping, mapping, csvColumns);
  const impact: MappingChangeImpact = {
    mappingChanged: true,
    resetRequired: hasDownstream,
    sourceLeadEventsToRemove,
    simulationArtifactsToRemove,
    deliveredRows: batch.rows.filter((r) => r.deliveryStatus === "delivered").length,
    destinationWillBePreserved: Boolean(
      batch.destinationClientAccountId && batch.destinationLocationIdGhl
    ),
    changeSummary,
  };

  if (hasDownstream) {
    if (resetConfirmation?.trim() !== BULK_IMPORT_RESET_CONFIRMATION) {
      throw new MappingChangeRequiresResetError(impact);
    }

    const { hasActiveBulkImportDeliveryJobs, removeWaitingBulkImportDeliveryJobs } = await import(
      "./bulk-import-queue.service.js"
    );
    if (await hasActiveBulkImportDeliveryJobs(batchId)) {
      throw new Error("bulk_import_delivery_active");
    }
    await removeWaitingBulkImportDeliveryJobs(batchId);

    const missingRequired = validation.missingRequired;
    const nextStep = mappingSaveNextStep(batch, missingRequired);
    const status = missingRequired.length > 0 ? "mapping_required" : "ready_for_review";

    const updated = await prisma.$transaction(async (tx) => {
      await deleteSourceLeadEventsByBulkImportId(batchId, tx);
      await tx.bulkLeadImportRow.updateMany({
        where: { bulkImportId: batchId },
        data: {
          sourceLeadId: null,
          sourceLeadIdGenerated: false,
          normalizedPhone: null,
          normalizedEmail: null,
          sourceLeadEventId: null,
          validationStatus: "pending",
          duplicateStatus: "none",
          deliveryStatus: "pending",
          errorSummary: null,
          blockerReasonsJson: [],
          duplicateCandidatesJson: [],
          ghlContactId: null,
          ghlOpportunityId: null,
          deliveryAttempts: 0,
          lastDeliveryAt: null,
        },
      });

      return tx.bulkLeadImport.update({
        where: { id: batchId },
        data: {
          mappingJson: mapping as Prisma.InputJsonValue,
          defaultValuesJson: (defaultValues ?? batch.defaultValuesJson ?? {}) as Prisma.InputJsonValue,
          validRows: 0,
          blockedRows: 0,
          duplicateRows: 0,
          reviewRows: 0,
          simulatedRows: 0,
          deliveredRows: 0,
          failedRows: 0,
          status,
          wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
            step: nextStep,
            missingRequired,
            mappingConflicts: validation.conflicts,
            mappingConfirmed: missingRequired.length === 0,
            mappingConfirmedAt:
              missingRequired.length === 0 ? new Date().toISOString() : undefined,
            mappingConfirmedBy: missingRequired.length === 0 ? batch.uploadedBy ?? undefined : undefined,
          }),
        },
      });
    });

    return {
      batch: updated,
      mappingChanged: true,
      mappingConfirmed: missingRequired.length === 0,
      confirmationChanged: !wasMappingConfirmed && missingRequired.length === 0,
      resetRequired: true,
      resetPerformed: true,
      nextStep,
      impact,
    };
  }

  const missingRequired = validation.missingRequired;
  const status = missingRequired.length > 0 ? "mapping_required" : "ready_for_review";
  const nextStep = mappingSaveNextStep(batch, missingRequired);

  const updated = await updateBulkLeadImport(batchId, {
    mappingJson: mapping as Prisma.InputJsonValue,
    defaultValuesJson: (defaultValues ?? batch.defaultValuesJson ?? {}) as Prisma.InputJsonValue,
    status,
    wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
      step: nextStep,
      missingRequired,
      mappingConflicts: validation.conflicts,
      mappingConfirmed: missingRequired.length === 0,
      mappingConfirmedAt: missingRequired.length === 0 ? new Date().toISOString() : undefined,
      mappingConfirmedBy: missingRequired.length === 0 ? batch.uploadedBy ?? undefined : undefined,
    }),
  });

  return {
    batch: updated,
    mappingChanged: true,
    mappingConfirmed: missingRequired.length === 0,
    confirmationChanged: !wasMappingConfirmed && missingRequired.length === 0,
    resetRequired: false,
    resetPerformed: false,
    nextStep,
    impact,
  };
}

function mappingSaveNextStep(
  batch: {
    destinationClientAccountId: string | null;
    destinationLocationIdGhl: string | null;
  },
  missingRequired: string[]
): string {
  return resolveMappingSaveNextStep({
    missingRequired,
    hasDestination: Boolean(batch.destinationClientAccountId && batch.destinationLocationIdGhl),
  });
}

export async function setBulkImportDestination(
  batchId: string,
  input: FlatBulkImportDestinationBody
) {
  const existingBatch = await findBulkLeadImportById(batchId);
  if (!existingBatch) throw new Error("not_found");

  const { client, readiness } = await validateBulkImportDestinationSelection({
    destinationClientAccountId: input.destinationClientAccountId,
    destinationLocationIdGhl: input.destinationLocationIdGhl,
  });

  const importOptions = {
    ...flatDestinationBodyToOptions(input),
    nicheKey: input.nicheKey ?? "VET",
    nicheLabel: input.nicheLabel ?? "Veteran",
    productType: input.productType ?? "Final Expense",
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
    wizardStepJson: mergeBulkImportWizardStepJson(existingBatch.wizardStepJson, {
      step: resolveDestinationSaveNextStep(),
      destinationReadiness: readiness,
      destinationClientDisplayName: client.clientDisplayName,
      destinationLocationName: client.ghlDestination?.locationName ?? input.destinationLocationIdGhl,
    }),
    status: readiness.readyForSimulation ? "ready_for_review" : "mapping_required",
  });
}

export async function buildBulkImportActionResponse(batchId: string, nextStep: string) {
  const detail = await getBulkImportDetail(batchId);
  if (!detail) throw new Error("not_found");
  return presentBulkImportDetailResponse(detail, { nextStep });
}

export async function setBulkImportDestinationWithResponse(
  batchId: string,
  input: FlatBulkImportDestinationBody
) {
  await setBulkImportDestination(batchId, input);
  return buildBulkImportActionResponse(batchId, resolveDestinationSaveNextStep());
}

export async function normalizeBulkImportBatch(batchId: string) {
  const batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) throw new Error("not_found");
  if (!batch.destinationClientAccountId || !batch.destinationLocationIdGhl) {
    throw new Error("destination_required");
  }

  const wizardMeta = asWizardStepJson(batch.wizardStepJson);
  const mappingConfirmed =
    typeof wizardMeta.mappingConfirmed === "boolean"
      ? wizardMeta.mappingConfirmed
      : inferMappingConfirmed(batch);
  if (!mappingConfirmed) {
    throw new Error("mapping_confirmation_required");
  }

  const mapping = (batch.mappingJson ?? {}) as ImportFieldMapping;
  const defaults = (batch.defaultValuesJson ?? {}) as ImportDefaultValues;
  const options = (batch.importOptionsJson ?? {}) as BulkImportOptions & {
    readiness?: { readyForSimulation?: boolean };
  };

  const destinationReady = options.readiness?.readyForSimulation === true;
  if (!destinationReady) {
    throw new Error("destination_not_ready_for_simulation");
  }
  const normalizationOptions: BulkImportNormalizationOptions = {
    ...options,
    destinationClientAccountId: batch.destinationClientAccountId,
    destinationLocationIdGhl: batch.destinationLocationIdGhl,
  };
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

    if (isRetryableSimulationFailureRow(row, batch)) {
      await updateBulkLeadImportRow(row.id, {
        deliveryStatus: "pending",
        errorCode: null,
        errorSummary: null,
      });
    }

    if (row.sourceLeadEventId) {
      const existingEvent = await findSourceLeadEventById(row.sourceLeadEventId);
      if (existingEvent) {
        await repairSimulationOnlySourceLeadEvent(existingEvent);
      }
    }

    const fields = row.rawRowJson as Record<string, string>;
    const { canonical, unmapped } = applyFieldMapping(fields, mapping, defaults);

    const { sourceLeadId: previewLeadId, sourceLeadIdGenerated: previewGenerated } =
      row.sourceLeadId
        ? { sourceLeadId: row.sourceLeadId, sourceLeadIdGenerated: row.sourceLeadIdGenerated }
        : resolveBulkImportLeadId(canonical, batchId, options.vendorLabel);

    const phoneResult = canonical.phone ? tryNormalizeToVerifiedE164(canonical.phone) : null;
    const phoneE164 = phoneResult?.ok ? phoneResult.e164 : undefined;

    const withinDupes = detectWithinBatchDuplicates(
      row.rowNumber,
      phoneE164?.replace(/\D/g, "") ?? canonical.phone?.replace(/\D/g, ""),
      canonical.email?.trim().toLowerCase(),
      previewLeadId,
      withinBatchIndex,
      batchId
    );
    const crossDupes = await detectCrossSourceDuplicates({
      sourceLeadId: previewLeadId,
      sourceLeadIdGenerated: previewGenerated,
      phoneE164,
      email: canonical.email?.trim().toLowerCase(),
      rowNumber: row.rowNumber,
      exclusions: {
        currentBulkImportId: batchId,
        currentBulkImportRowId: row.id,
        currentSourceLeadEventId: row.sourceLeadEventId ?? undefined,
      },
    });
    const duplicateCandidates = [...withinDupes, ...crossDupes];

    const result = await normalizeAndPersistBulkImportRow({
      batchId,
      importLabel: batch.importLabel,
      sourceRouteKey: batch.sourceRouteKey,
      uploadedBy: batch.uploadedBy,
      destinationClientAccountId: batch.destinationClientAccountId,
      destinationLocationIdGhl: batch.destinationLocationIdGhl,
      mapping,
      options: normalizationOptions,
      destinationReady,
      row: {
        id: row.id,
        rowNumber: row.rowNumber,
        rawRowJson: row.rawRowJson,
        excluded: row.excluded,
        sourceLeadId: row.sourceLeadId,
        sourceLeadIdGenerated: row.sourceLeadIdGenerated,
        sourceLeadEventId: row.sourceLeadEventId,
      },
      fields,
      canonical,
      unmapped,
      duplicateCandidates,
    });

    await updateBulkLeadImportRow(row.id, {
      sourceLeadId: result.sourceLeadId,
      sourceLeadIdGenerated: result.sourceLeadIdGenerated,
      normalizedPhone: result.normalizedPhone,
      normalizedEmail: result.normalizedEmail,
      sourceLeadEventId: result.ok ? result.sourceLeadEventId : null,
      validationStatus: result.validationStatus,
      duplicateStatus: result.duplicateStatus,
      blockerReasonsJson: result.blockerReasonsJson,
      duplicateCandidatesJson: result.duplicateCandidatesJson,
      errorSummary: result.ok ? null : result.errorSummary,
    });

    if (result.validationStatus === "eligible" && result.ok && result.sourceLeadEventId) {
      validRows++;
    } else if (result.validationStatus === "identity_blocked") {
      blockedRows++;
    } else if (result.validationStatus === "duplicate_review") {
      duplicateRows++;
    } else {
      reviewRows++;
    }
  }

  const refreshedRows = await listBulkLeadImportRows(batchId);
  const summary = summarizeBulkImportRowEligibility(
    refreshedRows.map((r) => ({
      id: r.id,
      validationStatus: r.validationStatus,
      sourceLeadEventId: r.sourceLeadEventId,
      excluded: r.excluded,
      deliveryStatus: r.deliveryStatus,
      errorSummary: r.errorSummary,
      blockerReasonsJson: r.blockerReasonsJson,
    }))
  );

  const nextStep = resolveNormalizeNextStep(summary);
  await updateBulkLeadImport(batchId, {
    validRows,
    blockedRows,
    duplicateRows,
    reviewRows,
    status: summary.eligibleForSimulation > 0 ? "ready_for_simulation" : "ready_for_review",
    wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
      step: nextStep,
      summary,
    }),
  });

  return buildBulkImportActionResponse(batchId, nextStep);
}

export async function simulateBulkImportRows(
  batchId: string,
  opts?: { rowIds?: string[]; limit?: number }
) {
  const batch = await findBulkLeadImportById(batchId);
  if (!batch) throw new Error("not_found");

  const { simulateBulkImportRowDelivery } = await import("./bulk-import-delivery.service.js");
  const allRows = await listBulkLeadImportRows(batchId, { excluded: false });
  let targetRows = allRows.filter(isSimulationReadyRow);

  if (opts?.rowIds?.length) {
    targetRows = targetRows.filter((r) => opts.rowIds!.includes(r.id));
  }
  if (opts?.limit) {
    targetRows = targetRows.slice(0, opts.limit);
  }

  if (targetRows.length === 0) {
    const missingRows = allRows.filter(isMissingSourceEventRow);
    if (missingRows.length > 0) {
      return {
        ok: false as const,
        error: "normalization_incomplete" as const,
        identityEligibleRows: missingRows.length,
        missingSourceEventRows: missingRows.length,
        rowIds: missingRows.map((r) => r.id),
        message:
          "Eligible identities are missing normalized Source Intake records. Repair or rerun normalization.",
      };
    }
    throw new Error("no_eligible_rows_for_simulation");
  }

  await updateBulkLeadImport(batchId, { status: "simulation_running" });

  const mapping = (batch.mappingJson ?? {}) as ImportFieldMapping;
  const results = [];
  let failedRows = 0;
  for (const row of targetRows) {
    if (row.sourceLeadEventId) {
      const existingEvent = await findSourceLeadEventById(row.sourceLeadEventId);
      if (existingEvent) {
        await repairSimulationOnlySourceLeadEvent(existingEvent);
      }
    }

    const result = await simulateBulkImportRowDelivery(row.sourceLeadEventId!);
    const raw = (row.rawRowJson ?? {}) as Record<string, string>;
    const nameParts = [
      raw[mapping.first_name ?? "first_name"],
      raw[mapping.last_name ?? "last_name"],
    ].filter(Boolean);
    const sanitized = sanitizeSimulationRowResult({
      rowId: row.id,
      rowNumber: row.rowNumber,
      leadName: nameParts.join(" ").trim() || null,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      error: result.ok ? undefined : result.error,
      deliveryPlanId: result.deliveryPlanId,
      adapterRunId: result.adapterRunId,
      blockers: result.ok ? undefined : result.blockers,
      nextAction: result.nextAction,
      deliveryPlanStatus: result.deliveryPlanStatus,
      adapterSimulationDetail: result.adapterSimulationDetail,
      missingConfigFields: result.missingConfigFields,
      externalCallExecuted: result.externalCallExecuted ?? false,
    });
    results.push(sanitized);
    if (result.ok) {
      await updateBulkLeadImportRow(row.id, {
        deliveryStatus: "simulated",
        validationStatus: "ready_for_simulation",
        errorSummary: null,
        errorCode: null,
      });
    } else {
      failedRows++;
      await updateBulkLeadImportRow(row.id, {
        deliveryStatus: "failed",
        errorCode: "simulation_failed",
        errorSummary: result.reason ?? "simulation_failed",
      });
    }
  }

  const targetRowCount = targetRows.length;
  const simulatedRows = results.filter((r) => r.status === "simulated").length;
  const nextStep = resolveSimulateNextStep(simulatedRows);
  if (simulatedRows === 0) {
    await updateBulkLeadImport(batchId, {
      status: "ready_for_simulation",
      wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
        step: nextStep,
        simulationResults: results,
      }),
    });
    const detail = await buildBulkImportActionResponse(batchId, nextStep);
    return {
      ok: false as const,
      error: "all_simulations_failed" as const,
      targetRowCount,
      simulatedRows: 0,
      failedRows,
      results,
      message: `Simulation ran for ${targetRowCount} row(s), but all ${failedRows} adapter simulation(s) failed.`,
      ...detail,
      nextStep,
    };
  }

  await updateBulkLeadImport(batchId, {
    simulatedRows: (batch.simulatedRows ?? 0) + simulatedRows,
    status: "simulation_complete",
    wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
      step: nextStep,
      simulationResults: results,
    }),
  });

  const detail = await buildBulkImportActionResponse(batchId, nextStep);
  return {
    ok: true as const,
    targetRowCount,
    simulatedRows,
    failedRows,
    results,
    ...detail,
    nextStep,
  };
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
  if (batch.status === "paused") throw new Error("batch_paused");
  if (batch.status !== "simulation_complete") throw new Error("simulation_required");
  if ((batch.simulatedRows ?? 0) < 1) throw new Error("simulation_required");

  if (!batch.destinationClientAccountId || !batch.destinationLocationIdGhl) {
    throw new Error("destination_not_ready");
  }

  try {
    await validateBulkImportDestinationSelection({
      destinationClientAccountId: batch.destinationClientAccountId,
      destinationLocationIdGhl: batch.destinationLocationIdGhl,
    });
  } catch (err) {
    const code =
      err instanceof BulkImportDestinationError
        ? err.code
        : err instanceof Error
          ? err.message
          : "destination_not_ready";
    if (
      code === "oauth_not_connected" ||
      code === "destination_not_ready_for_simulation" ||
      code === "destination_not_found" ||
      code === "location_not_linked_to_client" ||
      code === "destination_identity_mismatch" ||
      code === "ghl_connection_not_found"
    ) {
      throw new Error("destination_not_ready");
    }
    throw err;
  }

  const preflight = await runBulkImportLiveCanaryPreflightForBatch(batch);
  if (!preflight.ready) {
    throw new BulkImportApprovalError(
      "live_canary_preflight_failed",
      preflight.blockers,
      "Live canary preflight failed."
    );
  }

  let maxWave = input.rowLimit ?? BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE;
  if (isBulkImportInitialCanaryDemoOnlyEnabled()) {
    maxWave = Math.min(maxWave, BULK_IMPORT_INITIAL_CANARY_MAX_ROWS);
  }

  const eligible = await listBulkLeadImportRows(batchId, {
    validationStatus: "ready_for_simulation",
    deliveryStatus: "simulated",
    excluded: false,
    limit: maxWave,
  });

  if (eligible.length === 0) throw new Error("no_eligible_rows");

  const canaryGuard = validateInitialBulkImportCanary({
    destinationClientAccountId: batch.destinationClientAccountId,
    destinationLocationIdGhl: batch.destinationLocationIdGhl,
    importOptionsJson: batch.importOptionsJson,
    rowLimit: maxWave,
    eligibleRows: eligible,
  });
  if (!canaryGuard.ok) {
    throw new BulkImportApprovalError(
      canaryGuard.error,
      canaryGuard.blockers,
      "Initial bulk-import live canary guard failed."
    );
  }

  const rowIds = eligible.map((r) => r.id);
  let queueJobs: Array<{
    jobId: string;
    chunkIndex: number;
    rowCount: number;
    state: "waiting";
  }>;
  try {
    queueJobs = await enqueueBulkImportDeliveryChunk({
      batchId,
      rowIds,
      mode: input.mode ?? "live_canary",
      approvedBy: input.approvedBy,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "queue_enqueue_failed";
    throw new BulkImportApprovalError("queue_enqueue_failed", [reason], reason);
  }

  if (queueJobs.length === 0) {
    throw new BulkImportApprovalError(
      "queue_enqueue_failed",
      ["No delivery jobs were created for the approved wave."],
      "queue_enqueue_failed"
    );
  }

  const approvedAt = new Date().toISOString();
  await updateBulkLeadImport(batchId, {
    status: "approved_for_delivery",
    approvedAt: new Date(),
    approvedBy: input.approvedBy,
    wizardStepJson: mergeBulkImportWizardStepJson(batch.wizardStepJson, {
      step: "monitor",
      approvedRowCount: rowIds.length,
      deliveryMonitor: {
        queueJobs,
        approvedRowIds: rowIds,
        approvedAt,
        lastActivityAt: approvedAt,
        preflight,
      },
    }),
  });

  const nextStep = resolveApproveNextStep();
  const detail = await buildBulkImportActionResponse(batchId, nextStep);
  return {
    ok: true,
    approvedRowCount: rowIds.length,
    batchId,
    queueJobs,
    preflight,
    ...detail,
    nextStep,
  };
}

export async function getBulkImportDetail(batchId: string) {
  let batch = await findBulkLeadImportWithRows(batchId);
  if (!batch) return null;

  const repair = reconstructBulkImportWizardMetadata({
    batch,
    rows: batch.rows,
  });
  if (repair.repaired) {
    await updateBulkLeadImport(batchId, {
      wizardStepJson: repair.wizardStepJson as Prisma.InputJsonValue,
    });
    batch = {
      ...batch,
      wizardStepJson: repair.wizardStepJson as unknown as typeof batch.wizardStepJson,
    };
  }

  const mapping = (batch.mappingJson ?? {}) as ImportFieldMapping;
  const eligibilitySummary = summarizeBulkImportRowEligibility(
    batch.rows.map((r) => ({
      id: r.id,
      validationStatus: r.validationStatus,
      sourceLeadEventId: r.sourceLeadEventId,
      excluded: r.excluded,
      deliveryStatus: r.deliveryStatus,
      errorSummary: r.errorSummary,
      blockerReasonsJson: r.blockerReasonsJson,
    }))
  );

  const simulatedRowCount = batch.rows.filter(
    (r) => r.deliveryStatus === "simulated" && !r.excluded
  ).length;
  const deliveredRowCount = batch.rows.filter((r) => r.deliveryStatus === "delivered").length;
  const failedDeliveryCount = batch.rows.filter((r) => r.deliveryStatus === "failed").length;

  const wizardStepJson = asWizardStepJson(batch.wizardStepJson);
  const importOptions = (batch.importOptionsJson ?? {}) as BulkImportOptions;
  const deliveryMonitor = await getBulkImportDeliveryMonitor(batchId);

  const rows = await Promise.all(
    batch.rows.map(async (row) => {
      const base = presentBulkImportReviewRow(row, mapping, batch.status);
      if (row.deliveryStatus !== "delivered" || !row.sourceLeadEventId) {
        return base;
      }
      const event = await findSourceLeadEventById(row.sourceLeadEventId);
      const liveDelivery = parseBulkImportLiveDeliverySnapshot(
        event?.deliveryResultJson,
        importOptions.workflowStrategy ?? null,
        event?.deliveredAt ?? row.lastDeliveryAt
      );
      return {
        ...base,
        ghlContactId: row.ghlContactId ?? liveDelivery?.ghlContactId ?? null,
        ghlOpportunityId: row.ghlOpportunityId ?? liveDelivery?.ghlOpportunityId ?? null,
        liveDelivery,
      };
    })
  );

  return {
    batch,
    summary: {
      ...eligibilitySummary,
      simulatedRows: batch.simulatedRows ?? simulatedRowCount,
      deliveredRows: batch.deliveredRows ?? deliveredRowCount,
      failedRows: batch.failedRows ?? failedDeliveryCount,
      batchStatus: batch.status,
      wizardStep: wizardStepJson.step,
      mappingConfirmed: inferMappingConfirmed(batch),
    },
    deliveryMonitor,
    rows,
  };
}

function extractNormalizationIssues(blockerReasonsJson: unknown): SanitizedSchemaIssue[] | undefined {
  if (!blockerReasonsJson) return undefined;
  const items = Array.isArray(blockerReasonsJson) ? blockerReasonsJson : [blockerReasonsJson];
  for (const item of items) {
    if (
      typeof item === "object" &&
      item &&
      "code" in item &&
      (item as { code: string }).code === "lifecycle_schema_invalid" &&
      "issues" in item
    ) {
      return (item as { issues?: SanitizedSchemaIssue[] }).issues;
    }
  }
  return undefined;
}

function blockerReasonsToStrings(blockerReasonsJson: unknown): string[] {
  if (!blockerReasonsJson) return [];
  const items = Array.isArray(blockerReasonsJson) ? blockerReasonsJson : [blockerReasonsJson];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item && "message" in item) {
        return String((item as { message: string }).message);
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

function presentBulkImportReviewRow(
  row: {
    id: string;
    rowNumber: number;
    rawRowJson: unknown;
    normalizedPhone: string | null;
    normalizedEmail: string | null;
    validationStatus: string;
    duplicateStatus: string;
    deliveryStatus: string;
    blockerReasonsJson: unknown;
    excluded: boolean;
    sourceLeadId: string | null;
    sourceLeadEventId: string | null;
    ghlContactId: string | null;
    ghlOpportunityId?: string | null;
    errorCode: string | null;
    errorSummary: string | null;
    deliveryAttempts: number;
    duplicateCandidatesJson: unknown;
  },
  mapping: ImportFieldMapping,
  batchStatus: string
) {
  const raw = (row.rawRowJson ?? {}) as Record<string, string>;
  const nameParts = [
    raw[mapping.first_name ?? "first_name"],
    raw[mapping.last_name ?? "last_name"],
  ].filter(Boolean);
  const unmappedCount = Object.entries(mapping).filter(
    ([, target]) => target === "__unmapped__"
  ).length;
  const duplicateCandidates = Array.isArray(row.duplicateCandidatesJson)
    ? (row.duplicateCandidatesJson as Array<Record<string, unknown>>)
    : [];
  const sourceIntakeState = resolveSourceIntakeNormalizationState({
    sourceLeadEventId: row.sourceLeadEventId,
    validationStatus: row.validationStatus as BulkLeadImportRowValidationStatus,
    errorSummary: row.errorSummary,
  });
  const normalizationIssues = extractNormalizationIssues(row.blockerReasonsJson);
  const simulationFailure =
    row.deliveryStatus === "failed" &&
    row.errorCode === "simulation_failed" &&
    !batchHasLiveDeliveryApproval({ status: batchStatus }) &&
    row.deliveryAttempts === 0 &&
    !row.ghlContactId;

  return {
    id: row.id,
    rowNumber: row.rowNumber,
    name: nameParts.join(" ").trim() || null,
    phone: row.normalizedPhone ?? raw[mapping.phone ?? "phone"] ?? null,
    email: row.normalizedEmail ?? raw[mapping.email ?? "email"] ?? null,
    validationStatus: row.validationStatus,
    duplicateStatus: row.duplicateStatus,
    deliveryStatus: row.deliveryStatus,
    deliveryStatusLabel: simulationFailure
      ? "simulation_failed"
      : row.deliveryStatus === "failed" && row.deliveryAttempts > 0
        ? "live_delivery_failed"
        : row.deliveryStatus,
    blockerReasons: blockerReasonsToStrings(row.blockerReasonsJson),
    duplicateCandidates,
    unmappedFieldCount: unmappedCount,
    excluded: row.excluded,
    sourceLeadId: row.sourceLeadId,
    sourceLeadEventId: row.sourceLeadEventId,
    sourceIntakeState,
    normalizationIssues,
    ghlContactId: row.ghlContactId,
    ghlOpportunityId: (row as { ghlOpportunityId?: string | null }).ghlOpportunityId ?? null,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    simulationFailure,
    deliveryAttempts: row.deliveryAttempts,
  };
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
