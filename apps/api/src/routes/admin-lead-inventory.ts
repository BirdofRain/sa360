import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { buildLeadInventorySummary } from "../services/lead-inventory/lead-inventory-summary.service.js";
import { buildLeadInventoryFacets } from "../services/lead-inventory/lead-inventory-facets.service.js";
import {
  buildInventoryLotDetail,
  buildInventoryLotsWithCounts,
  buildLeadInventoryItemDetail,
  buildLeadInventoryItemsList,
} from "../services/lead-inventory/lead-inventory-query.service.js";
import { buildLeadInventoryImportPreview } from "../services/lead-inventory/lead-inventory-import-preview.service.js";
import { buildAgedInventoryImportPreview } from "../services/aged-inventory-import/aged-inventory-import-preview.service.js";
import {
  commitAgedInventoryImport,
  getAgedInventoryImportBatchByRequestId,
} from "../services/aged-inventory-import/aged-inventory-import-commit.service.js";
import { buildAgedInventoryErrorReportCsv } from "../services/aged-inventory-import/aged-inventory-import-error-report.service.js";
import {
  fingerprintAgedInventoryCsv,
  parseAgedInventoryCsv,
  validateAgedInventoryMapping,
} from "../services/aged-inventory-import/aged-inventory-import-mapping.service.js";
import { normalizeAndClassifyAgedInventoryRows } from "../services/aged-inventory-import/aged-inventory-import-classify.service.js";
import { isLeadInventoryReviewEnabled } from "../lib/lead-inventory-review-env.js";
import {
  commitLeadInventoryReviewAction,
  getLeadInventoryReviewActionByRequestId,
  previewLeadInventoryReviewAction,
} from "../services/lead-inventory-review/lead-inventory-review-action.service.js";
import {
  buildLeadInventoryReviewItemDetail,
  buildLeadInventoryReviewItemsList,
  buildLeadInventoryReviewSummary,
} from "../services/lead-inventory-review/lead-inventory-review-query.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const facetQuerySchema = z
  .object({
    nicheKey: z.string().trim().min(1).optional(),
    productType: z.string().trim().min(1).optional(),
    inventoryClass: z.string().trim().min(1).optional(),
    sourceLane: z.string().trim().min(1).optional(),
    lotId: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    availableOnly: z
      .union([z.literal("true"), z.literal("false")])
      .optional()
      .transform((v) => v === "true"),
    ageBandVersion: z.string().trim().min(1).optional(),
  })
  .strict();

const itemsQuerySchema = facetQuerySchema.extend({
  state: z.string().trim().min(1).optional(),
  ageBandKey: z.string().trim().min(1).optional(),
  minAgeDays: z.coerce.number().int().min(0).optional(),
  maxAgeDays: z.coerce.number().int().min(0).optional(),
  available: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  proofStatus: z.string().trim().min(1).optional(),
  verificationStatus: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const importPreviewSchema = z
  .object({
    sourceLane: z.string().trim().min(1).optional(),
    campaignId: z.string().trim().min(1).optional(),
    formId: z.string().trim().min(1).optional(),
    receivedFrom: z.string().trim().min(1).optional(),
    receivedTo: z.string().trim().min(1).optional(),
    inventoryClass: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const agedImportPreviewSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    csvText: z.string().min(1),
    mapping: z.record(z.string(), z.string()).optional(),
    dateFormat: z.enum(["iso_date", "iso_datetime", "mdy_slash"]).optional(),
    defaultNicheKey: z.string().trim().min(1).optional(),
    defaultProductType: z.string().trim().min(1).optional(),
    uploadedBy: z.string().trim().min(1).optional(),
  })
  .strict();

const agedImportCommitSchema = z
  .object({
    requestId: z.string().trim().min(8).max(128),
    fileName: z.string().trim().min(1).max(255),
    csvText: z.string().min(1),
    fileFingerprint: z.string().trim().min(32).max(128),
    mapping: z.record(z.string(), z.string()),
    dateFormat: z.enum(["iso_date", "iso_datetime", "mdy_slash"]).optional(),
    lotKey: z.string().trim().min(1).max(128),
    lotDisplayName: z.string().trim().min(1).max(255),
    inventoryClass: z.literal("aged"),
    exclusivityMode: z.enum(["exclusive", "shared", "configurable"]),
    nicheKey: z.string().trim().min(1),
    productType: z.string().trim().min(1).nullable().optional(),
    sourceProvider: z.literal("manual_import"),
    sourceLane: z.string().trim().min(1).optional(),
    operatorNote: z.string().trim().min(1).max(2000),
    confirmation: z.string().trim().min(1),
    uploadedBy: z.string().trim().min(1).optional(),
  })
  .strict();

const reviewItemsQuerySchema = z
  .object({
    status: z.string().trim().min(1).optional(),
    importBatchRequestId: z.string().trim().min(1).optional(),
    inventoryLotId: z.string().trim().min(1).optional(),
    normalizedState: z.string().trim().min(1).optional(),
    ageBandKey: z.string().trim().min(1).optional(),
    nicheKey: z.string().trim().min(1).optional(),
    productType: z.string().trim().min(1).optional(),
    sourceLane: z.string().trim().min(1).optional(),
    blockerCode: z.string().trim().min(1).optional(),
    generatedFrom: z.string().trim().min(1).optional(),
    generatedTo: z.string().trim().min(1).optional(),
    cursor: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const reviewActionPreviewSchema = z
  .object({
    requestId: z.string().trim().min(8).max(128),
    actionType: z.enum(["make_available", "quarantine", "reject"]),
    itemIds: z.array(z.string().trim().min(1)).min(1).max(100),
    reasonCode: z.string().trim().min(1).max(128).optional().nullable(),
    operatorNote: z.string().trim().max(500).optional().nullable(),
    requestedBy: z.string().trim().min(1).max(128).optional().nullable(),
  })
  .strict();

const reviewActionCommitSchema = reviewActionPreviewSchema
  .extend({
    selectionFingerprint: z.string().trim().min(32).max(128),
    confirmationPhrase: z.string().trim().min(1),
  })
  .strict();

export const adminLeadInventoryRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/lead-inventory/summary", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const summary = await buildLeadInventorySummary();
    return reply.send({ ok: true, summary });
  });

  app.get("/lead-inventory/facets", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = facetQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_query" });
    const facets = await buildLeadInventoryFacets(parsed.data);
    return reply.send({ ok: true, facets });
  });

  app.get("/lead-inventory/items", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = itemsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_query" });
    const result = await buildLeadInventoryItemsList(parsed.data);
    return reply.send({ ok: true, ...result });
  });

  app.get("/lead-inventory/items/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const id = (request.params as { id?: string }).id?.trim();
    if (!id) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const detail = await buildLeadInventoryItemDetail(id);
    if (!detail) return reply.status(404).send({ ok: false, error: "not_found" });
    return reply.send({ ok: true, item: detail });
  });

  app.get("/lead-inventory/lots", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const result = await buildInventoryLotsWithCounts();
    return reply.send({ ok: true, ...result });
  });

  app.get("/lead-inventory/lots/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const id = (request.params as { id?: string }).id?.trim();
    if (!id) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const detail = await buildInventoryLotDetail(id);
    if (!detail) return reply.status(404).send({ ok: false, error: "not_found" });
    return reply.send({ ok: true, ...detail });
  });

  app.post("/lead-inventory/import-preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = importPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const preview = await buildLeadInventoryImportPreview(parsed.data);
    return reply.send(preview);
  });

  app.post("/lead-inventory/imports/preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = agedImportPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const preview = await buildAgedInventoryImportPreview(parsed.data);
    if (!preview.ok) return reply.status(400).send(preview);
    return reply.send(preview);
  });

  app.post("/lead-inventory/imports/commit", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = agedImportCommitSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const result = await commitAgedInventoryImport(parsed.data);
    if (!result.ok) return reply.status(400).send(result);
    return reply.status(result.idempotentReplay ? 200 : 201).send(result);
  });

  app.get("/lead-inventory/imports/batches/:requestId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const requestId = (request.params as { requestId?: string }).requestId?.trim();
    if (!requestId) return reply.status(400).send({ ok: false, error: "invalid_request_id" });
    const batch = await getAgedInventoryImportBatchByRequestId(requestId);
    if (!batch) return reply.status(404).send({ ok: false, error: "not_found" });
    return reply.send({ ok: true, batch });
  });

  app.post("/lead-inventory/imports/error-report", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const bodySchema = z
      .object({
        fileName: z.string().trim().min(1),
        csvText: z.string().min(1),
        mapping: z.record(z.string(), z.string()),
        dateFormat: z.enum(["iso_date", "iso_datetime", "mdy_slash"]).optional(),
        defaultNicheKey: z.string().trim().min(1).optional(),
      })
      .strict();
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const fingerprint = fingerprintAgedInventoryCsv(parsed.data.csvText);
    const mappingErrors = validateAgedInventoryMapping(parsed.data.mapping);
    const csvParsed = parseAgedInventoryCsv(parsed.data.csvText);
    const rows = await normalizeAndClassifyAgedInventoryRows({
      rows: csvParsed.rows,
      mapping: parsed.data.mapping,
      mappingErrors,
      dateFormat: parsed.data.dateFormat,
      defaultNicheKey: parsed.data.defaultNicheKey,
    });
    const csv = buildAgedInventoryErrorReportCsv(rows);
    return reply.send({
      ok: true,
      fileFingerprint: fingerprint,
      fileName: `${parsed.data.fileName.replace(/\.csv$/i, "")}-errors.csv`,
      csvText: csv,
      writesPerformed: 0,
    });
  });

  app.get("/lead-inventory/review/summary", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const summary = await buildLeadInventoryReviewSummary();
    return reply.send({
      ok: true,
      featureEnabled: isLeadInventoryReviewEnabled(),
      summary,
    });
  });

  app.get("/lead-inventory/review/items", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = reviewItemsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }
    const result = await buildLeadInventoryReviewItemsList(parsed.data);
    return reply.send({
      ok: true,
      featureEnabled: isLeadInventoryReviewEnabled(),
      ...result,
    });
  });

  app.get("/lead-inventory/review/items/:itemId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const itemId = (request.params as { itemId?: string }).itemId?.trim();
    if (!itemId) return reply.status(400).send({ ok: false, error: "invalid_id" });
    const detail = await buildLeadInventoryReviewItemDetail(itemId);
    if (!detail) return reply.status(404).send({ ok: false, error: "not_found" });
    return reply.send({
      ok: true,
      featureEnabled: isLeadInventoryReviewEnabled(),
      item: detail,
    });
  });

  app.post("/lead-inventory/review/actions/preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = reviewActionPreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const preview = await previewLeadInventoryReviewAction(parsed.data);
    if (!preview.ok) return reply.status(400).send(preview);
    return reply.send(preview);
  });

  app.post("/lead-inventory/review/actions/commit", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = reviewActionCommitSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const result = await commitLeadInventoryReviewAction(parsed.data);
    if (!result.ok) {
      const status = result.code === "review_activation_disabled" ? 403 : 400;
      return reply.status(status).send(result);
    }
    return reply.status(result.idempotentReplay ? 200 : 201).send(result);
  });

  app.get("/lead-inventory/review/actions/:requestId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const requestId = (request.params as { requestId?: string }).requestId?.trim();
    if (!requestId) return reply.status(400).send({ ok: false, error: "invalid_request_id" });
    const action = await getLeadInventoryReviewActionByRequestId(requestId);
    if (!action) return reply.status(404).send({ ok: false, error: "not_found" });
    return reply.send({
      ok: true,
      featureEnabled: isLeadInventoryReviewEnabled(),
      ...action,
    });
  });
};
