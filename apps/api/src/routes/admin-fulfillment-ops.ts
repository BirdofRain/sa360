import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  activateFulfillmentOpsOrder,
  buildFulfillmentOpsBootstrap,
  buildFulfillmentOpsEvidence,
  buildFulfillmentOpsSafetyPosture,
  buildLatestFulfillmentOpsEvidenceForOrder,
  buildOrderEligibilityPreview,
  createFulfillmentOpsDemoOrder,
  prepareFulfillmentOpsCandidate,
  presentFulfillmentOpsOrder,
  reserveFulfillmentOpsAllocation,
  simulateFulfillmentOpsInstruction,
} from "../services/fulfillment-ops/fulfillment-ops.service.js";
import { findLeadOrderById, listLeadOrders } from "../repositories/lead-order.repository.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const orderIdParamSchema = z.object({ orderId: z.string().trim().min(1) });
const allocationIdParamSchema = z.object({ allocationId: z.string().trim().min(1) });
const instructionIdParamSchema = z.object({ instructionId: z.string().trim().min(1) });

const demoOrderBodySchema = z.object({
  clientAccountId: z.string().trim().min(1).max(120),
  clientDisplayName: z.string().trim().max(180).optional(),
  nicheKey: z.string().trim().min(1).max(120),
  states: z.array(z.string().trim().min(1).max(8)).min(1).max(20),
  leadVolume: z.coerce.number().int().min(1).max(10_000),
  productType: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const prepareBodySchema = z.object({
  leadOrderId: z.string().trim().min(1),
  inventoryItemId: z.string().trim().min(1),
});

export const adminFulfillmentOpsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/fulfillment-ops/safety", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return reply.send({ ok: true, safety: buildFulfillmentOpsSafetyPosture() });
  });

  app.get("/fulfillment-ops/bootstrap", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = z
      .object({ orderId: z.string().trim().optional() })
      .safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }
    const data = await buildFulfillmentOpsBootstrap(query.data.orderId);
    return reply.send({ ok: true, ...data });
  });

  app.get("/fulfillment-ops/orders", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        status: z.string().trim().optional(),
        nicheKey: z.string().trim().optional(),
        clientAccountId: z.string().trim().optional(),
      })
      .safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }

    const { items, nextCursor } = await listLeadOrders({
      limit: query.data.limit ?? 50,
      status: query.data.status as never,
      nicheKey: query.data.nicheKey,
      clientAccountId: query.data.clientAccountId,
    });

    return reply.send({
      ok: true,
      items: items.map(presentFulfillmentOpsOrder),
      nextCursor,
    });
  });

  app.get("/fulfillment-ops/orders/:orderId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = orderIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const row = await findLeadOrderById(params.data.orderId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: "lead_order_not_found" });
    }
    return reply.send({ ok: true, item: presentFulfillmentOpsOrder(row) });
  });

  app.post("/fulfillment-ops/demo-orders", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = demoOrderBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_body",
        details: body.error.flatten(),
      });
    }
    try {
      const item = await createFulfillmentOpsDemoOrder(body.data);
      return reply.status(201).send({ ok: true, item });
    } catch (err) {
      return reply.status(400).send({
        ok: false,
        error: err instanceof Error ? err.message : "create_failed",
      });
    }
  });

  app.post("/fulfillment-ops/orders/:orderId/activate", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = orderIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const result = await activateFulfillmentOpsOrder(params.data.orderId);
    if (!result.ok) {
      return reply.status(409).send(result);
    }
    return reply.send(result);
  });

  app.get("/fulfillment-ops/orders/:orderId/eligibility-preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = orderIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(50).optional() })
      .safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }
    const result = await buildOrderEligibilityPreview(params.data.orderId, {
      limit: query.data.limit,
    });
    if (!result.ok) {
      return reply.status(404).send(result);
    }
    return reply.send({ ok: true, preview: result.preview });
  });

  app.post("/fulfillment-ops/prepare-candidate", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = prepareBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_body",
        details: body.error.flatten(),
      });
    }
    const result = await prepareFulfillmentOpsCandidate(body.data);
    if (!result.ok) {
      return reply.status(409).send(result);
    }
    return reply.send(result);
  });

  app.post("/fulfillment-ops/allocations/:allocationId/reserve", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = allocationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const result = await reserveFulfillmentOpsAllocation(params.data.allocationId);
    if (!result.ok) {
      return reply.status(409).send(result);
    }
    return reply.send(result);
  });

  app.post("/fulfillment-ops/instructions/:instructionId/simulate", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = instructionIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const result = await simulateFulfillmentOpsInstruction(params.data.instructionId);
    if (!result.ok) {
      return reply.status(409).send(result);
    }
    return reply.send(result);
  });

  app.get("/fulfillment-ops/allocations/:allocationId/evidence", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = allocationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const evidence = await buildFulfillmentOpsEvidence(params.data.allocationId);
    if (!evidence) {
      return reply.status(404).send({ ok: false, error: "allocation_not_found" });
    }
    return reply.send({ ok: true, evidence });
  });

  app.get("/fulfillment-ops/orders/:orderId/latest-evidence", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = orderIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const order = await findLeadOrderById(params.data.orderId);
    if (!order) {
      return reply.status(404).send({ ok: false, error: "lead_order_not_found" });
    }
    const evidence = await buildLatestFulfillmentOpsEvidenceForOrder(params.data.orderId);
    return reply.send({ ok: true, evidence });
  });
};
