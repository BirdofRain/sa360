import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { validateLeadCaptureWebhookKey } from "../lib/leadcapture-webhook-auth.js";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";
import { processLeadCaptureIoWebhookIntake } from "../services/source-intake/source-lead-intake.service.js";

const LEADCAPTURE_IO_ROUTE = "/webhooks/leadcaptureio";
const LEADCAPTURE_IO_ROUTE_WITH_KEY = "/webhooks/leadcaptureio/:routeKey";

function parseBody(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

async function handleLeadCaptureIoWebhook(
  request: FastifyRequest<{ Params: { routeKey?: string } }>,
  reply: FastifyReply
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
  const auth = validateLeadCaptureWebhookKey(keyValue);

  if (!auth.ok) {
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

  const body = parseBody(request.body);
  if (!body) {
    await completeLog(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "Expected JSON object body",
      responseBodyRedacted: { ok: false, error: "Invalid payload" },
    });
    return reply.status(400).send({ ok: false, error: "Invalid payload" });
  }

  try {
    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: body,
      routeKeyFromPath,
    });

    const response = {
      ok: true,
      provider: result.provider,
      sourceEventId: result.sourceEventId,
      status: result.status,
      sourceRouteKey: result.sourceRouteKey,
      sourceLeadId: result.sourceLeadId,
      normalizedLeadUid: result.normalizedLeadUid,
      matched: result.matched,
      matchedRuleId: result.matchedRuleId ?? null,
      destinationClientAccountId: result.destinationClientAccountId ?? null,
      destinationLocationIdGhl: result.destinationLocationIdGhl ?? null,
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

export async function webhookLeadCaptureIoRoutes(app: FastifyInstance) {
  app.post(LEADCAPTURE_IO_ROUTE, handleLeadCaptureIoWebhook);
  app.post(LEADCAPTURE_IO_ROUTE_WITH_KEY, handleLeadCaptureIoWebhook);
}

export type LeadCaptureIoWebhookRoutesOptions = {
  processLeadCaptureIoWebhookIntakeImpl?: typeof processLeadCaptureIoWebhookIntake;
};
