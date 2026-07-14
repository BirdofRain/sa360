import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  attachLeadCaptureTrustPilotRecord,
  type LeadCaptureTrustAttachResult,
} from "../services/leadcapture-trust/leadcapture-trust-attach.service.js";
import {
  buildLeadCaptureTrustPilotPreview,
  type LeadCaptureTrustPreviewResult,
} from "../services/leadcapture-trust/leadcapture-trust-preview.service.js";
import {
  buildLeadCaptureTrustReconcilePreview,
  type LeadCaptureTrustReconcilePreviewResult,
} from "../services/leadcapture-trust/leadcapture-trust-reconcile-preview.service.js";

export type AdminLeadCaptureTrustRoutesOptions = {
  buildPreviewImpl?: typeof buildLeadCaptureTrustPilotPreview;
  attachImpl?: typeof attachLeadCaptureTrustPilotRecord;
  reconcilePreviewImpl?: typeof buildLeadCaptureTrustReconcilePreview;
};

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const pilotBodyBaseSchema = z
  .object({
    providerLeadId: z.string().trim().min(1),
    campaignId: z.string().trim().min(1),
  })
  .strict();

const previewBodySchema = pilotBodyBaseSchema.extend({
  sourceLeadEventId: z.string().trim().min(1).optional(),
});

const attachBodySchema = pilotBodyBaseSchema.extend({
  sourceLeadEventId: z.string().trim().min(1),
  requestId: z.string().trim().min(1).max(128),
  operatorNote: z.string().trim().min(1).max(2000),
  operatorConfirmationText: z.string().trim().min(1).max(128),
  expectedContentHash: z.string().trim().min(1).max(128).optional(),
});

const reconcileBodySchema = z
  .object({
    campaignId: z.string().trim().min(1),
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

function previewErrorStatus(error: string): number {
  if (error === "provider_lead_not_found") return 404;
  if (error === "trust_sync_disabled" || error === "invalid_campaign" || error === "malformed_provider_record") {
    return 400;
  }
  return 502;
}

function attachErrorStatus(error: string): number {
  if (error === "source_lead_not_found") return 404;
  if (
    error === "missing_request_id" ||
    error === "missing_operator_note" ||
    error === "invalid_confirmation_text"
  ) {
    return 400;
  }
  return 409;
}

export const adminLeadCaptureTrustRoutes: FastifyPluginAsync<AdminLeadCaptureTrustRoutesOptions> = async (
  app,
  opts = {}
) => {
  const buildPreviewImpl = opts.buildPreviewImpl ?? buildLeadCaptureTrustPilotPreview;
  const attachImpl = opts.attachImpl ?? attachLeadCaptureTrustPilotRecord;
  const reconcilePreviewImpl = opts.reconcilePreviewImpl ?? buildLeadCaptureTrustReconcilePreview;

  app.post("/leadcapture/trust/pilot/preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = previewBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const result: LeadCaptureTrustPreviewResult = await buildPreviewImpl({
      providerLeadId: body.data.providerLeadId,
      campaignId: body.data.campaignId,
      sourceLeadEventId: body.data.sourceLeadEventId,
    });
    if (!result.ok) {
      return reply.status(previewErrorStatus(result.error)).send({
        ok: false,
        error: result.error,
        blockers: result.blockers,
      });
    }

    return reply.send({ ok: true, preview: result.preview, contentHash: result.contentHash });
  });

  app.post("/leadcapture/trust/pilot/attach", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = attachBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const requestedBy = typeof request.headers["x-sa360-operator"] === "string"
      ? request.headers["x-sa360-operator"]
      : null;

    const result: LeadCaptureTrustAttachResult = await attachImpl({
      providerLeadId: body.data.providerLeadId,
      sourceLeadEventId: body.data.sourceLeadEventId,
      campaignId: body.data.campaignId,
      requestId: body.data.requestId,
      operatorNote: body.data.operatorNote,
      operatorConfirmationText: body.data.operatorConfirmationText,
      expectedContentHash: body.data.expectedContentHash,
      requestedBy,
    });
    if (!result.ok) {
      return reply.status(attachErrorStatus(result.error)).send({
        ok: false,
        error: result.error,
        blockers: result.blockers,
        auditEventId: result.auditEventId,
      });
    }

    return reply.send({
      ok: true,
      reviewStatus: result.reviewStatus,
      sourceLeadEventId: result.sourceLeadEventId,
      leadProofId: result.leadProofId,
      previousProofStatus: result.previousProofStatus,
      newProofStatus: result.newProofStatus,
      auditEventId: result.auditEventId,
      contentHash: result.contentHash,
    });
  });

  app.post("/leadcapture/trust/pilot/reconcile-preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = reconcileBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const result: LeadCaptureTrustReconcilePreviewResult = await reconcilePreviewImpl({
      campaignId: body.data.campaignId,
      cursor: body.data.cursor,
      limit: body.data.limit,
    });
    if (!result.ok) {
      return reply.status(result.error === "provider_error" ? 502 : 400).send({
        ok: false,
        error: result.error,
        blockers: result.blockers,
      });
    }

    return reply.send({
      ok: true,
      campaignId: result.campaignId,
      counts: result.counts,
      rows: result.rows,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  });
};
