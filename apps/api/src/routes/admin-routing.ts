import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  routingDryRunBodySchema,
  routingDryRunListQuerySchema,
  routingDryRunValidationPatchSchema,
} from "../schemas/routing.schema.js";
import { listRecentRoutingDryRunDecisions } from "../repositories/routing-dry-run-decision.repository.js";
import { presentRoutingDryRunDecisions } from "../services/routing-dry-run-admin.present.js";
import { runRoutingDryRun } from "../services/routing-dry-run.service.js";
import { updateRoutingDryRunValidation } from "../services/routing-dry-run-validation.service.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminRoutingRoutes(app: FastifyInstance) {
  /** Recent dry-run routing decisions for C.O.C. review. */
  app.get("/routing/dry-run-decisions", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingDryRunListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const { masterClientAccountId, limit, matched, validationStatus } = parsed.data;
    const rows = await listRecentRoutingDryRunDecisions({
      masterClientAccountId,
      limit,
      matched,
      validationStatus,
    });
    const items = await presentRoutingDryRunDecisions(rows);
    return reply.send({
      ok: true,
      masterClientAccountId,
      count: items.length,
      items,
    });
  });

  /** On-demand dry-run for a lifecycle payload (no delivery). */
  app.post("/routing/dry-run", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingDryRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await runRoutingDryRun(parsed.data.payload, {}, {
      debug: parsed.data.debug === true,
    });
    return reply.send({ ok: true, result });
  });

  /** Operator validation / legacy delivery comparison for a dry-run decision. */
  app.patch("/routing/dry-run-decisions/:id/validation", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = routingDryRunValidationPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await updateRoutingDryRunValidation(id, parsed.data);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Decision not found" });
    }
    return reply.send({ ok: true, item: result.item });
  });
}
