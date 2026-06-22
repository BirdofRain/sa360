import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { deliveryReadinessListQuerySchema } from "../schemas/delivery-readiness.schema.js";
import { listCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import { presentRoutingRulesWithReadinessEnriched } from "../services/delivery-readiness-admin.present.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export type AdminDeliveryReadinessRoutesDeps = {
  listCampaignRoutingRules?: typeof listCampaignRoutingRules;
  presentRoutingRulesWithReadinessEnriched?: typeof presentRoutingRulesWithReadinessEnriched;
};

export async function adminDeliveryReadinessRoutes(
  app: FastifyInstance,
  opts: AdminDeliveryReadinessRoutesDeps = {}
) {
  const listRules = opts.listCampaignRoutingRules ?? listCampaignRoutingRules;
  const presentRules =
    opts.presentRoutingRulesWithReadinessEnriched ?? presentRoutingRulesWithReadinessEnriched;

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
    // No master/client filter → return ALL routing/delivery readiness rows. Callers may still
    // filter by masterClientAccountId and/or clientAccountId.
    const rows = await listRules({
      masterClientAccountId: q.masterClientAccountId,
      clientAccountId: q.clientAccountId,
      destinationSubaccountIdGhl: q.destinationSubaccountIdGhl,
      readinessStatus: q.status,
    });
    const items = await presentRules(rows);
    return reply.send({ ok: true, count: items.length, items });
  });
}
