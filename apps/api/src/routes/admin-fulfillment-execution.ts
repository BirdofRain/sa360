import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { listDeliveryAttemptsForInstruction } from "../repositories/delivery-attempt.repository.js";
import { loadAllocationForReservation } from "../services/fulfillment-execution/reservation-eligibility.service.js";
import { reserveLeadAllocation } from "../services/fulfillment-execution/reservation.service.js";
import {
  claimDeliveryAttempt,
  simulateDeliveryInstruction,
} from "../services/fulfillment-execution/delivery-attempt.service.js";
import { reconcileLeadOrderCounters } from "../services/fulfillment-execution/counter-reconciliation.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const allocationIdParamSchema = z.object({ allocationId: z.string().trim().min(1) });
const instructionIdParamSchema = z.object({ instructionId: z.string().trim().min(1) });
const orderIdParamSchema = z.object({ orderId: z.string().trim().min(1) });

export const adminFulfillmentExecutionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/fulfillment-execution/allocations/:allocationId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = allocationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const allocation = await loadAllocationForReservation(params.data.allocationId);
    if (!allocation) {
      return reply.status(404).send({ ok: false, error: "allocation_not_found" });
    }

    return reply.send({
      ok: true,
      allocation: {
        id: allocation.id,
        status: allocation.status,
        clientAccountId: allocation.clientAccountId,
        sourceLeadEventId: allocation.sourceLeadEventId,
        leadOrderId: allocation.leadOrderId,
        reservationPolicyVersion: allocation.reservationPolicyVersion,
        reservationIdempotencyKey: allocation.reservationIdempotencyKey,
        reservedAt: allocation.reservedAt?.toISOString() ?? null,
        committedAt: allocation.committedAt?.toISOString() ?? null,
        releasedAt: allocation.releasedAt?.toISOString() ?? null,
        order: {
          id: allocation.leadOrder.id,
          orderNumber: allocation.leadOrder.orderNumber,
          status: allocation.leadOrder.status,
          requestedQuantity: allocation.leadOrder.requestedQuantity,
          reservedQuantity: allocation.leadOrder.reservedQuantity,
          fulfilledQuantity: allocation.leadOrder.fulfilledQuantity,
          proposedQuantity: allocation.leadOrder.proposedQuantity,
        },
        deliveryInstructions: allocation.deliveryInstructions.map((instruction) => ({
          id: instruction.id,
          isRequired: instruction.isRequired,
          status: instruction.status,
        })),
      },
    });
  });

  app.post("/fulfillment-execution/allocations/:allocationId/reserve", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = allocationIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const bodySchema = z
      .object({
        clientAccountId: z.string().optional(),
        leadOrderId: z.string().optional(),
      })
      .optional();
    const body = bodySchema.safeParse(request.body ?? {});
    if (body.success && (body.data?.clientAccountId || body.data?.leadOrderId)) {
      return reply.status(400).send({
        ok: false,
        error: "tenant_override_not_allowed",
        hint: "Reservation uses server-side allocation relationships only.",
      });
    }

    const result = await reserveLeadAllocation(params.data.allocationId);
    if (!result.ok) {
      return reply.status(409).send(result);
    }
    return reply.send(result);
  });

  app.post(
    "/fulfillment-execution/instructions/:instructionId/simulate",
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const params = instructionIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ ok: false, error: "invalid_params" });
      }

      const result = await simulateDeliveryInstruction(params.data.instructionId);
      if (!result.ok) {
        return reply.status(409).send(result);
      }
      return reply.send(result);
    }
  );

  app.post(
    "/fulfillment-execution/instructions/:instructionId/claim",
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const params = instructionIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ ok: false, error: "invalid_params" });
      }

      const result = await claimDeliveryAttempt(params.data.instructionId);
      if (!result.ok) {
        return reply.status(409).send(result);
      }
      return reply.send(result);
    }
  );

  app.get("/fulfillment-execution/instructions/:instructionId/attempts", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = instructionIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const attempts = await listDeliveryAttemptsForInstruction(params.data.instructionId);
    return reply.send({
      ok: true,
      attempts: attempts.map((row) => ({
        id: row.id,
        attemptNumber: row.attemptNumber,
        adapterKey: row.adapterKey,
        status: row.status,
        idempotencyKey: row.idempotencyKey,
        retryable: row.retryable,
        externalReference: row.externalReference,
        errorCode: row.errorCode,
        errorSummary: row.errorSummary,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        sanitizedRequestJson: row.sanitizedRequestJson,
        sanitizedResponseJson: row.sanitizedResponseJson,
      })),
    });
  });

  app.get(
    "/fulfillment-execution/orders/:orderId/counter-reconciliation",
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const params = orderIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ ok: false, error: "invalid_params" });
      }

      const report = await reconcileLeadOrderCounters(params.data.orderId);
      if (!report) {
        return reply.status(404).send({ ok: false, error: "order_not_found" });
      }
      return reply.send({ ok: true, report });
    }
  );
};
