import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import { getMetaWebhookConfig, type MetaWebhookConfig } from "../lib/meta-webhook.js";
import { findSourceLeadEventById } from "../repositories/source-lead-event.repository.js";
import { isSettledCaptureOnlyFacebookEvent } from "../services/source-intake/facebook-capture-provenance.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
} from "../services/source-intake/facebook-lead-normalizer.js";
import { isFacebookLeadFullyProcessed } from "../services/source-intake/facebook-lead-intake.service.js";
import {
  requeueMetaLeadgenFetch,
  type RequeueMetaLeadgenFetchResult,
} from "../services/source-intake/meta-leadgen-fetch-queue.service.js";
import {
  mergeMetaLeadgenFetchMeta,
  processMetaLeadgenFetch,
  readMetaLeadgenFetchMeta,
} from "../services/source-intake/meta-leadgen-fetch.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const processBodySchema = z.object({
  leadgenId: z.string().trim().min(1),
  sourceLeadEventId: z.string().trim().min(1),
  jobId: z.string().optional(),
  attemptNumber: z.number().int().positive().optional(),
  fixture: z.boolean().optional(),
});

const requeueParamsSchema = z.object({
  sourceEventId: z.string().trim().min(1),
});

export type AdminMetaLeadgenRoutesOptions = {
  getMetaWebhookConfigImpl?: () => MetaWebhookConfig;
  findSourceLeadEventByIdImpl?: typeof findSourceLeadEventById;
  requeueMetaLeadgenFetchImpl?: (data: {
    leadgenId: string;
    sourceLeadEventId: string;
  }) => Promise<RequeueMetaLeadgenFetchResult>;
  mergeMetaLeadgenFetchMetaImpl?: typeof mergeMetaLeadgenFetchMeta;
};

/**
 * Internal worker endpoint for meta-leadgen-fetch plus the operator requeue
 * action. Graph tokens and intake services stay in the API; the worker is a
 * thin dispatcher.
 */
export const adminMetaLeadgenRoutes: FastifyPluginAsync<AdminMetaLeadgenRoutesOptions> = async (
  app,
  opts
) => {
  const configImpl = opts.getMetaWebhookConfigImpl ?? getMetaWebhookConfig;
  const findByIdImpl = opts.findSourceLeadEventByIdImpl ?? findSourceLeadEventById;
  const requeueImpl = opts.requeueMetaLeadgenFetchImpl ?? requeueMetaLeadgenFetch;
  const mergeMetaImpl = opts.mergeMetaLeadgenFetchMetaImpl ?? mergeMetaLeadgenFetchMeta;

  app.post("/meta-leadgen/internal/process-fetch", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = processBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }

    const result = await processMetaLeadgenFetch({
      leadgenId: body.data.leadgenId,
      sourceLeadEventId: body.data.sourceLeadEventId,
      jobId: body.data.jobId,
      attemptNumber: body.data.attemptNumber,
      fixture: body.data.fixture,
    });

    if (!result.ok && result.retryable) {
      return reply.status(500).send({
        ok: false,
        retryable: true,
        error: result.error,
        graphOutcome: result.graphOutcome,
      });
    }
    if (!result.ok) {
      return reply.status(422).send({
        ok: false,
        retryable: false,
        error: result.error,
        graphOutcome: result.graphOutcome,
      });
    }
    return reply.send({ ok: true, result });
  });

  /**
   * Operator recovery for a canonical Meta row whose Graph fetch failed
   * terminally (token/permission/not_found, exhausted retries) or whose
   * enqueue failed. Removes the retained failed BullMQ job and enqueues a new
   * one. Never calls Graph inline, never touches settled capture rows, and
   * never starts routing or delivery.
   */
  app.post("/meta-leadgen/events/:sourceEventId/requeue-fetch", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = requeueParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "invalid_params" });
    }
    const config = configImpl();
    if (!config.intakeEnabled || !config.graphFetchEnabled) {
      return reply.status(409).send({
        ok: false,
        error: "flags_disabled",
        hint: "Set SA360_META_LEAD_ADS_INTAKE_ENABLED=true and SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=true before requeueing.",
      });
    }
    const event = await findByIdImpl(params.data.sourceEventId);
    if (!event) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (
      event.sourceProvider !== FACEBOOK_LEAD_PROVIDER ||
      event.sourceSystem !== FACEBOOK_LEAD_SOURCE_SYSTEM ||
      !event.sourceLeadId
    ) {
      return reply.status(409).send({ ok: false, error: "not_meta_lead_ads_event" });
    }
    if (isSettledCaptureOnlyFacebookEvent(event)) {
      return reply.status(409).send({
        ok: false,
        error: "already_settled",
        hint: "This lead is already captured. Use Facebook Intake reevaluate to change its association.",
      });
    }
    if (isFacebookLeadFullyProcessed(event, config.routingEnabled)) {
      return reply.status(409).send({ ok: false, error: "already_processed" });
    }
    const fetchMeta = readMetaLeadgenFetchMeta(event.enrichmentMetadataJson);
    if (fetchMeta?.state === "fetching") {
      return reply.status(409).send({ ok: false, error: "fetch_in_progress" });
    }

    const leadgenId = event.sourceLeadId;
    let requeued: RequeueMetaLeadgenFetchResult;
    try {
      requeued = await requeueImpl({ leadgenId, sourceLeadEventId: event.id });
    } catch (err) {
      logger.error("meta_leadgen_requeue.failed", {
        sourceLeadEventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return reply.status(503).send({ ok: false, error: "queue_unavailable" });
    }
    if (!requeued.enqueued) {
      return reply.status(409).send({
        ok: false,
        error: "job_in_progress",
        jobId: requeued.jobId,
        previousState: requeued.previousState,
      });
    }
    const nowIso = new Date().toISOString();
    await mergeMetaImpl(
      leadgenId,
      event.id,
      { state: "queued", jobId: requeued.jobId, queuedAt: nowIso, requeuedAt: nowIso },
      { errorSummary: "Requeued for Meta Graph fetch by operator." }
    ).catch((err: unknown) => {
      logger.warn("meta_leadgen_requeue.metadata_update_failed", {
        sourceLeadEventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    logger.info("meta_leadgen_requeue.enqueued", {
      sourceLeadEventId: event.id,
      leadgenId,
      jobId: requeued.jobId,
      previousState: requeued.previousState,
    });
    return reply.send({
      ok: true,
      sourceEventId: event.id,
      leadgenId,
      jobId: requeued.jobId,
      previousState: requeued.previousState,
      requeuedAt: nowIso,
    });
  });
};
