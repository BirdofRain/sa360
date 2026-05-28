import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  ghlAdapterRunsListQuerySchema,
  ghlAdapterSimulateBodySchema,
} from "../schemas/ghl-adapter.schema.js";
import {
  getGhlAdapterRunDetail,
  listGhlAdapterRunsPresented,
  runGhlAdapterSimulationForPlan,
} from "../services/ghl-delivery-adapter-run.service.js";
import { buildAdapterSimulation } from "../services/ghl-delivery-adapter/ghl-delivery-adapter.service.js";
import { GHL_ADAPTER_SAFETY_MESSAGE } from "../services/ghl-delivery-adapter/ghl-delivery-adapter.present.js";
import { findCampaignRoutingRuleById } from "../repositories/campaign-routing-rule.repository.js";
import { probeGhlLocationReadonly } from "../services/ghl-delivery-adapter/ghl-delivery-readonly-probe.js";
import { getGhlDeliveryAdapterMode } from "../lib/ghl-delivery-adapter-mode.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminGhlAdapterRoutes(app: FastifyInstance) {
  app.post("/delivery-plans/:id/ghl-adapter/simulate", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = ghlAdapterSimulateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await runGhlAdapterSimulationForPlan(id, {
      checkLiveReadiness: parsed.data?.checkLiveReadiness === true,
    });
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Delivery plan not found" });
    }
    const statusCode = result.ok ? 200 : 409;
    return reply.status(statusCode).send({
      ok: result.ok,
      adapterRun: result.adapterRun,
      validation: result.validation,
      safetyMessage: result.safetyMessage,
      adapterMode: result.adapterMode,
      blockedReason: result.blockedReason,
    });
  });

  app.get("/ghl-adapter/runs", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = ghlAdapterRunsListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const items = await listGhlAdapterRunsPresented(parsed.data);
    return reply.send({ ok: true, count: items.length, items });
  });

  app.get("/ghl-adapter/runs/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const result = await getGhlAdapterRunDetail(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Adapter run not found" });
    }
    return reply.send({
      ok: true,
      adapterRun: result.adapterRun,
      safetyMessage: GHL_ADAPTER_SAFETY_MESSAGE,
    });
  });

  app.post("/routing/rules/:id/ghl-readonly-probe", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const mode = getGhlDeliveryAdapterMode();
    if (mode !== "readonly_probe") {
      return reply.status(409).send({
        ok: false,
        error: "Readonly probe requires GHL_DELIVERY_ADAPTER_MODE=readonly_probe",
      });
    }
    const { id } = request.params as { id: string };
    const rule = await findCampaignRoutingRuleById(id);
    if (!rule) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    const probe = await probeGhlLocationReadonly(rule.destinationSubaccountIdGhl);
    return reply.send({
      ok: probe.ok,
      probe,
      safetyMessage: GHL_ADAPTER_SAFETY_MESSAGE,
    });
  });
}
