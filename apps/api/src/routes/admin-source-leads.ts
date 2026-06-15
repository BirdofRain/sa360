import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SourceLeadEventStatus } from "@prisma/client";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { getBuildVersionPayload } from "../lib/build-version.js";
import {
  findSourceLeadEventById,
  listSourceLeadEvents,
} from "../repositories/source-lead-event.repository.js";
import {
  sourceLeadApproveDeliveryBodySchema,
  sourceLeadIdParamSchema,
  sourceLeadListQuerySchema,
  sourceLeadRejectBodySchema,
  sourceImportCsvPreviewBodySchema,
} from "../schemas/source-lead.schema.js";
import {
  approveSourceLeadDelivery,
  requeueSourceLeadEvent,
  rejectSourceLeadEvent,
  type ApproveSourceLeadDeliveryResult,
} from "../services/source-intake/source-lead-delivery.service.js";
import type { SourceEnrichmentMetadata } from "../services/source-intake/source-enrichment.types.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

function presentSourceLeadListItem(row: Awaited<ReturnType<typeof findSourceLeadEventById>>) {
  if (!row) return null;
  const normalized = row.normalizedPayloadJson as {
    contact?: { first_name?: string; last_name?: string; email?: string; phone_e164?: string };
  } | null;
  const contact = normalized?.contact;
  const leadName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() || null;
  return {
    id: row.id,
    receivedAt: row.receivedAt.toISOString(),
    sourceProvider: row.sourceProvider,
    sourceSystem: row.sourceSystem,
    sourceType: row.sourceType,
    sourceRouteKey: row.sourceRouteKey,
    sourceLeadId: row.sourceLeadId,
    leadName,
    email: contact?.email ?? null,
    phone: contact?.phone_e164 ?? null,
    status: row.status,
    matched: Boolean(row.routingRuleIdResolved && row.clientAccountIdResolved),
    matchedRuleId: row.routingRuleIdResolved,
    destinationClientAccountId: row.clientAccountIdResolved,
    destinationLocationIdGhl: row.destinationLocationIdResolved,
    errorSummary: row.errorSummary,
  };
}

function presentEnrichmentPreview(
  enrichment: SourceEnrichmentMetadata | null,
  duplicateRisk: { blocksDelivery?: boolean; blocksLiveDelivery?: boolean } | null
) {
  if (!enrichment) return null;
  return {
    intakeStatus: enrichment.intakeStatus,
    enrichmentStatus: enrichment.enrichmentStatus,
    automationReadiness: enrichment.automationReadiness,
    sourceSchemaStatus: enrichment.sourceSchemaStatus,
    deliveryEligible: enrichment.deliveryEligible,
    deliveryBlockers: enrichment.deliveryBlockers,
    deliveryWarnings: enrichment.deliveryWarnings,
    mappedFieldCount: enrichment.mappedFieldCount,
    missingOptionalFields: enrichment.missingOptionalFields,
    missingAiContextFields: enrichment.missingAiContextFields,
    unmappedSourceFieldKeys: enrichment.unmappedSourceFieldKeys,
    schemaDriftWarnings: enrichment.schemaDrift?.warnings ?? [],
    duplicateBlocksDelivery: Boolean(duplicateRisk?.blocksDelivery),
    duplicateBlocksLiveDelivery: Boolean(duplicateRisk?.blocksLiveDelivery),
    coreDelivery: {
      namePresent: !enrichment.deliveryBlockers.some((b) => b.includes("Name required")),
      phonePresent: !enrichment.deliveryBlockers.some((b) => b.includes("Valid phone")),
      routeMatched: enrichment.intakeStatus === "routing_matched",
    },
    automation: {
      standardWorkflowReady: enrichment.deliveryEligible,
      voiceAiReady: enrichment.automationReadiness === "ready",
      voiceAiLimited: enrichment.automationReadiness === "limited",
    },
  };
}

function presentSourceLeadDetail(row: NonNullable<Awaited<ReturnType<typeof findSourceLeadEventById>>>) {
  const enrichment = row.enrichmentMetadataJson as SourceEnrichmentMetadata | null;
  const duplicateRisk = row.duplicateRiskJson as {
    blocksDelivery?: boolean;
    blocksLiveDelivery?: boolean;
  } | null;
  return {
    ...presentSourceLeadListItem(row),
    sourceCampaignId: row.sourceCampaignId,
    sourceCampaignName: row.sourceCampaignName,
    sourceFunnelName: row.sourceFunnelName,
    sourceLeadUid: row.sourceLeadUid,
    rawPayloadJson: row.rawPayloadJson,
    normalizedPayloadJson: row.normalizedPayloadJson,
    routingResultJson: row.routingResultJson,
    duplicateRiskJson: row.duplicateRiskJson,
    deliveryResultJson: row.deliveryResultJson,
    enrichmentMetadataJson: row.enrichmentMetadataJson,
    enrichmentPreview: presentEnrichmentPreview(enrichment, duplicateRisk),
    routingDryRunDecisionId: row.routingDryRunDecisionId,
    normalizedAt: row.normalizedAt?.toISOString() ?? null,
    routedAt: row.routedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    approvedBy: row.approvedBy,
  };
}

export type AdminSourceLeadsRoutesOptions = {
  approveSourceLeadDeliveryImpl?: typeof approveSourceLeadDelivery;
};

export async function adminSourceLeadsRoutes(
  app: FastifyInstance,
  opts: AdminSourceLeadsRoutesOptions = {}
) {
  const approveDelivery = opts.approveSourceLeadDeliveryImpl ?? approveSourceLeadDelivery;

  app.get("/source-leads", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = sourceLeadListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_query" });
    }

    const { items, nextCursor } = await listSourceLeadEvents({
      status: parsed.data.status as SourceLeadEventStatus | undefined,
      sourceProvider: parsed.data.sourceProvider,
      sourceSystem: parsed.data.sourceSystem,
      matched: parsed.data.matched,
      clientAccountIdResolved: parsed.data.clientAccountIdResolved,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    return reply.send({
      ok: true,
      items: items.map((row) => presentSourceLeadListItem(row)!),
      nextCursor,
      apiBuildVersion: getBuildVersionPayload(),
    });
  });

  app.get("/source-leads/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_id" });
    }

    const row = await findSourceLeadEventById(params.data.id);
    if (!row) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }

    return reply.send({
      ok: true,
      item: presentSourceLeadDetail(row),
      apiBuildVersion: getBuildVersionPayload(),
    });
  });

  app.post("/source-leads/:id/approve-delivery", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_id" });
    }

    const body = sourceLeadApproveDeliveryBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_payload",
        details: body.error.flatten(),
      });
    }

    try {
      const result: ApproveSourceLeadDeliveryResult = await approveDelivery({
        sourceLeadEventId: params.data.id,
        mode: body.data.mode,
        operatorConfirmationText: body.data.operatorConfirmationText,
        confirmLiveDeliveryRisk: body.data.confirmLiveDeliveryRisk,
        approvedBy: body.data.approvedBy,
      });

      const status =
        !result.ok && result.error === "confirmation_required"
          ? 400
          : !result.ok && result.error === "not_found"
            ? 404
            : result.ok
              ? 200
              : 409;

      return reply.status(status).send({
        ...result,
        apiBuildVersion: getBuildVersionPayload(),
      });
    } catch (err) {
      request.log.error({ err }, "source_lead_approve_delivery_failed");
      return reply.status(500).send({
        ok: false,
        error: "delivery_failed",
        reason: err instanceof Error ? err.message : "Unexpected error",
        sourceLeadEventId: params.data.id,
      });
    }
  });

  app.post("/source-leads/:id/reject", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_id" });
    }

    const body = sourceLeadRejectBodySchema.safeParse(request.body ?? {});
    const result = await rejectSourceLeadEvent(
      params.data.id,
      body.success ? body.data.approvedBy : undefined
    );

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 409;
      return reply.status(status).send({ ok: false, error: result.error });
    }

    return reply.send({ ok: true, apiBuildVersion: getBuildVersionPayload() });
  });

  app.post("/source-leads/:id/requeue", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const params = sourceLeadIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_id" });
    }

    const result = await requeueSourceLeadEvent(params.data.id);
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 409;
      return reply.status(status).send({ ok: false, error: result.error });
    }

    return reply.send({
      ok: true,
      status: result.status,
      apiBuildVersion: getBuildVersionPayload(),
    });
  });

  /** Future CSV import preview — scaffolding only. */
  app.post("/source-imports/csv/preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = sourceImportCsvPreviewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_payload" });
    }

    return reply.status(501).send({
      ok: false,
      error: "not_implemented",
      message: "CSV import preview is planned — see docs/demo/source-intake-import-plan.md",
      rowCount: parsed.data.rows.length,
    });
  });
}
