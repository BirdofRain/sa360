import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";
import {
  getMetaWebhookConfig,
  validateMetaSignature,
  verifyMetaWebhookChallenge,
  type MetaWebhookConfig,
} from "../lib/meta-webhook.js";
import { createSourceLeadEvent } from "../repositories/source-lead-event.repository.js";
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
import { processFacebookSourceLead } from "../services/source-intake/facebook-lead-intake.service.js";

const LEAD_CREATED_ROUTE = "/sources/facebook/lead-created";
const TEST_LEAD_ROUTE = "/sources/facebook/test-lead";

const PARSE_ERROR_MARKER = "__sa360_facebook_parse_error";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export type SourcesFacebookRoutesOptions = {
  processFacebookSourceLeadImpl?: typeof processFacebookSourceLead;
  fetchMetaLeadDetailsImpl?: MetaLeadFetcher;
  getMetaWebhookConfigImpl?: () => MetaWebhookConfig;
};

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const v = request.headers[name];
  return typeof v === "string" ? v : undefined;
}

async function handleVerification(
  request: FastifyRequest,
  reply: FastifyReply,
  config: MetaWebhookConfig
) {
  const query = (request.query ?? {}) as Record<string, string | undefined>;
  const result = verifyMetaWebhookChallenge(
    {
      "hub.mode": query["hub.mode"],
      "hub.verify_token": query["hub.verify_token"],
      "hub.challenge": query["hub.challenge"],
    },
    config.verifyToken
  );
  if (result.ok) {
    return reply.status(200).type("text/plain").send(result.challenge);
  }
  logger.warn("facebook_intake.verify.failed", { reason: result.reason });
  return reply.status(403).send({ ok: false, error: "verification_failed" });
}

async function persistRawFacebookEvent(input: {
  leadgenId: string;
  rawPayloadJson: Record<string, unknown>;
  webhookRequestLogId?: string;
  sourceRouteKey: string;
  errorSummary?: string;
}): Promise<string | null> {
  try {
    const event = await createSourceLeadEvent({
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
    return event.id;
  } catch (err) {
    logger.error("facebook_intake.persist_raw_failed", {
      leadgenId: input.leadgenId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function handleLeadCreated(
  request: RawBodyRequest,
  reply: FastifyReply,
  opts: Required<Pick<SourcesFacebookRoutesOptions, "processFacebookSourceLeadImpl" | "fetchMetaLeadDetailsImpl" | "getMetaWebhookConfigImpl">>
) {
  const requestId = readRequestId(request);
  const config = opts.getMetaWebhookConfigImpl();
  const logHandle = await startLog({
    requestId,
    rawBody: request.body,
    source: "facebook_lead_ads",
    route: LEAD_CREATED_ROUTE,
  });

  // 1. Signature validation (only enforced when META_APP_SECRET is configured).
  const signature = validateMetaSignature(
    request.rawBody ?? "",
    getHeader(request, "x-hub-signature-256"),
    config.appSecret
  );
  if (!signature.ok) {
    logger.warn("facebook_intake.signature.invalid", { requestId, reason: signature.reason });
    await completeLog(logHandle, {
      httpStatus: 401,
      processingStatus: "unauthorized",
      errorCode: signature.reason,
      errorSummary: "Invalid X-Hub-Signature-256",
      responseBodyRedacted: { ok: false, error: "invalid_signature" },
    });
    return reply.status(401).send({ ok: false, error: "invalid_signature" });
  }

  // 2. Bad payloads are logged durably and acknowledged (200) so Meta does not retry-storm.
  const body = request.body;
  const badBody =
    !body ||
    typeof body !== "object" ||
    (body as Record<string, unknown>)[PARSE_ERROR_MARKER] === true;
  if (badBody) {
    await completeLog(logHandle, {
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
    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: "no_leadgen",
      responseBodyRedacted: { ok: true, processed: 0 },
    });
    return reply.status(200).send({ ok: true, processed: 0, note: "no leadgen changes" });
  }

  const masterClientAccountId = config.masterClientAccountId ?? "";
  const results: Array<Record<string, unknown>> = [];
  let firstDecisionId: string | undefined;
  let firstDestination: string | undefined;

  for (const envelope of envelopes) {
    const sourceRouteKey = envelope.formId ?? envelope.adId ?? `leadgen_${envelope.leadgenId}`;

    // Dry-run guardrail: when direct intake is disabled, persist the raw event for audit
    // but do NOT call the Graph API or run routing.
    if (!config.directIntakeEnabled) {
      const eventId = await persistRawFacebookEvent({
        leadgenId: envelope.leadgenId,
        rawPayloadJson: { envelope },
        webhookRequestLogId: logHandle?.id,
        sourceRouteKey,
        errorSummary: "FACEBOOK_DIRECT_INTAKE_ENABLED=false — raw event stored, Graph fetch skipped.",
      });
      results.push({ leadgenId: envelope.leadgenId, intakeEnabled: false, sourceEventId: eventId });
      continue;
    }

    try {
      const lead = await opts.fetchMetaLeadDetailsImpl(envelope.leadgenId, config);
      if (!lead.ok || !lead.body) {
        const eventId = await persistRawFacebookEvent({
          leadgenId: envelope.leadgenId,
          rawPayloadJson: { envelope, graphStatus: lead.status },
          webhookRequestLogId: logHandle?.id,
          sourceRouteKey,
          errorSummary: `Meta Graph lead fetch failed (status ${lead.status}).`,
        });
        results.push({ leadgenId: envelope.leadgenId, graphFetch: "failed", sourceEventId: eventId });
        continue;
      }

      const fields = mapMetaLeadToFacebookFields(lead.body, envelope);
      const intake = await opts.processFacebookSourceLeadImpl({
        fields,
        rawPayloadJson: { envelope, lead: lead.body },
        masterClientAccountId,
        sourceType: "lead_form",
        webhookRequestLogId: logHandle?.id,
      });
      firstDecisionId = firstDecisionId ?? intake.routingDryRunDecisionId;
      firstDestination = firstDestination ?? intake.destinationClientAccountId;
      results.push({
        leadgenId: envelope.leadgenId,
        sourceEventId: intake.sourceEventId,
        status: intake.status,
        matched: intake.matched,
      });
    } catch (err) {
      // Never crash the webhook; persist a durable failure row and continue.
      logger.error("facebook_intake.process_failed", {
        requestId,
        leadgenId: envelope.leadgenId,
        error: err instanceof Error ? err.message : String(err),
      });
      const eventId = await persistRawFacebookEvent({
        leadgenId: envelope.leadgenId,
        rawPayloadJson: { envelope },
        webhookRequestLogId: logHandle?.id,
        sourceRouteKey,
        errorSummary: "Facebook intake processing error.",
      });
      results.push({ leadgenId: envelope.leadgenId, error: "processing_failed", sourceEventId: eventId });
    }
  }

  await completeLog(logHandle, {
    httpStatus: 200,
    processingStatus: config.directIntakeEnabled ? "processed" : "intake_disabled",
    clientAccountId: firstDestination ?? undefined,
    routingDryRunDecisionId: firstDecisionId ?? undefined,
    eventNameInternal: "lead_created",
    responseBodyRedacted: { ok: true, processed: results.length },
  });

  return reply.status(200).send({
    ok: true,
    intakeEnabled: config.directIntakeEnabled,
    processed: results.length,
    results,
  });
}

async function handleTestLead(
  request: RawBodyRequest,
  reply: FastifyReply,
  opts: Required<Pick<SourcesFacebookRoutesOptions, "processFacebookSourceLeadImpl" | "getMetaWebhookConfigImpl">>
) {
  const requestId = readRequestId(request);
  const config = opts.getMetaWebhookConfigImpl();
  const logHandle = await startLog({
    requestId,
    rawBody: request.body,
    source: "facebook_lead_ads",
    route: TEST_LEAD_ROUTE,
  });

  const fields = coerceFacebookLeadFields(request.body);
  if (!fields) {
    await completeLog(logHandle, {
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
    });
    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: intake.status,
      clientAccountId: intake.destinationClientAccountId ?? undefined,
      sourceLeadEventId: intake.sourceEventId,
      normalizedLeadUid: intake.normalizedLeadUid,
      routingDryRunDecisionId: intake.routingDryRunDecisionId ?? undefined,
      eventNameInternal: "lead_created",
      responseBodyRedacted: { ok: true, status: intake.status, matched: intake.matched },
    });
    return reply.status(200).send(intake);
  } catch (err) {
    const message = err instanceof Error ? err.message : "intake_failed";
    logger.error("facebook_intake.test_lead.failed", { requestId, message });
    await completeLog(logHandle, {
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

  app.get(LEAD_CREATED_ROUTE, (request, reply) =>
    handleVerification(request, reply, configImpl())
  );

  app.post(LEAD_CREATED_ROUTE, (request, reply) =>
    handleLeadCreated(request as RawBodyRequest, reply, {
      processFacebookSourceLeadImpl: processImpl,
      fetchMetaLeadDetailsImpl: fetchImpl,
      getMetaWebhookConfigImpl: configImpl,
    })
  );

  app.post(TEST_LEAD_ROUTE, (request, reply) =>
    handleTestLead(request as RawBodyRequest, reply, {
      processFacebookSourceLeadImpl: processImpl,
      getMetaWebhookConfigImpl: configImpl,
    })
  );
}
