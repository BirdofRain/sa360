import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  leadOrderAdminCreateBodySchema,
  leadOrderAdminUpdateBodySchema,
  leadOrderIdParamSchema,
  leadOrderListQuerySchema,
} from "../schemas/lead-order.schema.js";
import {
  presentLeadOrderDetail,
  presentLeadOrderListRow,
} from "../services/lead-order/lead-order-present.service.js";
import {
  createAdminLeadOrder,
  getLeadOrderForAudience,
  listLeadOrdersForAudience,
  updateAdminLeadOrder,
  type LeadOrderServiceDeps,
} from "../services/lead-order/lead-order.service.js";
import type {
  LeadOrderAdminRow,
  LeadOrderClientRow,
  LeadOrderCreateResponse,
  LeadOrderDetailResponse,
  LeadOrderListResponse,
  LeadOrderUpdateResponse,
} from "../services/lead-order/lead-order.types.js";

export type AdminLeadOrderRoutesOptions = LeadOrderServiceDeps;

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export const adminLeadOrderRoutes: FastifyPluginAsync<AdminLeadOrderRoutesOptions> = async (
  app: FastifyInstance,
  opts
) => {
  const deps: LeadOrderServiceDeps = opts;

  app.get("/lead-orders", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = leadOrderListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    const { items, nextCursor } = await listLeadOrdersForAudience(
      {
        limit: q.limit,
        cursor: q.cursor,
        status: q.status,
        clientAccountId: q.clientAccountId,
        nicheKey: q.nicheKey,
      },
      deps
    );

    const response: LeadOrderListResponse = {
      ok: true,
      items: items.map((row) => presentLeadOrderListRow(row, "admin")) as LeadOrderAdminRow[],
      nextCursor,
    };
    return reply.send(response);
  });

  app.get("/lead-orders/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = leadOrderIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: parsed.error.flatten(),
      });
    }

    const row = await getLeadOrderForAudience(parsed.data.id, undefined, deps);
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Lead order not found" });
    }

    const response: LeadOrderDetailResponse = {
      ok: true,
      item: presentLeadOrderDetail(row, "admin") as LeadOrderAdminRow,
    };
    return reply.send(response);
  });

  app.post("/lead-orders", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = leadOrderAdminCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const row = await createAdminLeadOrder(parsed.data, deps);
    const response: LeadOrderCreateResponse = {
      ok: true,
      item: presentLeadOrderDetail(row, "admin") as LeadOrderAdminRow,
    };
    return reply.status(201).send(response);
  });

  app.patch("/lead-orders/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const paramParsed = leadOrderIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: paramParsed.error.flatten(),
      });
    }

    const bodyParsed = leadOrderAdminUpdateBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: bodyParsed.error.flatten(),
      });
    }

    const row = await updateAdminLeadOrder(paramParsed.data.id, bodyParsed.data, deps);
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Lead order not found" });
    }

    const response: LeadOrderUpdateResponse = {
      ok: true,
      item: presentLeadOrderDetail(row, "admin") as LeadOrderAdminRow,
    };
    return reply.send(response);
  });
};
