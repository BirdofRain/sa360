import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { deliveryRuntimeModePostBodySchema } from "../schemas/delivery-runtime-mode.schema.js";
import {
  getDeliveryRuntimeModeStatus,
  setDeliveryRuntimeMode,
} from "../services/delivery-runtime-mode.service.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminDeliveryRuntimeModeRoutes(app: FastifyInstance) {
  app.get("/delivery-runtime-mode", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const status = await getDeliveryRuntimeModeStatus();
    return reply.send({
      ok: true,
      effectiveMode: status.effectiveMode,
      configuredRuntimeMode: status.configuredRuntimeMode,
      maxAllowedMode: status.maxAllowedMode,
      liveCanaryEnabledUntil: status.liveCanaryEnabledUntil,
      canRunLiveCanary: status.canRunLiveCanary,
      reason: status.reason,
      enabledBy: status.enabledBy,
      enabledAt: status.enabledAt,
      lastChangedAt: status.lastChangedAt,
    });
  });

  app.post("/delivery-runtime-mode", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = deliveryRuntimeModePostBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const result = await setDeliveryRuntimeMode(parsed.data);
    if (!result.ok) {
      const status =
        result.code === "CONFIRMATION" ? 400 : result.code === "MAX_MODE" ? 403 : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }

    const s = result.status;
    return reply.send({
      ok: true,
      effectiveMode: s.effectiveMode,
      configuredRuntimeMode: s.configuredRuntimeMode,
      maxAllowedMode: s.maxAllowedMode,
      liveCanaryEnabledUntil: s.liveCanaryEnabledUntil,
      canRunLiveCanary: s.canRunLiveCanary,
      reason: s.reason,
      enabledBy: s.enabledBy,
      enabledAt: s.enabledAt,
      lastChangedAt: s.lastChangedAt,
    });
  });
}
