import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { getBuildVersionPayload } from "../lib/build-version.js";
import { directDemoDeliveryBodySchema } from "../schemas/lead-delivery-direct-demo.schema.js";
import {
  runDirectDemoDelivery,
  type DirectDemoDeliveryDeps,
  type DirectDemoDeliveryResult,
} from "../services/lead-delivery/direct-demo-delivery.service.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export type AdminLeadDeliveryDirectDemoRoutesOptions = {
  runDirectDemoDeliveryImpl?: (
    body: Parameters<typeof runDirectDemoDelivery>[0],
    deps?: DirectDemoDeliveryDeps
  ) => Promise<DirectDemoDeliveryResult>;
};

export async function adminLeadDeliveryDirectDemoRoutes(
  app: FastifyInstance,
  opts: AdminLeadDeliveryDirectDemoRoutesOptions = {}
) {
  const deliver = opts.runDirectDemoDeliveryImpl ?? runDirectDemoDelivery;

  app.post("/lead-delivery/direct-demo", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = directDemoDeliveryBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_payload",
        reason: "Request body failed validation.",
        details: parsed.error.flatten(),
        blockers: ["Invalid normalized lifecycle payload or mode."],
        warnings: [],
        externalCallExecuted: false,
      });
    }

    try {
      const result = await deliver(parsed.data);
      const status = result.ok ? 200 : result.error === "invalid_payload" ? 400 : 409;
      return reply.status(status).send({
        ...result,
        apiBuildVersion: getBuildVersionPayload(),
      });
    } catch (err) {
      request.log.error({ err }, "direct_demo_delivery_unhandled");
      return reply.status(500).send({
        ok: false,
        error: "delivery_blocked",
        reason: err instanceof Error ? err.message : "Direct demo delivery failed unexpectedly.",
        mode: parsed.data.mode,
        matched: false,
        destinationClientAccountId: null,
        destinationSubaccountIdGhl: null,
        routingDryRunDecisionId: null,
        deliveryPlanId: null,
        adapterRunId: null,
        liveRunId: null,
        externalCallExecuted: false,
        blockers: ["Unexpected server error during direct demo delivery."],
        warnings: [],
        nextAction: "Check API logs and retry.",
      });
    }
  });
}
