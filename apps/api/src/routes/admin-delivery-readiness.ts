import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { deliveryReadinessListQuerySchema } from "../schemas/delivery-readiness.schema.js";
import { listCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import { presentRoutingRulesWithReadiness } from "../services/delivery-readiness-admin.present.js";

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

}
