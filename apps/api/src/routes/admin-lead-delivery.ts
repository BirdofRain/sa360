import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  leadDeliveryIdParamSchema,
  leadDeliveryListQuerySchema,
} from "../schemas/lead-delivery.schema.js";
import {
  getLeadDeliveryReadModelById,
  listLeadDeliveryReadModel,
  type LeadDeliveryReadServiceDeps,
} from "../services/lead-delivery/lead-delivery-read.service.js";
import {
  presentLeadDeliveryDetail,
  presentLeadDeliveryListRow,
} from "../services/lead-delivery/lead-delivery-present.service.js";
import type {
  LeadDeliveryDetailResponse,
  LeadDeliveryListResponse,
} from "../services/lead-delivery/lead-delivery.types.js";

export type AdminLeadDeliveryRoutesOptions = LeadDeliveryReadServiceDeps & {
  listLeadDeliveryReadModelImpl?: typeof listLeadDeliveryReadModel;
  getLeadDeliveryReadModelByIdImpl?: typeof getLeadDeliveryReadModelById;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export const adminLeadDeliveryRoutes: FastifyPluginAsync<AdminLeadDeliveryRoutesOptions> = async (
  app: FastifyInstance,
  opts
) => {
  const deps: LeadDeliveryReadServiceDeps = opts;
  const listRead = opts.listLeadDeliveryReadModelImpl ?? listLeadDeliveryReadModel;
  const getById = opts.getLeadDeliveryReadModelByIdImpl ?? getLeadDeliveryReadModelById;

  app.get("/lead-delivery", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = leadDeliveryListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    const { items, nextCursor } = await listRead(
      {
        limit: q.limit,
        cursor: q.cursor,
        clientAccountIdResolved: q.clientAccountId,
        matched: q.matched,
        status: q.status as never,
        sourceProvider: q.sourceProvider,
        includeCleanup: q.includeCleanup,
        cleanupStatus: q.cleanupStatus,
      },
      deps
    );

    const response: LeadDeliveryListResponse = {
      ok: true,
      items: items.map((ctx) => presentLeadDeliveryListRow(ctx, "admin")),
      nextCursor,
    };
    return reply.send(response);
  });

  app.get("/lead-delivery/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = leadDeliveryIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: parsed.error.flatten(),
      });
    }

    const ctx = await getById(parsed.data.id, deps);
    if (!ctx) {
      return reply.status(404).send({ ok: false, error: "Lead delivery record not found" });
    }

    const response: LeadDeliveryDetailResponse = {
      ok: true,
      item: presentLeadDeliveryDetail(ctx, "admin"),
    };
    return reply.send(response);
  });
};
