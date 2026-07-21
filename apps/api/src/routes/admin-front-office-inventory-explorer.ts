import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { getInventoryExplorerService } from "../services/inventory-explorer/inventory-explorer.service.js";

const querySchema = z.object({
  forceRefresh: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

/**
 * GET /admin/v1/front-office/inventory-explorer
 * Authenticated aggregate read — no inventory mutations.
 */
export const adminFrontOfficeInventoryExplorerRoutes: FastifyPluginAsync =
  async (app) => {
    app.get("/front-office/inventory-explorer", async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;

      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: "Invalid query",
          details: parsed.error.flatten(),
        });
      }

      const service = getInventoryExplorerService();
      const model = await service.getReadModel({
        forceRefresh: parsed.data.forceRefresh,
      });

      return reply.send({
        ok: true,
        ...model,
      });
    });
  };
