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
import {
  buildEligibilityPreviewForSourceLead,
  type EligibilityPreviewResult,
} from "../services/fulfillment-shadow/eligibility-preview.service.js";
import {
  runLf2GhlDuplicateSearchForSourceLead,
  type Lf2GhlDuplicateSearchResult,
} from "../services/fulfillment-shadow/lf2-ghl-duplicate-search.service.js";
import {
  approveLf2DuplicateVerificationForSourceLead,
  revokeLf2DuplicateVerificationForSourceLead,
  type Lf2VerificationApprovalResult,
  type Lf2VerificationRevokeResult,
} from "../services/fulfillment-shadow/lf2-verification-approval.service.js";
import {
  buildLf2CheckpointAConfigPreviewForSourceLead,
  createLf2CheckpointAConfigForSourceLead,
  revokeLf2CheckpointAConfigForSourceLead,
  type Lf2CheckpointAConfigPreviewResult,
  type Lf2CheckpointACreateResult,
  type Lf2CheckpointARevokeResult,
} from "../services/fulfillment-shadow/lf2-checkpoint-a-config.service.js";

export type AdminFulfillmentShadowRoutesOptions = {
  buildEligibilityPreviewImpl?: typeof buildEligibilityPreviewForSourceLead;
  runGhlDuplicateSearchImpl?: typeof runLf2GhlDuplicateSearchForSourceLead;
  approveVerificationImpl?: typeof approveLf2DuplicateVerificationForSourceLead;
  revokeVerificationImpl?: typeof revokeLf2DuplicateVerificationForSourceLead;
  buildCheckpointAPreviewImpl?: typeof buildLf2CheckpointAConfigPreviewForSourceLead;
  createCheckpointAImpl?: typeof createLf2CheckpointAConfigForSourceLead;
  revokeCheckpointAImpl?: typeof revokeLf2CheckpointAConfigForSourceLead;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const sourceLeadIdParamSchema = z.object({ sourceLeadEventId: z.string().trim().min(1) });

export const adminFulfillmentShadowRoutes: FastifyPluginAsync<AdminFulfillmentShadowRoutesOptions> = async (
  app,
  opts = {}
) => {
  const buildEligibilityPreviewImpl = opts.buildEligibilityPreviewImpl ?? buildEligibilityPreviewForSourceLead;
  const runGhlDuplicateSearchImpl = opts.runGhlDuplicateSearchImpl ?? runLf2GhlDuplicateSearchForSourceLead;
  const approveVerificationImpl = opts.approveVerificationImpl ?? approveLf2DuplicateVerificationForSourceLead;
  const revokeVerificationImpl = opts.revokeVerificationImpl ?? revokeLf2DuplicateVerificationForSourceLead;
  const buildCheckpointAPreviewImpl =
    opts.buildCheckpointAPreviewImpl ?? buildLf2CheckpointAConfigPreviewForSourceLead;
  const createCheckpointAImpl = opts.createCheckpointAImpl ?? createLf2CheckpointAConfigForSourceLead;
  const revokeCheckpointAImpl = opts.revokeCheckpointAImpl ?? revokeLf2CheckpointAConfigForSourceLead;

  const verificationWorkflowBodySchema = z
    .object({
      operatorNote: z.string().trim().max(2000).optional(),
      requestId: z.string().trim().min(1).max(128).optional(),
    })
    .strict();

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

  app.get("/fulfillment-shadow/source-leads/:sourceLeadEventId/eligibility-preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const result: EligibilityPreviewResult = await buildEligibilityPreviewImpl(params.data.sourceLeadEventId);
    if (!result.ok) {
      if (result.error === "source_lead_not_found") {
        return reply.status(404).send({ ok: false, error: result.error });
      }
      return reply.status(400).send({ ok: false, error: result.error });
    }

    return reply.send({ ok: true, preview: result.preview });
  });

  app.post("/fulfillment-shadow/source-leads/:sourceLeadEventId/ghl-duplicate-search", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const result: Lf2GhlDuplicateSearchResult = await runGhlDuplicateSearchImpl(params.data.sourceLeadEventId);
    if (!result.ok) {
      return reply.status(404).send({ ok: false, error: result.error });
    }

    return reply.send({ ok: true, summary: result.summary });
  });

  app.post("/fulfillment-shadow/source-leads/:sourceLeadEventId/verification-approve", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const body = verificationWorkflowBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const requestedBy =
      typeof request.headers["x-sa360-operator"] === "string"
        ? request.headers["x-sa360-operator"].trim()
        : "admin_api";

    const result: Lf2VerificationApprovalResult = await approveVerificationImpl({
      sourceLeadEventId: params.data.sourceLeadEventId,
      requestedBy,
      requestId: body.data.requestId,
      operatorNote: body.data.operatorNote,
    });

    if (!result.ok) {
      const status =
        result.error === "source_lead_not_found"
          ? 404
          : result.error === "malformed_normalized_payload" ||
              result.error === "source_lead_uid_missing" ||
              result.error === "identity_missing" ||
              result.error === "identity_incomplete"
            ? 400
            : 409;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        auditEventId: result.auditEventId ?? null,
        duplicateSearchClassification: result.duplicateSearchClassification ?? null,
        duplicateSearchReasonCode: result.duplicateSearchReasonCode ?? null,
      });
    }

    return reply.send({
      ok: true,
      approvalStatus: result.approvalStatus,
      sourceLeadEventId: result.sourceLeadEventId,
      maskedSourceLeadUid: result.maskedSourceLeadUid,
      clientAccountId: result.clientAccountId,
      destinationSubaccountIdGhl: result.destinationSubaccountIdGhl,
      action: result.action,
      duplicateSearchClassification: result.duplicateSearchClassification,
      duplicateSearchReasonCode: result.duplicateSearchReasonCode,
      previousVerificationStatus: result.previousVerificationStatus,
      previousDuplicateStatus: result.previousDuplicateStatus,
      newVerificationStatus: result.newVerificationStatus,
      newDuplicateStatus: result.newDuplicateStatus,
      auditEventId: result.auditEventId,
      postApprovalEligibilityPreview: result.postApprovalEligibilityPreview,
    });
  });

  app.post("/fulfillment-shadow/source-leads/:sourceLeadEventId/verification-revoke", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const body = verificationWorkflowBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const requestedBy =
      typeof request.headers["x-sa360-operator"] === "string"
        ? request.headers["x-sa360-operator"].trim()
        : "admin_api";

    const result: Lf2VerificationRevokeResult = await revokeVerificationImpl({
      sourceLeadEventId: params.data.sourceLeadEventId,
      requestedBy,
      requestId: body.data.requestId,
      operatorNote: body.data.operatorNote,
    });

    if (!result.ok) {
      const status =
        result.error === "source_lead_not_found" || result.error === "verification_not_found"
          ? 404
          : result.error === "source_lead_uid_missing"
            ? 400
            : 409;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        auditEventId: result.auditEventId ?? null,
      });
    }

    return reply.send({
      ok: true,
      revocationStatus: result.revocationStatus,
      sourceLeadEventId: result.sourceLeadEventId,
      maskedSourceLeadUid: result.maskedSourceLeadUid,
      clientAccountId: result.clientAccountId,
      destinationSubaccountIdGhl: result.destinationSubaccountIdGhl,
      action: result.action,
      previousVerificationStatus: result.previousVerificationStatus,
      previousDuplicateStatus: result.previousDuplicateStatus,
      newVerificationStatus: result.newVerificationStatus,
      newDuplicateStatus: result.newDuplicateStatus,
      auditEventId: result.auditEventId,
      postRevocationEligibilityPreview: result.postRevocationEligibilityPreview,
    });
  });

  app.get("/fulfillment-shadow/source-leads/:sourceLeadEventId/checkpoint-a/preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const result: Lf2CheckpointAConfigPreviewResult = await buildCheckpointAPreviewImpl(
      params.data.sourceLeadEventId
    );
    if (!result.ok) {
      if (result.error === "source_lead_not_found") {
        return reply.status(404).send({ ok: false, error: result.error, structuralBlockers: result.structuralBlockers });
      }
      return reply.status(400).send({
        ok: false,
        error: result.error,
        structuralBlockers: result.structuralBlockers,
      });
    }

    return reply.send({ ok: true, preview: result.preview });
  });

  app.post("/fulfillment-shadow/source-leads/:sourceLeadEventId/checkpoint-a/create", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const body = verificationWorkflowBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const requestedBy =
      typeof request.headers["x-sa360-operator"] === "string"
        ? request.headers["x-sa360-operator"].trim()
        : "admin_api";

    const result: Lf2CheckpointACreateResult = await createCheckpointAImpl({
      sourceLeadEventId: params.data.sourceLeadEventId,
      requestedBy,
      requestId: body.data.requestId,
      operatorNote: body.data.operatorNote,
    });

    if (!result.ok) {
      const status =
        result.error === "source_lead_not_found"
          ? 404
          : result.error === "preview_not_safe" || result.error === "conflicting_checkpoint_config"
            ? 409
            : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        auditEventId: result.auditEventId,
        structuralBlockers: result.structuralBlockers,
      });
    }

    return reply.send({
      ok: true,
      checkpointAStatus: result.checkpointAStatus,
      sourceLeadEventId: result.sourceLeadEventId,
      maskedSourceLeadUid: result.maskedSourceLeadUid,
      clientAccountId: result.clientAccountId,
      authoritativeLocationId: result.authoritativeLocationId,
      leadOrderId: result.leadOrderId,
      leadOrderNumber: result.leadOrderNumber,
      deliveryTargetId: result.deliveryTargetId,
      previousLeadOrderStatus: result.previousLeadOrderStatus,
      previousDeliveryTargetEnabled: result.previousDeliveryTargetEnabled,
      auditEventId: result.auditEventId,
      postCreatePreview: result.postCreatePreview,
      shadowEnqueueOccurred: result.shadowEnqueueOccurred,
      lf2ExecutionRowsCreated: result.lf2ExecutionRowsCreated,
    });
  });

  app.post("/fulfillment-shadow/source-leads/:sourceLeadEventId/checkpoint-a/revoke", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }

    const body = verificationWorkflowBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const requestedBy =
      typeof request.headers["x-sa360-operator"] === "string"
        ? request.headers["x-sa360-operator"].trim()
        : "admin_api";

    const result: Lf2CheckpointARevokeResult = await revokeCheckpointAImpl({
      sourceLeadEventId: params.data.sourceLeadEventId,
      requestedBy,
      requestId: body.data.requestId,
      operatorNote: body.data.operatorNote,
    });

    if (!result.ok) {
      const status =
        result.error === "source_lead_not_found" || result.error === "checkpoint_config_not_found"
          ? 404
          : result.error === "shadow_processing_started"
            ? 409
            : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        auditEventId: result.auditEventId,
      });
    }

    return reply.send({
      ok: true,
      revocationStatus: result.revocationStatus,
      sourceLeadEventId: result.sourceLeadEventId,
      maskedSourceLeadUid: result.maskedSourceLeadUid,
      clientAccountId: result.clientAccountId,
      authoritativeLocationId: result.authoritativeLocationId,
      leadOrderId: result.leadOrderId,
      leadOrderNumber: result.leadOrderNumber,
      deliveryTargetId: result.deliveryTargetId,
      auditEventId: result.auditEventId,
      postRevocationPreview: result.postRevocationPreview,
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
