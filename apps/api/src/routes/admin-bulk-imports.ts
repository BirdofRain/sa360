import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isBulkSourceImportsEnabled } from "../lib/bulk-import-feature-flag.js";
import { getBuildVersionPayload } from "../lib/build-version.js";
import {
  bulkImportApproveBodySchema,
  bulkImportConfirmationBodySchema,
  bulkImportDestinationBodySchema,
  bulkImportIdParamSchema,
  bulkImportListQuerySchema,
  bulkImportMappingBodySchema,
  bulkImportResetBodySchema,
  bulkImportRowActionBodySchema,
  bulkImportSimulateBodySchema,
  bulkImportUploadBodySchema,
  bulkImportWizardStepBodySchema,
} from "../schemas/bulk-import.schema.js";
import {
  approveBulkImportDelivery,
  createBulkImportFromCsv,
  exportBulkImportResultsCsv,
  getBulkImportDetail,
  normalizeBulkImportBatch,
  saveBulkImportMapping,
  setBulkImportDestinationWithResponse,
  simulateBulkImportRows,
} from "../services/bulk-import/bulk-lead-import.service.js";
import {
  createBulkLeadImportMappingTemplate,
  findBulkLeadImportById,
  listBulkLeadImportMappingTemplates,
  listBulkLeadImports,
  updateBulkLeadImport,
  updateBulkLeadImportRow,
} from "../repositories/bulk-lead-import.repository.js";
import { suggestFieldMappings } from "../services/bulk-import/csv-import-mapping.service.js";
import {
  MappingChangeRequiresResetError,
} from "../services/bulk-import/bulk-import-mapping-change.js";
import { listBulkImportDestinationOptions } from "../services/bulk-import/bulk-import-destination-options.service.js";
import {
  cancelBulkImportBatch,
  deleteBulkImportBatch,
  getBulkImportDeletePreview,
  resetBulkImportBatch,
  setBulkImportWizardStep,
} from "../services/bulk-import/bulk-import-lifecycle.service.js";

const suggestMappingBodySchema = z.object({ headers: z.array(z.string()).min(1) }).strict();

function bulkImportErrorStatus(code: string): number {
  if (code === "confirmation_required" || code === "invalid_payload" || code === "delete_confirmation_required") {
    return 400;
  }
  if (
    code === "simulation_required" ||
    code === "no_eligible_rows" ||
    code === "no_eligible_rows_for_simulation" ||
    code === "normalization_incomplete" ||
    code === "destination_not_ready" ||
    code === "destination_not_ready_for_simulation" ||
    code === "oauth_not_connected" ||
    code === "location_not_linked_to_client" ||
    code === "batch_paused" ||
    code === "bulk_import_has_delivered_rows" ||
    code === "bulk_import_delivery_active" ||
    code === "bulk_import_not_safely_deletable" ||
    code === "bulk_import_already_cancelled" ||
    code === "mapping_conflict" ||
    code === "invalid_custom_attribute_key" ||
    code === "mapping_change_requires_reset" ||
    code === "mapping_confirmation_required" ||
    code === "all_simulations_failed" ||
    code === "live_canary_preflight_failed" ||
    code === "initial_canary_guard_failed" ||
    code === "queue_enqueue_failed"
  ) {
    return 409;
  }
  if (code === "not_found" || code === "destination_not_found" || code === "bulk_import_not_found") {
    return 404;
  }
  if (code === "feature_disabled") return 404;
  return 400;
}

async function requireBulkImport(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (!(await verifyAdminApiKey(request, reply))) return false;
  if (!isBulkSourceImportsEnabled()) {
    reply.status(404).send({ ok: false, error: "feature_disabled" });
    return false;
  }
  return true;
}

function presentBatchListItem(row: Awaited<ReturnType<typeof listBulkLeadImports>>["items"][0]) {
  return {
    id: row.id,
    fileName: row.fileName,
    importLabel: row.importLabel,
    status: row.status,
    totalRows: row.totalRows,
    validRows: row.validRows,
    deliveredRows: row.deliveredRows,
    failedRows: row.failedRows,
    destinationClientAccountId: row.destinationClientAccountId,
    destinationLocationIdGhl: row.destinationLocationIdGhl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function adminBulkImportsRoutes(app: FastifyInstance) {
  app.get("/bulk-imports", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const parsed = bulkImportListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_query" });

    const { items, nextCursor } = await listBulkLeadImports(parsed.data);
    return reply.send({
      ok: true,
      items: items.map(presentBatchListItem),
      nextCursor,
      apiBuildVersion: getBuildVersionPayload(),
    });
  });

  app.get("/bulk-imports/destination-options", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const items = await listBulkImportDestinationOptions();
    return reply.send({ ok: true, items, apiBuildVersion: getBuildVersionPayload() });
  });

  app.get("/bulk-imports/mapping-templates", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const templates = await listBulkLeadImportMappingTemplates();
    return reply.send({ ok: true, items: templates });
  });

  app.post("/bulk-imports/suggest-mapping", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const body = suggestMappingBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });
    return reply.send({ ok: true, suggestions: suggestFieldMappings(body.data.headers) });
  });

  app.post("/bulk-imports/upload", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const body = bulkImportUploadBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_payload", details: body.error.flatten() });
    }

    try {
      const batch = await createBulkImportFromCsv(body.data);
      return reply.status(201).send({
        ok: true,
        batch: presentBatchListItem(batch),
        wizard: batch.wizardStepJson,
        apiBuildVersion: getBuildVersionPayload(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "upload_failed";
      return reply.status(400).send({ ok: false, error: message });
    }
  });

  app.get("/bulk-imports/:id", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    const detail = await getBulkImportDetail(params.data.id);
    if (!detail) return reply.status(404).send({ ok: false, error: "not_found" });

    return reply.send({
      ok: true,
      batch: {
        ...presentBatchListItem(detail.batch),
        mappingJson: detail.batch.mappingJson,
        defaultValuesJson: detail.batch.defaultValuesJson,
        importOptionsJson: detail.batch.importOptionsJson,
        wizardStepJson: detail.batch.wizardStepJson,
        rows: detail.rows,
      },
      summary: detail.summary,
      deliveryMonitor: detail.deliveryMonitor ?? null,
      apiBuildVersion: getBuildVersionPayload(),
    });
  });

  app.get("/bulk-imports/:id/export-results", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    const detail = await getBulkImportDetail(params.data.id);
    if (!detail) return reply.status(404).send({ ok: false, error: "not_found" });

    const csv = exportBulkImportResultsCsv(
      detail.batch.rows.map((r) => ({
        rowNumber: r.rowNumber,
        sourceLeadId: r.sourceLeadId,
        validationStatus: r.validationStatus,
        deliveryStatus: r.deliveryStatus,
        ghlContactId: r.ghlContactId,
        errorSummary: r.errorSummary,
      }))
    );

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="bulk-import-${params.data.id}-results.csv"`
    );
    return reply.send(csv);
  });

  app.post("/bulk-imports/:id/mapping", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportMappingBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });

    try {
      const result = await saveBulkImportMapping(
        params.data.id,
        body.data.mapping,
        body.data.defaultValues,
        body.data.resetConfirmation
      );

      if (body.data.templateName) {
        await createBulkLeadImportMappingTemplate({
          name: body.data.templateName,
          mappingJson: body.data.mapping,
        });
      }

      return reply.send({
        ok: true,
        mappingChanged: result.mappingChanged,
        resetRequired: result.resetRequired,
        resetPerformed: result.resetPerformed,
        nextStep: result.nextStep,
        impact: result.impact ?? null,
        batch: {
          ...presentBatchListItem(result.batch),
          mappingJson: result.batch.mappingJson,
          wizardStepJson: result.batch.wizardStepJson,
          status: result.batch.status,
        },
      });
    } catch (err) {
      if (err instanceof MappingChangeRequiresResetError) {
        return reply.status(409).send({
          ok: false,
          error: "mapping_change_requires_reset",
          message:
            "Saving these mapping changes requires rebuilding normalized Source Intake records.",
          ...err.impact,
        });
      }
      const error = err instanceof Error ? err.message : "mapping_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/destination", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportDestinationBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });

    try {
      const result = await setBulkImportDestinationWithResponse(params.data.id, body.data);
      return reply.send({ ok: true, ...result });
    } catch (err) {
      const error = err instanceof Error ? err.message : "destination_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/normalize", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    try {
      const result = await normalizeBulkImportBatch(params.data.id);
      return reply.send({ ok: true, ...result });
    } catch (err) {
      const error = err instanceof Error ? err.message : "normalize_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/simulate", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportSimulateBodySchema.safeParse(request.body ?? {});

    try {
      const result = await simulateBulkImportRows(
        params.data.id,
        body.success ? body.data : undefined
      );
      if (!result.ok) {
        return reply.status(409).send(result);
      }
      return reply.send(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : "simulate_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.get("/bulk-imports/:id/live-canary-preflight", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    const batch = await findBulkLeadImportById(params.data.id);
    if (!batch) return reply.status(404).send({ ok: false, error: "not_found" });

    const { runBulkImportLiveCanaryPreflightForBatch } = await import(
      "../services/bulk-import/bulk-import-live-canary-preflight.service.js"
    );
    const preflight = await runBulkImportLiveCanaryPreflightForBatch(batch);
    return reply.send({ ok: true, preflight });
  });

  app.get("/bulk-imports/:id/delivery-monitor", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    const { getBulkImportDeliveryMonitor, getBulkImportWorkerDiagnostics } = await import(
      "../services/bulk-import/bulk-import-queue-monitor.service.js"
    );
    const monitor = await getBulkImportDeliveryMonitor(params.data.id);
    if (!monitor) return reply.status(404).send({ ok: false, error: "not_found" });

    return reply.send({
      ok: true,
      monitor,
      workerDiagnostics: getBulkImportWorkerDiagnostics(),
    });
  });

  app.post("/bulk-imports/:id/approve-delivery", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportApproveBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });

    try {
      const result = await approveBulkImportDelivery(params.data.id, body.data);
      return reply.send({ ...result, ok: true });
    } catch (err) {
      const { BulkImportApprovalError } = await import(
        "../services/bulk-import/bulk-import-approval.error.js"
      );
      if (err instanceof BulkImportApprovalError) {
        return reply.status(bulkImportErrorStatus(err.code)).send({
          ok: false,
          error: err.code,
          blockers: err.blockers,
          message: err.message,
        });
      }
      const error = err instanceof Error ? err.message : "approve_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/rows/action", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportRowActionBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });

    for (const rowId of body.data.rowIds) {
      await updateBulkLeadImportRow(rowId, {
        excluded: body.data.action === "exclude",
        validationStatus: body.data.action === "exclude" ? "excluded" : "pending",
      });
    }

    return reply.send({ ok: true });
  });

  app.post("/bulk-imports/:id/pause", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const batch = await updateBulkLeadImport(params.data.id, {
      status: "paused",
      pausedAt: new Date(),
    });
    return reply.send({ ok: true, batch: presentBatchListItem(batch) });
  });

  app.get("/bulk-imports/:id/delete-preview", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    try {
      const preview = await getBulkImportDeletePreview(params.data.id);
      return reply.send({ ok: true, preview });
    } catch (err) {
      const error = err instanceof Error ? err.message : "preview_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.delete("/bulk-imports/:id", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportConfirmationBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });
    try {
      const result = await deleteBulkImportBatch(params.data.id, body.data.confirmationText);
      return reply.send(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : "delete_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/cancel", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportConfirmationBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });
    try {
      const result = await cancelBulkImportBatch(params.data.id, body.data.confirmationText);
      const batch = await findBulkLeadImportById(params.data.id);
      return reply.send({ ...result, batch: batch ? presentBatchListItem(batch) : null });
    } catch (err) {
      const error = err instanceof Error ? err.message : "cancel_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/reset", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportResetBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });
    try {
      const result = await resetBulkImportBatch(
        params.data.id,
        body.data.target,
        body.data.confirmationText
      );
      const detail = await getBulkImportDetail(params.data.id);
      return reply.send({ ...result, batch: detail?.batch ? presentBatchListItem(detail.batch) : null });
    } catch (err) {
      const error = err instanceof Error ? err.message : "reset_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/:id/wizard-step", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportWizardStepBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });
    try {
      const batch = await setBulkImportWizardStep(params.data.id, body.data.step);
      return reply.send({ ok: true, batch: presentBatchListItem(batch) });
    } catch (err) {
      const error = err instanceof Error ? err.message : "wizard_step_failed";
      return reply.status(bulkImportErrorStatus(error)).send({ ok: false, error });
    }
  });

  app.post("/bulk-imports/internal/process-chunk", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const body = z
      .object({
        batchId: z.string(),
        rowIds: z.array(z.string()).min(1),
        approvedBy: z.string().optional(),
        chunkIndex: z.number().int().nonnegative().optional(),
        jobId: z.string().optional(),
        attemptNumber: z.number().int().positive().optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });

    const { processBulkImportDeliveryChunk } = await import(
      "../services/bulk-import/bulk-import-delivery.service.js"
    );
    const result = await processBulkImportDeliveryChunk(body.data);
    return reply.send({ ...result, ok: true });
  });
}
