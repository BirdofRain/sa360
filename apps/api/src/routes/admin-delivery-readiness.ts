import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  deliveryReadinessListQuerySchema,
  routingRuleDeliveryConfigPatchSchema,
  routingRulesListQuerySchema,
} from "../schemas/delivery-readiness.schema.js";
import { listCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import { presentRoutingRulesWithReadiness } from "../services/delivery-readiness-admin.present.js";
import { patchRoutingRuleDeliveryConfig } from "../services/routing-rule-delivery-config.service.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminDeliveryReadinessRoutes(app: FastifyInstance) {
  app.get("/delivery-readiness", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = deliveryReadinessListQuerySchema.safeParse(request.query);
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
      destinationSubaccountIdGhl: q.destinationSubaccountIdGhl,
      readinessStatus: q.status,
    });
    const items = presentRoutingRulesWithReadiness(rows);
    return reply.send({ ok: true, count: items.length, items });
  });

  app.get("/routing/rules", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingRulesListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const { masterClientAccountId, clientAccountId, active } = parsed.data;
    const rows = await listCampaignRoutingRules({
      masterClientAccountId,
      clientAccountId,
      active,
    });
    const items = presentRoutingRulesWithReadiness(rows);
    return reply.send({ ok: true, masterClientAccountId, count: items.length, items });
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
      const status = result.code === "CONFIRMATION_REQUIRED" ? 400 : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }
    return reply.send({ ok: true, item: result.item });
  });
}
