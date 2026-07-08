import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { findLeadAllocationBySourceLeadEventId } from "../repositories/lead-allocation.repository.js";
import { findFulfillmentOutboxByIdempotencyKey } from "../repositories/fulfillment-outbox.repository.js";
import { findLeadEligibilityAssessment } from "../repositories/lead-eligibility.repository.js";
import { presentDeliveryTargetSafe } from "../repositories/delivery-target.repository.js";
import {
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
  FULFILLMENT_SHADOW_WORK_TYPE,
  buildFulfillmentOutboxIdempotencyKey,
} from "../services/fulfillment-shadow/fulfillment-keys.js";
import {
  ensureFulfillmentOutboxForSourceLead,
  reconcileMissingFulfillmentOutbox,
} from "../services/fulfillment-shadow/shadow-processor.service.js";
import { enqueueFulfillmentShadowOutbox } from "../services/fulfillment-shadow/fulfillment-shadow-queue.service.js";
import { listLeadEligibilityByStatus } from "../repositories/lead-eligibility.repository.js";
import { listUnmatchedSourceLeads } from "../repositories/lead-allocation.repository.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const sourceLeadIdParamSchema = z.object({ sourceLeadEventId: z.string().trim().min(1) });

export const adminFulfillmentShadowRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/fulfillment-shadow/source-leads/:sourceLeadEventId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const sourceLeadEventId = params.data.sourceLeadEventId;
    const outbox = await findFulfillmentOutboxByIdempotencyKey(
      buildFulfillmentOutboxIdempotencyKey(sourceLeadEventId)
    );
    const eligibility = await findLeadEligibilityAssessment({
      sourceLeadEventId,
      policyKey: FULFILLMENT_ELIGIBILITY_POLICY_KEY,
      policyVersion: FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
    });
    const allocation = await findLeadAllocationBySourceLeadEventId(sourceLeadEventId);

    return reply.send({
      ok: true,
      sourceLeadEventId,
      outbox: outbox
        ? {
            id: outbox.id,
            status: outbox.status,
            workType: outbox.workType,
            attemptCount: outbox.attemptCount,
            availableAt: outbox.availableAt.toISOString(),
            createdAt: outbox.createdAt.toISOString(),
            completedAt: outbox.completedAt?.toISOString() ?? null,
          }
        : null,
      eligibility: eligibility
        ? {
            status: eligibility.status,
            policyKey: eligibility.policyKey,
            policyVersion: eligibility.policyVersion,
            reasonCodes: eligibility.reasonCodesJson,
            evaluatedAt: eligibility.evaluatedAt.toISOString(),
          }
        : null,
      allocation: allocation
        ? {
            id: allocation.id,
            status: allocation.status,
            leadOrderId: allocation.leadOrderId,
            clientAccountId: allocation.clientAccountId,
            candidateCount: allocation.candidateCount,
            allocationPolicyVersion: allocation.allocationPolicyVersion,
            decisionReasons: allocation.decisionReasonsJson,
            order: {
              id: allocation.leadOrder.id,
              orderNumber: allocation.leadOrder.orderNumber,
              orderKind: allocation.leadOrder.orderKind,
              fulfillmentMode: allocation.leadOrder.fulfillmentMode,
              status: allocation.leadOrder.status,
            },
            plannedDeliveryTargets: allocation.deliveryInstructions.map((instruction) => ({
              sequence: instruction.sequence,
              isRequired: instruction.isRequired,
              status: instruction.status,
              target: presentDeliveryTargetSafe(instruction.deliveryTarget),
            })),
          }
        : null,
    });
  });

  app.get("/fulfillment-shadow/review-required", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const rows = await listLeadEligibilityByStatus(["review_required"], 50);
    return reply.send({
      ok: true,
      items: rows.map((row) => ({
        sourceLeadEventId: row.sourceLeadEventId,
        sourceLeadUid: row.sourceLeadEvent.sourceLeadUid,
        status: row.status,
        reasonCodes: row.reasonCodesJson,
        evaluatedAt: row.evaluatedAt.toISOString(),
      })),
    });
  });

  app.get("/fulfillment-shadow/unmatched", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const rows = await listUnmatchedSourceLeads(50);
    return reply.send({ ok: true, items: rows });
  });

  app.post("/fulfillment-shadow/reconcile-outbox", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const result = await reconcileMissingFulfillmentOutbox({ limit: 100 });
    return reply.send({ ok: true, ...result });
  });

  app.post("/fulfillment-shadow/internal/process-outbox", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = z
      .object({ outboxId: z.string().trim().min(1), jobId: z.string().optional(), attemptNumber: z.number().optional() })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }
    const { processShadowFulfillmentOutboxItem } = await import(
      "../services/fulfillment-shadow/shadow-processor.service.js"
    );
    const result = await processShadowFulfillmentOutboxItem(body.data.outboxId);
    if (!result.ok && result.status === "retryable") {
      return reply.status(500).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, result });
  });

  app.post("/fulfillment-shadow/source-leads/:sourceLeadEventId/enqueue", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const outbox = await ensureFulfillmentOutboxForSourceLead(params.data.sourceLeadEventId);
    try {
      await enqueueFulfillmentShadowOutbox(outbox.id);
    } catch (err) {
      return reply.status(202).send({
        ok: true,
        outboxId: outbox.id,
        enqueueStatus: "pending",
        workType: FULFILLMENT_SHADOW_WORK_TYPE,
        warning: err instanceof Error ? err.message : "enqueue_failed",
      });
    }
    return reply.send({
      ok: true,
      outboxId: outbox.id,
      enqueueStatus: "enqueued",
      workType: FULFILLMENT_SHADOW_WORK_TYPE,
    });
  });
};
