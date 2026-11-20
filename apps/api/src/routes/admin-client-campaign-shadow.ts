/**
 * Read-only shadow decision for one source lead.
 * This route does not resolve, write, tag, or deliver.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isClientCampaignShadowResolutionEnabled } from "../lib/client-campaign-shadow-env.js";
import { prisma } from "../lib/db.js";
import { presentClientCampaignShadow } from "../services/client-campaign-shadow/present-client-campaign-shadow.js";
import { CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION } from "../services/client-campaign-shadow/resolve-client-campaign-shadow.js";
import { sourceLeadIdParamSchema } from "../schemas/source-lead.schema.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminClientCampaignShadowRoutes(app: FastifyInstance) {
  app.get("/source-leads/:id/campaign-shadow", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: "invalid_id" });

    const event = await prisma.sourceLeadEvent.findUnique({
      where: { id: params.data.id },
      select: { id: true },
    });
    if (!event) return reply.status(404).send({ ok: false, error: "not_found" });

    const row = await prisma.clientCampaignShadowDecision.findUnique({
      where: {
        sourceLeadEventId_decisionVersion: {
          sourceLeadEventId: params.data.id,
          decisionVersion: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
        },
      },
    });
    return reply.send(
      presentClientCampaignShadow({
        row,
        shadowEnabled: isClientCampaignShadowResolutionEnabled(),
      })
    );
  });
}
