import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { validateLeadConduitWebhookAuth } from "../lib/leadconduit-webhook-auth.js";
import { logger } from "../lib/logger.js";
import { getMetaWebhookConfig } from "../lib/meta-webhook.js";
import { readRequestId } from "../lib/read-request-id.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";
import { processLeadConduitFacebookIntake } from "../services/source-intake/leadconduit-facebook-intake.service.js";
import { canNormalizeLeadConduitFacebookPayload } from "../services/source-intake/leadconduit-facebook-normalizer.js";

const LEADCONDUIT_FACEBOOK_ROUTE = "/sources/leadconduit/facebook-lead";
const LEADCONDUIT_FACEBOOK_SOURCE_LANE = "leadconduit_facebook";

export type SourcesLeadConduitFacebookRoutesOptions = {
  processLeadConduitFacebookIntakeImpl?: typeof processLeadConduitFacebookIntake;
};

function resolveLeadConduitMasterClientAccountId(): string {
  const specific = process.env.SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID?.trim();
  if (specific) return specific;
  const meta = getMetaWebhookConfig().masterClientAccountId?.trim();
  if (meta) return meta;
  return "leadconduit_facebook";
}

async function handleLeadConduitFacebookLead(
  request: FastifyRequest,
  reply: FastifyReply,
  processImpl: typeof processLeadConduitFacebookIntake
) {
  const requestId = readRequestId(request);
  const logHandle = await startLog({
    requestId,
    rawBody: request.body,
    // TODO(tech-debt): Add a dedicated `leadconduit_facebook` WebhookRequestSource enum value.
    source: "facebook_lead_ads",
    route: LEADCONDUIT_FACEBOOK_ROUTE,
  });

  const keyHeader = request.headers["x-sa360-leadconduit-key"];
  const keyValue = typeof keyHeader === "string" ? keyHeader : undefined;
  const authHeader = request.headers.authorization;
  const authorizationHeader = typeof authHeader === "string" ? authHeader : undefined;
  const auth = validateLeadConduitWebhookAuth({
    headerKey: keyValue,
    authorizationHeader,
  });

  if (!auth.ok) {
    if (auth.reason === "integration_not_configured") {
      logger.error("source_intake.leadconduit_facebook.integration_not_configured", {
        requestId,
        sourceLane: LEADCONDUIT_FACEBOOK_SOURCE_LANE,
      });
      const responseBody = {
        ok: false,
        error: "integration_not_configured",
        integration: LEADCONDUIT_FACEBOOK_SOURCE_LANE,
        hint: auth.hint ?? "Set SA360_LEADCONDUIT_WEBHOOK_SECRET in the API environment.",
      };
      await completeLog(logHandle, {
        httpStatus: 503,
        processingStatus: "integration_not_configured",
        errorCode: "INTEGRATION_NOT_CONFIGURED",
        errorSummary: "LeadConduit webhook secret is required in production.",
        responseBodyRedacted: responseBody,
      });
      return reply.status(503).send(responseBody);
    }

    logger.warn("source_intake.leadconduit_facebook.unauthorized", {
      requestId,
      sourceLane: LEADCONDUIT_FACEBOOK_SOURCE_LANE,
      reason: auth.reason,
    });
    await completeLog(logHandle, {
      httpStatus: 401,
      processingStatus: "unauthorized",
      responseBodyRedacted: { ok: false, error: "Unauthorized" },
    });
    return reply.status(401).send({ ok: false, error: "Unauthorized" });
  }

  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body) ||
    !canNormalizeLeadConduitFacebookPayload(request.body)
  ) {
    await completeLog(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "LeadConduit Facebook webhook requires an object payload with lead identity fields.",
      responseBodyRedacted: { ok: false, error: "invalid_payload" },
    });
    return reply.status(400).send({
      ok: false,
      error: "invalid_payload",
      message:
        "Expected an object payload with a LeadConduit delivery id, Facebook leadgen id, or source lead id.",
    });
  }

  try {
    const result = await processImpl({
      rawPayload: request.body as Record<string, unknown>,
      webhookRequestLogId: logHandle?.id,
      masterClientAccountId: resolveLeadConduitMasterClientAccountId(),
    });

    const response = {
      ok: true,
      provider: result.provider,
      sourceSystem: result.sourceSystem,
      sourceLane: result.sourceLane,
      sourceEventId: result.sourceEventId,
      status: result.status,
      sourceRouteKey: result.sourceRouteKey,
      sourceLeadId: result.sourceLeadId,
      normalizedLeadUid: result.normalizedLeadUid,
      replayed: result.replayed,
      matched: result.matched,
      matchedRuleId: result.matchedRuleId ?? null,
      destinationClientAccountId: result.destinationClientAccountId ?? null,
      destinationLocationIdGhl: result.destinationLocationIdGhl ?? null,
      routingDryRunDecisionId: result.routingDryRunDecisionId ?? null,
      nextAction: result.nextAction,
      ...(auth.devWarning ? { devWarning: auth.devWarning } : {}),
    };

    if (auth.devWarning) {
      logger.warn("source_intake.leadconduit_facebook.dev_warning", {
        requestId,
        sourceLane: LEADCONDUIT_FACEBOOK_SOURCE_LANE,
        warning: auth.devWarning,
      });
    }

    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: result.status,
      clientAccountId: result.destinationClientAccountId ?? undefined,
      subaccountIdGhl: result.destinationLocationIdGhl ?? undefined,
      sourceLeadEventId: result.sourceEventId,
      normalizedLeadUid: result.normalizedLeadUid,
      routingDryRunDecisionId: result.routingDryRunDecisionId ?? undefined,
      eventNameInternal: "lead_created",
      responseBodyRedacted: response,
    });

    return reply.status(200).send(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "intake_failed";
    const isBadPayload = message === "invalid_leadconduit_facebook_payload";
    if (isBadPayload) {
      await completeLog(logHandle, {
        httpStatus: 400,
        processingStatus: "validation_failed",
        errorCode: "INVALID_BODY",
        errorSummary: "LeadConduit Facebook payload did not pass normalization pre-check.",
        responseBodyRedacted: { ok: false, error: "invalid_payload" },
      });
      return reply.status(400).send({ ok: false, error: "invalid_payload" });
    }

    logger.error("source_intake.leadconduit_facebook.failed", {
      requestId,
      sourceLane: LEADCONDUIT_FACEBOOK_SOURCE_LANE,
      message,
    });
    await completeLog(logHandle, {
      httpStatus: 500,
      processingStatus: "failed",
      errorSummary: message,
      responseBodyRedacted: { ok: false, error: "Intake failed" },
    });
    return reply.status(500).send({ ok: false, error: "Intake failed" });
  }
}

export async function sourcesLeadConduitFacebookRoutes(
  app: FastifyInstance,
  opts: SourcesLeadConduitFacebookRoutesOptions = {}
) {
  const processImpl =
    opts.processLeadConduitFacebookIntakeImpl ?? processLeadConduitFacebookIntake;
  app.route({
    method: "POST",
    url: LEADCONDUIT_FACEBOOK_ROUTE,
    bodyLimit: 1_048_576,
    handler: (request, reply) =>
      handleLeadConduitFacebookLead(request, reply, processImpl),
  });
}
