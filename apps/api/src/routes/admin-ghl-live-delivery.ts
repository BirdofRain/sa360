import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  ghlLiveCanaryExecuteBodySchema,
  ghlLiveDeliveryMarkRolledBackBodySchema,
  ghlLiveDeliveryRunsListQuerySchema,
} from "../schemas/ghl-live-canary.schema.js";
import {
  executeLiveCanaryForPlan,
  getGhlLiveDeliveryRunDetail,
  getLiveCanaryPreflightForPlan,
  listGhlLiveDeliveryRunsPresented,
  markGhlLiveDeliveryRunRolledBack,
} from "../services/ghl-delivery-adapter/ghl-live-canary.service.js";
import { GHL_LIVE_CANARY_SAFETY_COPY } from "../services/ghl-delivery-adapter/ghl-live-canary.present.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminGhlLiveDeliveryRoutes(app: FastifyInstance) {
  app.get("/delivery-plans/:id/ghl-live/canary/preflight", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const result = await getLiveCanaryPreflightForPlan(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Delivery plan not found" });
    }
    return reply.send({
      ok: true,
      preflight: result.preflight,
      safetyMessage: result.safetyMessage,
      adapterMode: result.adapterMode,
    });
  });

  app.post("/delivery-plans/:id/ghl-live/canary", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = ghlLiveCanaryExecuteBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await executeLiveCanaryForPlan(id, {
      ...parsed.data,
      executedBy: "admin_api",
    });
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Delivery plan not found" });
    }
    if ("blocked" in result) {
      return reply.status(result.statusCode ?? 400).send({
        ok: false,
        error: "Live canary blocked",
        blockers: result.blockers,
        preflight: result.preflight ?? undefined,
        safetyMessage: GHL_LIVE_CANARY_SAFETY_COPY,
      });
    }
    if ("skippedDuplicate" in result) {
      return reply.status(409).send({
        ok: false,
        skippedDuplicate: true,
        liveRun: result.liveRun,
        preflight: result.preflight,
        safetyMessage: result.safetyMessage,
      });
    }
    const statusCode = result.ok ? 200 : 502;
    return reply.status(statusCode).send({
      ok: result.ok,
      liveRun: result.liveRun,
      contactIdGhl: result.contactIdGhl,
      opportunityIdGhl: result.opportunityIdGhl,
      workflowStarted: result.workflowStarted,
      externalCallExecuted: result.externalCallExecuted,
      preflight: result.preflight,
      safetyMessage: result.safetyMessage,
    });
  });

  app.get("/ghl-live-delivery/runs", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = ghlLiveDeliveryRunsListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const items = await listGhlLiveDeliveryRunsPresented(parsed.data);
    return reply.send({ ok: true, count: items.length, items, safetyMessage: GHL_LIVE_CANARY_SAFETY_COPY });
  });

  app.get("/ghl-live-delivery/runs/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const result = await getGhlLiveDeliveryRunDetail(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Live delivery run not found" });
    }
    return reply.send({
      ok: true,
      liveRun: result.liveRun,
      safetyMessage: result.safetyMessage,
    });
  });

  app.post("/ghl-live-delivery/runs/:id/mark-rolled-back", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = ghlLiveDeliveryMarkRolledBackBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await markGhlLiveDeliveryRunRolledBack(id, parsed.data.notes);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Live delivery run not found" });
    }
    return reply.send({ ok: true, liveRun: result.liveRun });
  });
}
