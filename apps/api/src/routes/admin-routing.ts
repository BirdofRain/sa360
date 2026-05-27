import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  routingDryRunBodySchema,
  routingDryRunListQuerySchema,
} from "../schemas/routing.schema.js";
import { listRecentRoutingDryRunDecisions } from "../repositories/routing-dry-run-decision.repository.js";
import { runRoutingDryRun } from "../services/routing-dry-run.service.js";

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
    const { masterClientAccountId, limit, matched } = parsed.data;
    const items = await listRecentRoutingDryRunDecisions({
      masterClientAccountId,
      limit,
      matched,
    });
    return reply.send({
      ok: true,
      masterClientAccountId,
      count: items.length,
      items: items.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        sourceEventUuid: row.sourceEventUuid,
        sourceLeadUid: row.sourceLeadUid,
        matched: row.matched,
        confidence: row.confidence,
        matchedRuleId: row.matchedRuleId,
        destinationClientAccountId: row.destinationClientAccountId,
        destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
        reason: row.matchReason,
        deliveryMode: row.deliveryMode,
        routingEventNameInternal: row.routingEventNameInternal,
        attributionSnapshot: row.attributionSnapshot,
      })),
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
    const result = await runRoutingDryRun(parsed.data.payload);
    return reply.send({ ok: true, result });
  });
}
