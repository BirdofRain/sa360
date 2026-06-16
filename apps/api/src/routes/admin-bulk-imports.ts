import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isBulkSourceImportsEnabled } from "../lib/bulk-import-feature-flag.js";
import { getBuildVersionPayload } from "../lib/build-version.js";
import {
  bulkImportApproveBodySchema,
  bulkImportDestinationBodySchema,
  bulkImportIdParamSchema,
  bulkImportListQuerySchema,
  bulkImportMappingBodySchema,
  bulkImportRowActionBodySchema,
  bulkImportSimulateBodySchema,
  bulkImportUploadBodySchema,
} from "../schemas/bulk-import.schema.js";
import {
  approveBulkImportDelivery,
  createBulkImportFromCsv,
  exportBulkImportResultsCsv,
  getBulkImportDetail,
  normalizeBulkImportBatch,
  saveBulkImportMapping,
  setBulkImportDestination,
  simulateBulkImportRows,
} from "../services/bulk-import/bulk-lead-import.service.js";
import {
  createBulkLeadImportMappingTemplate,
  listBulkLeadImportMappingTemplates,
  listBulkLeadImports,
  updateBulkLeadImport,
  updateBulkLeadImportRow,
} from "../repositories/bulk-lead-import.repository.js";
import { suggestFieldMappings } from "../services/bulk-import/csv-import-mapping.service.js";

const suggestMappingBodySchema = z.object({ headers: z.array(z.string()).min(1) }).strict();

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
        rows: detail.batch.rows.map((row) => ({
          id: row.id,
          rowNumber: row.rowNumber,
          sourceLeadId: row.sourceLeadId,
          validationStatus: row.validationStatus,
          duplicateStatus: row.duplicateStatus,
          deliveryStatus: row.deliveryStatus,
          excluded: row.excluded,
          sourceLeadEventId: row.sourceLeadEventId,
          ghlContactId: row.ghlContactId,
          errorSummary: row.errorSummary,
          blockerReasonsJson: row.blockerReasonsJson,
        })),
      },
      summary: detail.summary,
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

    const batch = await saveBulkImportMapping(
      params.data.id,
      body.data.mapping,
      body.data.defaultValues
    );

    if (body.data.templateName) {
      await createBulkLeadImportMappingTemplate({
        name: body.data.templateName,
        mappingJson: body.data.mapping,
      });
    }

    return reply.send({ ok: true, batch: presentBatchListItem(batch) });
  });

  app.post("/bulk-imports/:id/destination", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportDestinationBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_payload" });

    const batch = await setBulkImportDestination(params.data.id, body.data);
    return reply.send({ ok: true, batch: presentBatchListItem(batch) });
  });

  app.post("/bulk-imports/:id/normalize", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    const batch = await normalizeBulkImportBatch(params.data.id);
    return reply.send({ ok: true, batch: presentBatchListItem(batch) });
  });

  app.post("/bulk-imports/:id/simulate", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const params = bulkImportIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const body = bulkImportSimulateBodySchema.safeParse(request.body ?? {});

    const result = await simulateBulkImportRows(
      params.data.id,
      body.success ? body.data : undefined
    );
    return reply.send({ ...result, ok: true });
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
      const message = err instanceof Error ? err.message : "approve_failed";
      const status = message === "confirmation_required" ? 400 : 409;
      return reply.status(status).send({ ok: false, error: message });
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

  app.post("/bulk-imports/internal/process-chunk", async (request, reply) => {
    if (!(await requireBulkImport(request, reply))) return;
    const body = z
      .object({
        batchId: z.string(),
        rowIds: z.array(z.string()).min(1),
        approvedBy: z.string().optional(),
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
