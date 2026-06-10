import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  adminDeleteConfirmQuerySchema,
  clientAccountCreateBodySchema,
  clientAccountListQuerySchema,
  clientAccountPatchBodySchema,
  clientGhlDestinationPatchBodySchema,
} from "../schemas/client-account.schema.js";
import {
  routingRuleCreateBodySchema,
  routingRulePatchBodySchema,
  routingRulesAdminListQuerySchema,
} from "../schemas/routing-rule.schema.js";
import {
  createClientAdmin,
  deleteClientAdmin,
  getClientAdmin,
  listClientsAdmin,
  patchClientAdmin,
  patchClientGhlDestinationAdmin,
} from "../services/client-account.service.js";
import { listCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import { presentRoutingRulesWithReadinessEnriched } from "../services/delivery-readiness-admin.present.js";
import {
  createRoutingRuleAdmin,
  deleteRoutingRuleAdmin,
  getRoutingRuleAdmin,
  patchRoutingRuleAdmin,
} from "../services/routing-rule-admin.service.js";
import { patchRoutingRuleDeliveryConfig } from "../services/routing-rule-delivery-config.service.js";
import { routingRuleDeliveryConfigPatchSchema } from "../schemas/delivery-readiness.schema.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminClientsRoutes(app: FastifyInstance) {
  app.get("/clients", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = clientAccountListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const items = await listClientsAdmin(parsed.data);
    return reply.send({ ok: true, count: items.length, items });
  });

  app.post("/clients", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = clientAccountCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await createClientAdmin(parsed.data);
    if ("error" in result) {
      return reply.status(409).send({ ok: false, error: result.error, code: result.code });
    }
    return reply.status(201).send({ ok: true, item: result });
  });

  app.delete("/clients/:clientAccountId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const parsed = adminDeleteConfirmQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const result = await deleteClientAdmin(clientAccountId, parsed.data.confirm === true);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    if ("error" in result) {
      return reply.status(400).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    return reply.send({ ok: true, ...result });
  });

  app.get("/clients/:clientAccountId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const item = await getClientAdmin(clientAccountId);
    if (!item) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    return reply.send({ ok: true, item });
  });

  app.patch("/clients/:clientAccountId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const parsed = clientAccountPatchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const item = await patchClientAdmin(clientAccountId, parsed.data);
    if (!item) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    return reply.send({ ok: true, item });
  });

  app.patch("/clients/:clientAccountId/ghl-destination", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const parsed = clientGhlDestinationPatchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await patchClientGhlDestinationAdmin(clientAccountId, parsed.data);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    if ("error" in result) {
      return reply.status(400).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    const item = await getClientAdmin(clientAccountId);
    return reply.send({ ok: true, item });
  });

  app.get("/routing/rules", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingRulesAdminListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    if (!q.masterClientAccountId && !q.clientAccountId) {
      return reply.status(400).send({
        ok: false,
        error: "masterClientAccountId or clientAccountId is required",
      });
    }
    const rows = await listCampaignRoutingRules({
      masterClientAccountId: q.masterClientAccountId,
      clientAccountId: q.clientAccountId,
      active: q.active,
    });
    const items = await presentRoutingRulesWithReadinessEnriched(rows);
    return reply.send({
      ok: true,
      count: items.length,
      items,
      masterClientAccountId: q.masterClientAccountId ?? null,
    });
  });

  app.get("/routing/rules/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const result = await getRoutingRuleAdmin(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    return reply.send({ ok: true, item: result.item });
  });

  app.delete("/routing/rules/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = adminDeleteConfirmQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const result = await deleteRoutingRuleAdmin(id, parsed.data.confirm === true);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    if ("error" in result) {
      return reply.status(400).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    return reply.send({ ok: true, ...result });
  });

  app.post("/routing/rules", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingRuleCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await createRoutingRuleAdmin(parsed.data);
    if ("error" in result) {
      const status = result.code === "CLIENT_NOT_FOUND" ? 400 : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    return reply.status(201).send({ ok: true, item: result.item });
  });

  app.patch("/routing/rules/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = routingRulePatchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await patchRoutingRuleAdmin(id, parsed.data);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    return reply.send({ ok: true, item: result.item });
  });

  app.patch("/routing/rules/:id/delivery-config", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = routingRuleDeliveryConfigPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await patchRoutingRuleDeliveryConfig(id, parsed.data);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    if ("error" in result) {
      return reply.status(400).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    return reply.send({ ok: true, item: result.item });
  });
}
