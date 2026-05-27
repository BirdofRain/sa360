import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  deliveryPlanListQuerySchema,
  deliveryPlanStatusPatchSchema,
} from "../schemas/delivery-plan.schema.js";
import {
  findDeliveryPlanById,
  listDeliveryPlans,
  updateDeliveryPlanStatus,
} from "../repositories/lead-delivery-plan.repository.js";
import {
  generateLeadDeliveryPlanForDecision,
  getExistingDeliveryPlanForDecision,
} from "../services/lead-delivery-plan.service.js";
import { presentLeadDeliveryPlan } from "../services/lead-delivery-plan-admin.present.js";
import { presentRoutingDryRunDecision } from "../services/routing-dry-run-admin.present.js";
import { findRoutingDryRunDecisionById } from "../repositories/routing-dry-run-decision.repository.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminDeliveryPlanRoutes(app: FastifyInstance) {
  app.post("/routing/dry-run-decisions/:id/delivery-plan", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const decision = await findRoutingDryRunDecisionById(id);
    if (!decision) {
      return reply.status(404).send({ ok: false, error: "Routing decision not found" });
    }
    const presented = await presentRoutingDryRunDecision(decision);
    const result = await generateLeadDeliveryPlanForDecision(id, {
      leadIdentity: presented.leadIdentity,
      attribution: presented.attributionSnapshot as never,
    });
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Routing decision not found" });
    }
    return reply.send({
      ok: true,
      plan: presentLeadDeliveryPlan(result.plan),
    });
  });

  app.get("/delivery-plans", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = deliveryPlanListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const rows = await listDeliveryPlans(parsed.data);
    return reply.send({
      ok: true,
      masterClientAccountId: parsed.data.masterClientAccountId,
      count: rows.length,
      items: rows.map(presentLeadDeliveryPlan),
    });
  });

  app.get("/delivery-plans/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const plan = await findDeliveryPlanById(id);
    if (!plan) {
      return reply.status(404).send({ ok: false, error: "Delivery plan not found" });
    }
    return reply.send({ ok: true, plan: presentLeadDeliveryPlan(plan) });
  });

  app.get("/routing/dry-run-decisions/:id/delivery-plan", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const plan = await getExistingDeliveryPlanForDecision(id);
    if (!plan) {
      return reply.status(404).send({ ok: false, error: "Delivery plan not found" });
    }
    return reply.send({ ok: true, plan: presentLeadDeliveryPlan(plan) });
  });

  app.patch("/delivery-plans/:id/status", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = deliveryPlanStatusPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    try {
      const plan = await updateDeliveryPlanStatus(id, parsed.data.status);
      return reply.send({ ok: true, plan: presentLeadDeliveryPlan(plan) });
    } catch {
      return reply.status(404).send({ ok: false, error: "Delivery plan not found" });
    }
  });
}
