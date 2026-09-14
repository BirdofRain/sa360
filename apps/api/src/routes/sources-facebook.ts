import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import {
  completeLog,
  startLog,
  type CompleteLogInput,
  type StartLogInput,
  type WebhookRequestLogHandle,
} from "../services/webhook-request-log.service.js";
import {
  getMetaWebhookConfig,
  metaHandshakeLogBody,
  validateMetaSignature,
  verifyMetaWebhookChallenge,
  type MetaWebhookConfig,
} from "../lib/meta-webhook.js";
import {
  claimSourceLeadEventByCanonicalIdentity,
  updateSourceLeadEvent,
} from "../repositories/source-lead-event.repository.js";
import {
  extractLeadgenEnvelopes,
  fetchMetaLeadDetails,
  mapMetaLeadToFacebookFields,
  type MetaLeadFetcher,
} from "../services/source-intake/meta-lead-graph.service.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
  buildFacebookLeadUid,
  coerceFacebookLeadFields,
} from "../services/source-intake/facebook-lead-normalizer.js";
import {
  findFacebookLeadReplayEvent,
  isFacebookLeadCanonicalProcessed,
  processFacebookSourceLead,
  type FacebookLeadIntakeResult,
  type FacebookLeadReplayRow,
} from "../services/source-intake/facebook-lead-intake.service.js";

export const FACEBOOK_LEAD_CREATED_ROUTE = "/sources/facebook/lead-created";
export const META_LEADGEN_ROUTE = "/webhooks/meta/leadgen";
export const FACEBOOK_TEST_LEAD_ROUTE = "/sources/facebook/test-lead";

const PARSE_ERROR_MARKER = "__sa360_facebook_parse_error";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export type FacebookLeadReplayLookup = (
  leadgenId: string
) => Promise<FacebookLeadReplayRow | null>;

export type SourcesFacebookRoutesOptions = {
  processFacebookSourceLeadImpl?: typeof processFacebookSourceLead;
  fetchMetaLeadDetailsImpl?: MetaLeadFetcher;
  getMetaWebhookConfigImpl?: () => MetaWebhookConfig;
  startLogImpl?: (input: StartLogInput) => Promise<WebhookRequestLogHandle | null>;
  completeLogImpl?: (
    handle: WebhookRequestLogHandle | null,
    input: CompleteLogInput
  ) => Promise<void>;
  findFacebookLeadReplayImpl?: FacebookLeadReplayLookup;
  claimFacebookLeadgenImpl?: typeof claimSourceLeadEventByCanonicalIdentity;
};

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const v = request.headers[name];
  return typeof v === "string" ? v : undefined;
}

function webhookProcessingStatusFromIntake(
  status: FacebookLeadIntakeResult["status"]
): string {
  if (status === "needs_review" || status === "routing_unmatched") {
    return "routing_review_required";
  }
  if (status === "normalized" || status === "routing_matched" || status === "duplicate_blocked") {
    return "normalized";
  }
  if (status === "received") return "captured";
  return "failed";
}

async function handleVerification(
  request: FastifyRequest,
  reply: FastifyReply,
  config: MetaWebhookConfig,
  route: string,
  startLogImpl: SourcesFacebookRoutesOptions["startLogImpl"],
  completeLogImpl: SourcesFacebookRoutesOptions["completeLogImpl"]
) {
  const requestId = readRequestId(request);
  const query = (request.query ?? {}) as Record<string, string | undefined>;
  const start = startLogImpl ?? startLog;
  const complete = completeLogImpl ?? completeLog;
  const logHandle = await start({
    requestId,
    rawBody: metaHandshakeLogBody(query),
    source: "facebook_lead_ads",
    route,
  });

  const result = verifyMetaWebhookChallenge(
    {
      "hub.mode": query["hub.mode"],
      "hub.verify_token": query["hub.verify_token"],
      "hub.challenge": query["hub.challenge"],
    },
    config.verifyToken
  );
  if (result.ok) {
    await complete(logHandle, {
      httpStatus: 200,
      processingStatus: "handshake_ok",
      eventNameInternal: "meta_leadgen_handshake",
      responseBodyRedacted: { ok: true, handshake: "ok" },
    });
    return reply.status(200).type("text/plain").send(result.challenge);
  }
  logger.warn("facebook_intake.verify.failed", { reason: result.reason, route });
  await complete(logHandle, {
    httpStatus: 403,
    processingStatus: "handshake_denied",
    errorCode: result.reason,
    errorSummary: "Meta webhook verification failed.",
    responseBodyRedacted: { ok: false, error: "verification_failed" },
  });
  return reply.status(403).send({ ok: false, error: "verification_failed" });
}

async function persistRawFacebookEvent(input: {
  leadgenId: string;
  rawPayloadJson: Record<string, unknown>;
  webhookRequestLogId?: string;
  sourceRouteKey: string;
  errorSummary?: string;
  existingEventId?: string;
  claimImpl: typeof claimSourceLeadEventByCanonicalIdentity;
}): Promise<{ eventId: string | null; created: boolean; replayed: boolean }> {
  if (input.existingEventId) {
    try {
      await updateSourceLeadEvent(input.existingEventId, {
        errorSummary: input.errorSummary ?? null,
        rawPayloadJson: input.rawPayloadJson as object,
      });
      return { eventId: input.existingEventId, created: false, replayed: true };
    } catch (err) {
      logger.error("facebook_intake.persist_raw_update_failed", {
        leadgenId: input.leadgenId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  try {
    const claimed = await input.claimImpl({
      sourceProvider: FACEBOOK_LEAD_PROVIDER,
      sourceSystem: FACEBOOK_LEAD_SOURCE_SYSTEM,
      sourceType: "lead_form",
      sourceRouteKey: input.sourceRouteKey,
      sourceLeadId: input.leadgenId,
      sourceLeadUid: buildFacebookLeadUid(input.leadgenId),
      webhookRequestLogId: input.webhookRequestLogId ?? null,
      status: "received",
      rawPayloadJson: input.rawPayloadJson as object,
      errorSummary: input.errorSummary ?? null,
      receivedAt: new Date(),
    });
    return { eventId: claimed.event.id, created: claimed.created, replayed: !claimed.created };
  } catch (err) {
    logger.error("facebook_intake.persist_raw_failed", {
      leadgenId: input.leadgenId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { eventId: null, created: false, replayed: false };
  }
}

async function handleLeadCreated(
  request: RawBodyRequest,
  reply: FastifyReply,
  opts: Required<
    Pick<
      SourcesFacebookRoutesOptions,
      | "processFacebookSourceLeadImpl"
      | "fetchMetaLeadDetailsImpl"
      | "getMetaWebhookConfigImpl"
    >
  > &
    Pick<
      SourcesFacebookRoutesOptions,
      "startLogImpl" | "completeLogImpl" | "findFacebookLeadReplayImpl" | "claimFacebookLeadgenImpl"
    >,
  route: string
) {
  const requestId = readRequestId(request);
  const config = opts.getMetaWebhookConfigImpl();
  const start = opts.startLogImpl ?? startLog;
  const complete = opts.completeLogImpl ?? completeLog;
  const findReplay = opts.findFacebookLeadReplayImpl ?? findFacebookLeadReplayEvent;
  const claimImpl = opts.claimFacebookLeadgenImpl ?? claimSourceLeadEventByCanonicalIdentity;
  const logHandle = await start({
    requestId,
    rawBody: request.body,
    source: "facebook_lead_ads",
    route,
  });

  const signature = validateMetaSignature(
    request.rawBody ?? "",
    getHeader(request, "x-hub-signature-256"),
    config.appSecret
  );
  if (!signature.ok) {
    if (signature.reason === "missing_secret") {
      logger.error("facebook_intake.integration_not_configured", {
        requestId,
        integration: "facebook_lead_ads",
      });
      await complete(logHandle, {
        httpStatus: 503,
        processingStatus: "integration_not_configured",
        errorCode: "INTEGRATION_NOT_CONFIGURED",
        errorSummary: "META_APP_SECRET is required in production.",
        responseBodyRedacted: {
          ok: false,
          error: "integration_not_configured",
          integration: "facebook_lead_ads",
          hint: "Set META_APP_SECRET in the API environment.",
        },
      });
      return reply.status(503).send({
        ok: false,
        error: "integration_not_configured",
        integration: "facebook_lead_ads",
        hint: "Set META_APP_SECRET in the API environment.",
      });
    }

    logger.warn("facebook_intake.signature.invalid", { requestId, reason: signature.reason });
    await complete(logHandle, {
      httpStatus: 401,
      processingStatus: "signature_invalid",
      errorCode: signature.reason,
      errorSummary: "Invalid X-Hub-Signature-256",
      responseBodyRedacted: { ok: false, error: "invalid_signature" },
    });
    return reply.status(401).send({ ok: false, error: "invalid_signature" });
  }

  const body = request.body;
  const badBody =
    !body ||
    typeof body !== "object" ||
    (body as Record<string, unknown>)[PARSE_ERROR_MARKER] === true;
  if (badBody) {
    await complete(logHandle, {
      httpStatus: 200,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "Meta webhook body was not valid JSON.",
      responseBodyRedacted: { ok: false, error: "invalid_payload" },
    });
    return reply.status(200).send({ ok: false, error: "invalid_payload", processed: 0 });
  }

  const envelopes = extractLeadgenEnvelopes(body);
  if (envelopes.length === 0) {
    await complete(logHandle, {
      httpStatus: 200,
      processingStatus: "captured",
      responseBodyRedacted: { ok: true, processed: 0 },
    });
    return reply.status(200).send({ ok: true, processed: 0, note: "no leadgen changes" });
  }

  const masterClientAccountId = config.masterClientAccountId ?? "";
  const results: Array<Record<string, unknown>> = [];
  let firstDecisionId: string | undefined;
  let firstDestination: string | undefined;
  let firstEventId: string | undefined;
  let firstLeadUid: string | undefined;
  let replayCount = 0;
  let processedCount = 0;
  let failedCount = 0;

  const canFetchGraph = config.intakeEnabled && config.graphFetchEnabled;

  for (const envelope of envelopes) {
    const sourceRouteKey = envelope.formId ?? envelope.adId ?? `leadgen_${envelope.leadgenId}`;
    const existing = await findReplay(envelope.leadgenId);

    if (existing && isFacebookLeadCanonicalProcessed(existing)) {
      replayCount += 1;
      firstEventId = firstEventId ?? existing.id;
      firstLeadUid = firstLeadUid ?? existing.sourceLeadUid ?? undefined;
      firstDecisionId = firstDecisionId ?? existing.routingDryRunDecisionId ?? undefined;
      firstDestination = firstDestination ?? existing.clientAccountIdResolved ?? undefined;
      results.push({
        leadgenId: envelope.leadgenId,
        sourceEventId: existing.id,
        status: existing.status,
        replayed: true,
      });
      continue;
    }

    if (!canFetchGraph) {
      const persisted = await persistRawFacebookEvent({
        leadgenId: envelope.leadgenId,
        rawPayloadJson: { envelope },
        webhookRequestLogId: logHandle?.id,
        sourceRouteKey,
        errorSummary: config.intakeEnabled
          ? "SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=false — raw event stored, Graph fetch skipped."
          : "SA360_META_LEAD_ADS_INTAKE_ENABLED=false — raw event stored, Graph fetch skipped.",
        existingEventId: existing?.id,
        claimImpl,
      });
      if (persisted.replayed || (existing && !persisted.created)) replayCount += 1;
      else processedCount += 1;
      results.push({
        leadgenId: envelope.leadgenId,
        intakeEnabled: config.intakeEnabled,
        graphFetchEnabled: config.graphFetchEnabled,
        sourceEventId: persisted.eventId,
        replayed: Boolean(existing) || persisted.replayed,
      });
      continue;
    }

    try {
      const lead = await opts.fetchMetaLeadDetailsImpl(envelope.leadgenId, config);
      if (!lead.ok || !lead.body) {
        failedCount += 1;
        const persisted = await persistRawFacebookEvent({
          leadgenId: envelope.leadgenId,
          rawPayloadJson: { envelope, graphStatus: lead.status },
          webhookRequestLogId: logHandle?.id,
          sourceRouteKey,
          errorSummary: `Meta Graph lead fetch failed (status ${lead.status}).`,
          existingEventId: existing?.id,
          claimImpl,
        });
        results.push({
          leadgenId: envelope.leadgenId,
          graphFetch: "failed",
          sourceEventId: persisted.eventId,
          replayed: persisted.replayed,
        });
        continue;
      }

      const fields = mapMetaLeadToFacebookFields(lead.body, envelope);
      const intake = await opts.processFacebookSourceLeadImpl({
        fields,
        rawPayloadJson: { envelope, lead: lead.body },
        masterClientAccountId,
        sourceType: "lead_form",
        webhookRequestLogId: logHandle?.id,
        existingEventId: existing?.id,
        routingEnabled: config.routingEnabled,
      });
      if (intake.replayed) replayCount += 1;
      else processedCount += 1;
      firstDecisionId = firstDecisionId ?? intake.routingDryRunDecisionId;
      firstDestination = firstDestination ?? intake.destinationClientAccountId;
      firstEventId = firstEventId ?? intake.sourceEventId;
      firstLeadUid = firstLeadUid ?? intake.normalizedLeadUid;
      results.push({
        leadgenId: envelope.leadgenId,
        sourceEventId: intake.sourceEventId,
        status: intake.status,
        matched: intake.matched,
        replayed: intake.replayed,
      });
    } catch (err) {
      failedCount += 1;
      logger.error("facebook_intake.process_failed", {
        requestId,
        leadgenId: envelope.leadgenId,
        error: err instanceof Error ? err.message : String(err),
      });
      const persisted = await persistRawFacebookEvent({
        leadgenId: envelope.leadgenId,
        rawPayloadJson: { envelope },
        webhookRequestLogId: logHandle?.id,
        sourceRouteKey,
        errorSummary: "Facebook intake processing error.",
        existingEventId: existing?.id,
        claimImpl,
      });
      results.push({
        leadgenId: envelope.leadgenId,
        error: "processing_failed",
        sourceEventId: persisted.eventId,
      });
    }
  }

  let processingStatus = "normalized";
  if (!canFetchGraph) processingStatus = "processing_disabled";
  if (replayCount === results.length && results.length > 0) processingStatus = "duplicate";
  else if (failedCount === results.length && results.length > 0) processingStatus = "failed";
  else if (failedCount > 0 && processedCount === 0 && replayCount === 0) processingStatus = "failed";
  else if (canFetchGraph && processedCount > 0) {
    const firstStatus = results.find((r) => r.replayed !== true && typeof r.status === "string");
    if (typeof firstStatus?.status === "string") {
      processingStatus = webhookProcessingStatusFromIntake(
        firstStatus.status as FacebookLeadIntakeResult["status"]
      );
    }
  }

  await complete(logHandle, {
    httpStatus: 200,
    processingStatus,
    clientAccountId: firstDestination ?? undefined,
    routingDryRunDecisionId: firstDecisionId ?? undefined,
    sourceLeadEventId: firstEventId,
    normalizedLeadUid: firstLeadUid,
    eventNameInternal: "lead_created",
    responseBodyRedacted: {
      ok: true,
      processed: results.length,
      replayed: replayCount,
    },
  });

  return reply.status(200).send({
    ok: true,
    intakeEnabled: config.intakeEnabled,
    graphFetchEnabled: config.graphFetchEnabled,
    routingEnabled: config.routingEnabled,
    processed: results.length,
    replayed: replayCount,
    results,
  });
}

async function handleTestLead(
  request: RawBodyRequest,
  reply: FastifyReply,
  opts: Required<
    Pick<SourcesFacebookRoutesOptions, "processFacebookSourceLeadImpl" | "getMetaWebhookConfigImpl">
  > &
    Pick<SourcesFacebookRoutesOptions, "startLogImpl" | "completeLogImpl">
) {
  const requestId = readRequestId(request);
  const config = opts.getMetaWebhookConfigImpl();
  const start = opts.startLogImpl ?? startLog;
  const complete = opts.completeLogImpl ?? completeLog;
  const logHandle = await start({
    requestId,
    rawBody: request.body,
    source: "facebook_lead_ads",
    route: FACEBOOK_TEST_LEAD_ROUTE,
  });

  if (!config.fixtureEnabled) {
    await complete(logHandle, {
      httpStatus: 403,
      processingStatus: "processing_disabled",
      errorCode: "FIXTURE_DISABLED",
      errorSummary: "SA360_META_LEAD_ADS_FIXTURE_ENABLED=false — test-lead fixture is disabled.",
      responseBodyRedacted: { ok: false, error: "processing_disabled" },
    });
    return reply.status(403).send({
      ok: false,
      error: "processing_disabled",
      hint: "Set SA360_META_LEAD_ADS_FIXTURE_ENABLED=true to use the test-lead fixture.",
    });
  }

  const fields = coerceFacebookLeadFields(request.body);
  if (!fields) {
    await complete(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "test-lead body must be a JSON object.",
      responseBodyRedacted: { ok: false, error: "invalid_payload" },
    });
    return reply.status(400).send({ ok: false, error: "invalid_payload" });
  }

  try {
    const masterClientAccountId =
      ((request.body as Record<string, unknown>)?.masterClientAccountId as string | undefined)?.trim() ||
      config.masterClientAccountId ||
      "";
    const intake = await opts.processFacebookSourceLeadImpl({
      fields,
      rawPayloadJson: { testLead: request.body as Record<string, unknown> },
      masterClientAccountId,
      sourceType: "webhook",
      webhookRequestLogId: logHandle?.id,
      routingEnabled: config.routingEnabled,
    });
    await complete(logHandle, {
      httpStatus: 200,
      processingStatus: intake.replayed
        ? "duplicate"
        : webhookProcessingStatusFromIntake(intake.status),
      clientAccountId: intake.destinationClientAccountId ?? undefined,
      sourceLeadEventId: intake.sourceEventId,
      normalizedLeadUid: intake.normalizedLeadUid,
      routingDryRunDecisionId: intake.routingDryRunDecisionId ?? undefined,
      eventNameInternal: "lead_created",
      responseBodyRedacted: {
        ok: true,
        status: intake.status,
        matched: intake.matched,
        replayed: intake.replayed,
      },
    });
    return reply.status(200).send(intake);
  } catch (err) {
    const message = err instanceof Error ? err.message : "intake_failed";
    logger.error("facebook_intake.test_lead.failed", { requestId, message });
    await complete(logHandle, {
      httpStatus: 500,
      processingStatus: "failed",
      errorSummary: message,
      responseBodyRedacted: { ok: false, error: "intake_failed" },
    });
    return reply.status(500).send({ ok: false, error: "intake_failed" });
  }
}

export async function sourcesFacebookRoutes(
  app: FastifyInstance,
  opts: SourcesFacebookRoutesOptions = {}
) {
  const processImpl = opts.processFacebookSourceLeadImpl ?? processFacebookSourceLead;
  const fetchImpl = opts.fetchMetaLeadDetailsImpl ?? fetchMetaLeadDetails;
  const configImpl = opts.getMetaWebhookConfigImpl ?? getMetaWebhookConfig;

  // Scoped raw-body JSON parser so X-Hub-Signature-256 can be verified over exact bytes.
  // Encapsulated to this plugin: GHL lifecycle and LeadCapture.io parsers are unaffected.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string", bodyLimit: 1_048_576 },
    (req, body: string, done) => {
      (req as RawBodyRequest).rawBody = body;
      if (!body || body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        // Do not fail the request here; the handler logs a durable row and returns a structured error.
        done(null, { [PARSE_ERROR_MARKER]: true });
      }
    }
  );

  const postOpts = {
    processFacebookSourceLeadImpl: processImpl,
    fetchMetaLeadDetailsImpl: fetchImpl,
    getMetaWebhookConfigImpl: configImpl,
    startLogImpl: opts.startLogImpl,
    completeLogImpl: opts.completeLogImpl,
    findFacebookLeadReplayImpl: opts.findFacebookLeadReplayImpl,
    claimFacebookLeadgenImpl: opts.claimFacebookLeadgenImpl,
  };

  for (const route of [FACEBOOK_LEAD_CREATED_ROUTE, META_LEADGEN_ROUTE]) {
    app.get(route, (request, reply) =>
      handleVerification(
        request,
        reply,
        configImpl(),
        route,
        opts.startLogImpl,
        opts.completeLogImpl
      )
    );
    app.post(route, (request, reply) =>
      handleLeadCreated(request as RawBodyRequest, reply, postOpts, route)
    );
  }

  app.post(FACEBOOK_TEST_LEAD_ROUTE, (request, reply) =>
    handleTestLead(request as RawBodyRequest, reply, {
      processFacebookSourceLeadImpl: processImpl,
      getMetaWebhookConfigImpl: configImpl,
      startLogImpl: opts.startLogImpl,
      completeLogImpl: opts.completeLogImpl,
    })
  );
}
