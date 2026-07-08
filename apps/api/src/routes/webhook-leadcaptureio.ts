import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { validateLeadCaptureWebhookAuth } from "../lib/leadcapture-webhook-auth.js";
import {
  parseLeadCaptureWebhookBody,
  registerLeadCaptureWebhookBodyParsers,
} from "../lib/leadcapture-webhook-body.js";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";
import { processLeadCaptureIoWebhookIntake } from "../services/source-intake/source-lead-intake.service.js";

const LEADCAPTURE_IO_ROUTE = "/webhooks/leadcaptureio";
const LEADCAPTURE_IO_ROUTE_WITH_KEY = "/webhooks/leadcaptureio/:routeKey";

function readContentType(request: FastifyRequest): string | undefined {
  const header = request.headers["content-type"];
  return typeof header === "string" ? header : undefined;
}

function parseWebhookPayload(
  request: FastifyRequest,
  rawBody: unknown
): Record<string, unknown> | null {
  const contentType = readContentType(request);
  const parsed = parseLeadCaptureWebhookBody(rawBody, contentType);
  if (!parsed) return null;

  if (
    contentType?.includes("application/x-www-form-urlencoded") ||
    contentType?.includes("multipart/form-data")
  ) {
    return {
      ...parsed,
      _sa360_intake_format: "native_form",
      _sa360_intake_content_type: contentType.split(";")[0]?.trim().toLowerCase(),
    };
  }

  return parsed;
}

async function handleLeadCaptureIoWebhook(
  request: FastifyRequest<{ Params: { routeKey?: string } }>,
  reply: FastifyReply,
  processIntake: typeof processLeadCaptureIoWebhookIntake
) {
  const request_id = readRequestId(request);
  const routeKeyFromPath = request.params.routeKey?.trim();
  const logHandle = await startLog({
    requestId: request_id,
    rawBody: request.body,
    source: "leadcapture_io",
    route: routeKeyFromPath
      ? `${LEADCAPTURE_IO_ROUTE}/${routeKeyFromPath}`
      : LEADCAPTURE_IO_ROUTE,
  });

  const keyHeader = request.headers["x-sa360-leadcapture-key"];
  const keyValue = typeof keyHeader === "string" ? keyHeader : undefined;
  const authHeader = request.headers.authorization;
  const authorizationHeader = typeof authHeader === "string" ? authHeader : undefined;
  const auth = validateLeadCaptureWebhookAuth({
    headerKey: keyValue,
    authorizationHeader,
  });

  if (!auth.ok) {
    if (auth.reason === "integration_not_configured") {
      const responseBody = {
        ok: false,
        error: "integration_not_configured",
        integration: "leadcapture_io",
        hint: auth.hint ?? "Set SA360_LEADCAPTURE_WEBHOOK_SECRET in the API environment.",
      };
      logger.error("source_intake.leadcapture.integration_not_configured", {
        request_id,
      });
      await completeLog(logHandle, {
        httpStatus: 503,
        processingStatus: "integration_not_configured",
        errorCode: "INTEGRATION_NOT_CONFIGURED",
        errorSummary: "LeadCapture webhook secret is required in production.",
        responseBodyRedacted: responseBody,
      });
      return reply.status(503).send(responseBody);
    }

    logger.warn("source_intake.leadcapture.unauthorized", {
      request_id,
      reason: auth.reason,
    });
    await completeLog(logHandle, {
      httpStatus: 401,
      processingStatus: "unauthorized",
      responseBodyRedacted: { ok: false, error: "Unauthorized" },
    });
    return reply.status(401).send({ ok: false, error: "Unauthorized" });
  }

  const body = parseWebhookPayload(request, request.body);
  if (!body) {
    await completeLog(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "Expected JSON or form-encoded webhook body",
      responseBodyRedacted: { ok: false, error: "Invalid payload" },
    });
    return reply.status(400).send({ ok: false, error: "Invalid payload" });
  }

  try {
    const result = await processIntake({
      rawPayload: body,
      routeKeyFromPath,
      webhookRequestLogId: logHandle?.id,
    });

    const response = {
      ok: true,
      provider: result.provider,
      sourceEventId: result.sourceEventId,
      status: result.status,
      sourceRouteKey: result.sourceRouteKey,
      sourceLeadId: result.sourceLeadId,
      ...(result.sourceLeadIdGenerated ? { sourceLeadIdGenerated: true } : {}),
      normalizedLeadUid: result.normalizedLeadUid,
      matched: result.matched,
      matchedRuleId: result.matchedRuleId ?? null,
      destinationClientAccountId: result.destinationClientAccountId ?? null,
      destinationLocationIdGhl: result.destinationLocationIdGhl ?? null,
      routingDryRunDecisionId: result.routingDryRunDecisionId ?? null,
      nextAction: result.nextAction,
      ...(auth.devWarning ? { devWarning: auth.devWarning } : {}),
    };

    if (auth.devWarning) {
      logger.warn("source_intake.leadcapture.dev_warning", {
        request_id,
        warning: auth.devWarning,
      });
    }

    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: result.status,
      clientAccountId: result.destinationClientAccountId ?? undefined,
      subaccountIdGhl: result.destinationLocationIdGhl ?? undefined,
      normalizedLeadUid: result.normalizedLeadUid,
      sourceLeadEventId: result.sourceEventId,
      routingDryRunDecisionId: result.routingDryRunDecisionId ?? undefined,
      eventNameInternal: "lead_created",
      responseBodyRedacted: response,
    });

    return reply.status(200).send(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "intake_failed";
    logger.error("source_intake.leadcapture.failed", { request_id, message });
    await completeLog(logHandle, {
      httpStatus: 500,
      processingStatus: "failed",
      errorSummary: message,
      responseBodyRedacted: { ok: false, error: "Intake failed" },
    });
    return reply.status(500).send({ ok: false, error: "Intake failed" });
  }
}

export async function webhookLeadCaptureIoRoutes(
  app: FastifyInstance,
  opts: LeadCaptureIoWebhookRoutesOptions = {}
) {
  const processIntake = opts.processLeadCaptureIoWebhookIntakeImpl ?? processLeadCaptureIoWebhookIntake;
  registerLeadCaptureWebhookBodyParsers(app);
  app.post<{ Params: { routeKey?: string } }>(LEADCAPTURE_IO_ROUTE, (request, reply) =>
    handleLeadCaptureIoWebhook(request, reply, processIntake)
  );
  app.post<{ Params: { routeKey?: string } }>(LEADCAPTURE_IO_ROUTE_WITH_KEY, (request, reply) =>
    handleLeadCaptureIoWebhook(request, reply, processIntake)
  );
}

export type LeadCaptureIoWebhookRoutesOptions = {
  processLeadCaptureIoWebhookIntakeImpl?: typeof processLeadCaptureIoWebhookIntake;
};
