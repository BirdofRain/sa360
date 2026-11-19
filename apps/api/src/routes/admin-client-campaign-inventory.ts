import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { readClientCampaignInventory } from "../services/client-campaign-inventory/client-campaign-inventory.read.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

/** Read-only multi-campaign inventory. This route has no write handler. */
export async function adminClientCampaignInventoryRoutes(app: FastifyInstance) {
  app.get("/clients/:clientAccountId/campaign-inventory", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const result = await readClientCampaignInventory(clientAccountId);
    if (!result.ok) {
      return reply.status(result.statusCode).send({ ok: false, error: result.error });
    }
    return reply.send(result.inventory);
  });
}
