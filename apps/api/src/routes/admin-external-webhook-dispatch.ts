import type { FastifyInstance } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isExternalWebhookDeliveryEnabled } from "../services/external-webhook/external-webhook-contract.js";
import { recoverExternalWebhookDeliveries } from "../services/external-webhook/external-webhook-queue.js";
import { deliverExternalWebhookAttempt } from "../services/external-webhook/external-webhook-send.js";

type RouteOpts = {
  deliver?: typeof deliverExternalWebhookAttempt;
  recover?: typeof recoverExternalWebhookDeliveries;
};

export async function adminExternalWebhookDispatchRoutes(app: FastifyInstance, opts: RouteOpts = {}) {
  const deliver = opts.deliver ?? deliverExternalWebhookAttempt;
  const recover = opts.recover ?? recoverExternalWebhookDeliveries;

  app.post("/external-webhook/internal/deliver", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (!isExternalWebhookDeliveryEnabled()) {
      return reply.send({ ok: true, skipped: "flag_off" });
    }
    const body = request.body as { attemptId?: unknown };
    const attemptId = typeof body?.attemptId === "string" ? body.attemptId.trim() : "";
    if (!attemptId) return reply.code(400).send({ ok: false, error: "attempt_id_required" });
    const result = await deliver(attemptId);
    return reply.send(result);
  });

  app.post("/external-webhook/internal/recover", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const result = await recover();
    return reply.send({ ok: true, ...result });
  });
}
