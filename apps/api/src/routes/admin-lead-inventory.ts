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
};
