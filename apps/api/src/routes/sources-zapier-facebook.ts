import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import {
  ZAPIER_FACEBOOK_WEBHOOK_KEY_HEADER,
  ZAPIER_FACEBOOK_WEBHOOK_SECRET_ENV,
  validateZapierFacebookWebhookAuth,
} from "../lib/zapier-facebook-webhook-auth.js";
import { FacebookCaptureIntakeDisabledError } from "../services/source-intake/facebook-capture-gate.js";
import {
  ZapierFacebookCaptureError,
  processZapierFacebookCapture,
} from "../services/source-intake/zapier-facebook-capture.service.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";

export const ZAPIER_FACEBOOK_CAPTURE_ROUTE = "/sources/zapier/facebook-lead";

export type SourcesZapierFacebookRoutesOptions = {
  processZapierFacebookCaptureImpl?: typeof processZapierFacebookCapture;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function handleZapierFacebookLead(
  request: FastifyRequest,
  reply: FastifyReply,
  processImpl: typeof processZapierFacebookCapture
) {
  const requestId = readRequestId(request);
  const logHandle = await startLog({
    requestId,
    rawBody: request.body,
    source: "facebook_lead_ads",
    route: ZAPIER_FACEBOOK_CAPTURE_ROUTE,
  });
  const keyHeader = request.headers[ZAPIER_FACEBOOK_WEBHOOK_KEY_HEADER];
  const headerKey = typeof keyHeader === "string" ? keyHeader : undefined;
  const auth = validateZapierFacebookWebhookAuth({ headerKey });
  if (!auth.ok) {
    if (auth.reason === "integration_not_configured") {
      const responseBody = {
        ok: false,
        error: "integration_not_configured",
        integration: "zapier_facebook",
        hint: auth.hint ?? `Set ${ZAPIER_FACEBOOK_WEBHOOK_SECRET_ENV} in the API environment.`,
      };
      await completeLog(logHandle, {
        httpStatus: 503,
        processingStatus: "integration_not_configured",
        errorCode: "INTEGRATION_NOT_CONFIGURED",
        errorSummary: "Zapier Facebook webhook secret is required in production.",
        responseBodyRedacted: responseBody,
      });
      return reply.status(503).send(responseBody);
    }
    await completeLog(logHandle, {
      httpStatus: 401,
      processingStatus: "unauthorized",
      responseBodyRedacted: { ok: false, error: "Unauthorized" },
    });
    return reply.status(401).send({ ok: false, error: "Unauthorized" });
  }

  const body = asObject(request.body);
  if (!body) {
    await completeLog(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "Zapier Facebook capture requires a JSON object.",
      responseBodyRedacted: { ok: false, error: "invalid_payload" },
    });
    return reply.status(400).send({
      ok: false,
      error: "invalid_payload",
      message: "Expected a JSON object with a Facebook leadgen_id.",
    });
  }

  try {
    const result = await processImpl({
      rawPayload: body,
      webhookRequestLogId: logHandle?.id,
    });
    const response = {
      ...result,
      ...(auth.devWarning ? { devWarning: auth.devWarning } : {}),
    };
    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: result.replayed ? "duplicate" : "captured",
      clientAccountId: result.association.clientAccountId ?? undefined,
      sourceLeadEventId: result.sourceEventId,
      normalizedLeadUid: result.capture.normalizedLeadUid,
      eventNameInternal: "lead_created",
      responseBodyRedacted: response,
    });
    return reply.status(200).send(response);
  } catch (err) {
    if (err instanceof FacebookCaptureIntakeDisabledError) {
      const responseBody = { ok: false, error: err.code, message: err.message };
      await completeLog(logHandle, {
        httpStatus: err.httpStatus,
        processingStatus: "integration_not_configured",
        errorCode: err.code,
        errorSummary: err.message,
        responseBodyRedacted: responseBody,
      });
      return reply.status(err.httpStatus).send(responseBody);
    }
    if (err instanceof ZapierFacebookCaptureError) {
      const status = 400;
      const responseBody = { ok: false, error: err.code, message: err.message };
      await completeLog(logHandle, {
        httpStatus: status,
        processingStatus: "validation_failed",
        errorCode: err.code,
        errorSummary: err.message,
        responseBodyRedacted: responseBody,
      });
      return reply.status(status).send(responseBody);
    }
    const message = err instanceof Error ? err.message : "intake_failed";
    logger.error("source_intake.zapier_facebook.failed", { requestId, message });
    await completeLog(logHandle, {
      httpStatus: 500,
      processingStatus: "failed",
      errorSummary: message,
      responseBodyRedacted: { ok: false, error: "Intake failed" },
    });
    return reply.status(500).send({ ok: false, error: "Intake failed" });
  }
}

export async function sourcesZapierFacebookRoutes(
  app: FastifyInstance,
  opts: SourcesZapierFacebookRoutesOptions = {}
) {
  const processImpl = opts.processZapierFacebookCaptureImpl ?? processZapierFacebookCapture;
  app.route({
    method: "POST",
    url: ZAPIER_FACEBOOK_CAPTURE_ROUTE,
    bodyLimit: 1_048_576,
    handler: (request, reply) => handleZapierFacebookLead(request, reply, processImpl),
  });
}
